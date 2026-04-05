use std::collections::HashMap;
use std::io::Write;
use std::sync::Arc;
use std::time::{Duration, SystemTime, UNIX_EPOCH};

use base64::engine::general_purpose::URL_SAFE_NO_PAD;
use base64::Engine;
use chrono::Local;
use ed25519_dalek::{Signature, Signer, SigningKey, Verifier, VerifyingKey};
use futures_util::{SinkExt, StreamExt};
use rand::rngs::OsRng;
use reqwest::header::{AUTHORIZATION, CONTENT_TYPE};
use reqwest::Client;
use serde::{Deserialize, Serialize};
use serde_json::Value;
use sha2::{Digest, Sha256};
use tauri::{AppHandle, Manager, State};
use tokio::io::{AsyncBufReadExt, BufReader};
use tokio::sync::{mpsc, oneshot, Mutex};
use tokio::task::JoinHandle;
use tokio_tungstenite::tungstenite::Message as WsMessage;
use tokio_util::io::StreamReader;
use webrtc::api::media_engine::MediaEngine;
use webrtc::api::APIBuilder;
use webrtc::data_channel::data_channel_message::DataChannelMessage;
use webrtc::data_channel::RTCDataChannel;
use webrtc::ice_transport::ice_candidate::RTCIceCandidateInit;
use webrtc::ice_transport::ice_connection_state::RTCIceConnectionState;
use webrtc::ice_transport::ice_server::RTCIceServer;
use webrtc::peer_connection::configuration::RTCConfiguration;
use webrtc::peer_connection::peer_connection_state::RTCPeerConnectionState;
use webrtc::peer_connection::sdp::session_description::RTCSessionDescription;
use webrtc::peer_connection::RTCPeerConnection;

use crate::app_paths::app_config_dir;

const PAIR_EVENT_NAME: &str = "pair-backend://state";
const PAIR_LOG_PREFIX: &str = "Pair Log: ready";
const PAIR_LOG_FILE_NAME: &str = "pair-backend.log";
const PAIR_IDENTITY_FILE_NAME: &str = "pair-v2-desktop-identity.json";
const PAIR_RECONNECT_MAX_MS: u64 = 15_000;
const PAIR_RECONNECT_BASE_MS: u64 = 1_000;
const PAIR_HEARTBEAT_SECS: u64 = 30;
const PAIR_CAPABILITY_HELLO_TYPE: &str = "sys.auth.hello";
const PAIR_CAPABILITY_CAPS_TYPE: &str = "sys.capabilities";
const OPENCLAW_CHAT_MESSAGE_TYPE: &str = "app.openclaw.chat.message";
const OPENCLAW_CHAT_ACK_TYPE: &str = "app.openclaw.chat.ack";
const OPENCLAW_CHAT_SYNC_REQUEST_TYPE: &str = "app.openclaw.chat.sync-request";
const OPENCLAW_RELAY_APP_SIGNAL_TYPE: &str = "relay.app";
const OPENCLAW_GATEWAY_IDENTITY_FILE_NAME: &str = "openclaw-gateway-device-identity.json";
const OPENCLAW_GATEWAY_CONNECT_TIMEOUT_SECS: u64 = 20;
const OPENCLAW_GATEWAY_REQUEST_TIMEOUT_SECS: u64 = 90;
const OPENCLAW_GATEWAY_PENDING_RUN_TTL_MS: u64 = 3 * 60 * 1000;
const OPENCLAW_GATEWAY_CLIENT_ID: &str = "gateway-client";
const OPENCLAW_GATEWAY_CLIENT_MODE: &str = "backend";
const OPENCLAW_GATEWAY_ROLE: &str = "operator";
const OPENCLAW_GATEWAY_VERSION: &str = "desktop-shell";
const OPENCLAW_GATEWAY_PROTOCOL_VERSION: i64 = 3;
const OPENCLAW_GATEWAY_SCOPES: &[&str] = &[
    "operator.admin",
    "operator.read",
    "operator.write",
    "operator.approvals",
    "operator.pairing",
];
const OPENCLAW_GATEWAY_CAPS: &[&str] = &["tool-events"];

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct PairBackendMessage {
    pub id: String,
    pub from: String,
    pub text: String,
    pub ts: u64,
    #[serde(default)]
    pub kind: String,
    #[serde(default)]
    pub after: Vec<String>,
    #[serde(default)]
    pub missing_after: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct PairBackendCapabilities {
    #[serde(default)]
    pub protocol_version: String,
    #[serde(default)]
    pub supported_messages: Vec<String>,
    #[serde(default)]
    pub features: Vec<String>,
    #[serde(default)]
    pub app_id: String,
    #[serde(default)]
    pub app_version: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct PairBackendChannel {
    pub channel_id: String,
    pub session_id: String,
    pub mobile_id: String,
    pub mobile_name: String,
    pub binding_id: String,
    pub status: String,
    pub trust_state: String,
    pub created_at: u64,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub approved_at: Option<u64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub safety_code: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub device_public_key: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub mobile_public_key: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub session_nonce: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub qr_payload: Option<Value>,
    #[serde(default)]
    pub peer_state: String,
    #[serde(default)]
    pub peer_detail: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub peer_capabilities: Option<PairBackendCapabilities>,
    #[serde(default)]
    pub messages: Vec<PairBackendMessage>,
    #[serde(default)]
    pub missing_message_ids: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct PairBackendSnapshot {
    pub configured_server_url: String,
    pub configured_device_id: String,
    pub channel_open: bool,
    pub desired_connected: bool,
    pub connection_state: String,
    pub status_message: String,
    pub status_type: String,
    pub event_log: String,
    pub channels: Vec<PairBackendChannel>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
struct PairIdentityRecord {
    pub entity_id: String,
    pub public_key: String,
    pub private_key: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct PairChallenge {
    challenge_id: String,
    entity_type: String,
    entity_id: String,
    public_key: String,
    nonce: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct PairAuthSession {
    session_id: String,
    token: String,
    entity_type: String,
    entity_id: String,
    public_key: String,
    created_at: u64,
    updated_at: u64,
    expires_at: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct PairBinding {
    binding_id: String,
    pair_session_id: String,
    device_id: String,
    device_public_key: String,
    mobile_id: String,
    #[serde(default)]
    mobile_name: String,
    mobile_public_key: String,
    trust_state: String,
    created_at: u64,
    updated_at: u64,
    approved_at: Option<u64>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct PairSessionRecord {
    pair_session_id: String,
    device_id: String,
    device_public_key: String,
    claim_token: String,
    session_nonce: String,
    status: String,
    created_at: u64,
    updated_at: u64,
    expires_at: u64,
    claimed_mobile_id: Option<String>,
    binding_id: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct PairQrPayload {
    version: String,
    server_base_url: String,
    pair_session_id: String,
    claim_token: String,
    device_id: String,
    device_pubkey: String,
    session_nonce: String,
    expires_at: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
struct PairIceServerPayload {
    #[serde(default)]
    urls: Vec<String>,
    #[serde(default)]
    username: String,
    #[serde(default)]
    credential: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
struct PairSignalEnvelope {
    #[serde(default)]
    id: String,
    #[serde(default)]
    r#type: String,
    #[serde(default)]
    ts: u64,
    #[serde(default)]
    from: Option<PairSignalParty>,
    #[serde(default)]
    payload: Option<Value>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
struct PairSignalParty {
    #[serde(default)]
    r#type: String,
    #[serde(default)]
    id: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
struct PairSignalPayload {
    #[serde(default)]
    binding_id: String,
    #[serde(default)]
    mobile_id: String,
    #[serde(default)]
    description: Option<PairSessionDescriptionPayload>,
    #[serde(default)]
    candidate: Option<RTCIceCandidateInit>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
struct PairSessionDescriptionPayload {
    #[serde(rename = "type", default)]
    sdp_type: String,
    #[serde(default)]
    sdp: String,
}

#[derive(Debug, Clone)]
struct CachedIceServers {
    ice_servers: Vec<RTCIceServer>,
    expires_at: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
struct GatewayDeviceIdentityRecord {
    device_id: String,
    public_key: String,
    private_key: String,
}

#[derive(Debug, Clone)]
struct PendingOpenClawRun {
    run_id: String,
    binding_id: String,
    mobile_id: String,
    session_key: String,
    prefer_relay_reply: bool,
    buffered_text: String,
    awaiting_followup_run: bool,
    last_event_at: u64,
}

#[derive(Debug, Clone)]
struct PendingMobileAck {
    message_id: String,
    binding_id: String,
    mobile_id: String,
    payload: Value,
    prefer_relay: bool,
    attempts: u8,
}

struct DesktopPeer {
    binding_id: String,
    mobile_id: String,
    peer: Arc<RTCPeerConnection>,
    data_channel: Arc<Mutex<Option<Arc<RTCDataChannel>>>>,
    pending_remote_candidates: Arc<Mutex<Vec<RTCIceCandidateInit>>>,
    hello_sent: Arc<Mutex<bool>>,
    remote_verified: Arc<Mutex<bool>>,
    capabilities_sent: Arc<Mutex<bool>>,
}

struct PairBackendState {
    app: Option<AppHandle>,
    configured_server_url: String,
    configured_device_id: String,
    channel_open: bool,
    desired_connected: bool,
    connection_state: String,
    status_message: String,
    status_type: String,
    event_lines: Vec<String>,
    channels: Vec<PairBackendChannel>,
    identity: Option<PairIdentityRecord>,
    auth_session: Option<PairAuthSession>,
    auth_base_url: String,
    reconnect_attempts: u32,
    connect_generation: u64,
    sse_task: Option<JoinHandle<()>>,
    heartbeat_task: Option<JoinHandle<()>>,
    reconnect_task: Option<JoinHandle<()>>,
    ice_cache: HashMap<String, CachedIceServers>,
    peers: HashMap<String, Arc<DesktopPeer>>,
    pending_remote_candidates: HashMap<String, Vec<RTCIceCandidateInit>>,
    gateway_identity: Option<GatewayDeviceIdentityRecord>,
    gateway_connected: bool,
    gateway_connecting: bool,
    gateway_generation: u64,
    gateway_writer_tx: Option<mpsc::UnboundedSender<WsMessage>>,
    gateway_reader_task: Option<JoinHandle<()>>,
    gateway_writer_task: Option<JoinHandle<()>>,
    gateway_pending_requests: HashMap<String, oneshot::Sender<Result<Value, String>>>,
    gateway_pending_runs: HashMap<String, PendingOpenClawRun>,
    gateway_pending_run_aliases: HashMap<String, String>,
    pending_mobile_acks: HashMap<String, PendingMobileAck>,
}

impl Default for PairBackendState {
    fn default() -> Self {
        Self {
            app: None,
            configured_server_url: String::new(),
            configured_device_id: String::new(),
            channel_open: false,
            desired_connected: false,
            connection_state: "disconnected".to_string(),
            status_message: String::new(),
            status_type: String::new(),
            event_lines: vec![PAIR_LOG_PREFIX.to_string()],
            channels: Vec::new(),
            identity: None,
            auth_session: None,
            auth_base_url: String::new(),
            reconnect_attempts: 0,
            connect_generation: 0,
            sse_task: None,
            heartbeat_task: None,
            reconnect_task: None,
            ice_cache: HashMap::new(),
            peers: HashMap::new(),
            pending_remote_candidates: HashMap::new(),
            gateway_identity: None,
            gateway_connected: false,
            gateway_connecting: false,
            gateway_generation: 0,
            gateway_writer_tx: None,
            gateway_reader_task: None,
            gateway_writer_task: None,
            gateway_pending_requests: HashMap::new(),
            gateway_pending_runs: HashMap::new(),
            gateway_pending_run_aliases: HashMap::new(),
            pending_mobile_acks: HashMap::new(),
        }
    }
}

#[derive(Clone)]
pub struct PairBackendHandle {
    http: Client,
    api: Arc<webrtc::api::API>,
    state: Arc<Mutex<PairBackendState>>,
    gateway_connect_lock: Arc<Mutex<()>>,
}

impl PairBackendHandle {
    pub fn new() -> Result<Self, String> {
        let http = Client::builder()
            .use_rustls_tls()
            .build()
            .map_err(|e| format!("创建配对 HTTP 客户端失败: {}", e))?;
        let mut media_engine = MediaEngine::default();
        media_engine
            .register_default_codecs()
            .map_err(|e| format!("初始化 WebRTC 编解码器失败: {}", e))?;
        let api = Arc::new(APIBuilder::new().with_media_engine(media_engine).build());
        Ok(Self {
            http,
            api,
            state: Arc::new(Mutex::new(PairBackendState::default())),
            gateway_connect_lock: Arc::new(Mutex::new(())),
        })
    }

    async fn set_app_handle(&self, app: AppHandle) {
        let mut state = self.state.lock().await;
        state.app = Some(app);
    }

    async fn emit_snapshot(&self) {
        let (app, snapshot) = {
            let state = self.state.lock().await;
            (state.app.clone(), self.snapshot_from_state(&state))
        };
        if let Some(app_handle) = app {
            let _ = app_handle.emit_all(PAIR_EVENT_NAME, snapshot);
        }
    }

    fn snapshot_from_state(&self, state: &PairBackendState) -> PairBackendSnapshot {
        PairBackendSnapshot {
            configured_server_url: state.configured_server_url.clone(),
            configured_device_id: state.configured_device_id.clone(),
            channel_open: state.channel_open,
            desired_connected: state.desired_connected,
            connection_state: state.connection_state.clone(),
            status_message: state.status_message.clone(),
            status_type: state.status_type.clone(),
            event_log: state.event_lines.join("\n"),
            channels: state.channels.clone(),
        }
    }

    async fn append_event(&self, line: impl Into<String>) {
        let next = {
            let message = line.into();
            let stamp = Local::now().format("%Y/%-m/%-d %H:%M:%S").to_string();
            format!("[{}] [rust] {}", stamp, message)
        };
        eprintln!("{}", next);
        let app = {
            let state = self.state.lock().await;
            state.app.clone()
        };
        if let Some(app_handle) = app {
            let _ = Self::append_event_to_file(&app_handle, &next);
        }
        {
            let mut state = self.state.lock().await;
            state.event_lines.push(next);
            if state.event_lines.len() > 400 {
                let keep_from = state.event_lines.len().saturating_sub(400);
                state.event_lines = state.event_lines.split_off(keep_from);
            }
        }
        self.emit_snapshot().await;
    }

    fn append_event_to_file(app: &AppHandle, line: &str) -> Result<(), String> {
        let path = app_config_dir(app)?.join(PAIR_LOG_FILE_NAME);
        let mut file = std::fs::OpenOptions::new()
            .create(true)
            .append(true)
            .open(&path)
            .map_err(|e| format!("打开 Pair 日志失败 ({}): {}", path.display(), e))?;
        writeln!(file, "{}", line)
            .map_err(|e| format!("写入 Pair 日志失败 ({}): {}", path.display(), e))?;
        Ok(())
    }

    async fn set_channel_open_state(&self, open: bool, desired: bool) {
        {
            let mut state = self.state.lock().await;
            state.channel_open = open;
            state.desired_connected = desired;
        }
        self.emit_snapshot().await;
    }

    fn now_ms() -> u64 {
        SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .map(|v| v.as_millis() as u64)
            .unwrap_or(0)
    }

    fn random_id(prefix: &str) -> String {
        format!("{}_{}{:08x}", prefix, Self::now_ms(), rand::random::<u32>())
    }

    fn normalize_base_url(raw: &str) -> Result<String, String> {
        let text = raw.trim();
        if text.is_empty() {
            return Err("服务端地址不能为空".to_string());
        }
        let with_protocol = if text.contains("://") {
            text.to_string()
        } else {
            format!("http://{}", text)
        };
        let mut parsed =
            url::Url::parse(&with_protocol).map_err(|e| format!("服务端地址格式无效: {}", e))?;
        match parsed.scheme() {
            "http" | "https" => {}
            _ => return Err("服务端地址必须是 http/https".to_string()),
        }
        parsed.set_fragment(None);
        parsed.set_query(None);
        let path = parsed.path().trim_end_matches('/').to_string();
        parsed.set_path(&path);
        Ok(parsed.to_string().trim_end_matches('/').to_string())
    }

    fn pair_identity_path(app: &AppHandle) -> Result<std::path::PathBuf, String> {
        let dir = super::app_config_dir(app)?.join("pairing");
        std::fs::create_dir_all(&dir).map_err(|e| format!("创建配对目录失败: {}", e))?;
        Ok(dir.join(PAIR_IDENTITY_FILE_NAME))
    }
}

mod auth;
mod bridge;
mod chat;
mod helpers;
mod signal;
use helpers::*;
pub mod commands;

pub use commands::*;
