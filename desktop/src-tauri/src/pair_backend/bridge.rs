use super::*;
use crate::dashboard_gateway::resolve_gateway_connection_info;
use futures_util::StreamExt;
use serde_json::{Map, Value};
use tokio::time::timeout;
use tokio_tungstenite::connect_async;
use tokio_tungstenite::tungstenite::client::IntoClientRequest;
use tokio_tungstenite::tungstenite::http::header::ORIGIN;
use tokio_tungstenite::tungstenite::http::HeaderValue;

#[derive(Debug, Clone)]
struct OpenClawTranscriptEntry {
    gateway_message_id: String,
    gateway_message_seq: u64,
    role: String,
    text: String,
    ts: u64,
}

impl PairBackendHandle {
    fn gateway_identity_path(app: &AppHandle) -> Result<std::path::PathBuf, String> {
        let dir = crate::app_config_dir(app)?.join("pairing");
        std::fs::create_dir_all(&dir).map_err(|e| format!("创建网关身份目录失败: {}", e))?;
        Ok(dir.join(OPENCLAW_GATEWAY_IDENTITY_FILE_NAME))
    }

    pub(super) async fn load_or_create_gateway_identity(
        &self,
        app: &AppHandle,
    ) -> Result<GatewayDeviceIdentityRecord, String> {
        let cached = {
            let state = self.state.lock().await;
            state.gateway_identity.clone()
        };
        if let Some(identity) = cached {
            if !identity.device_id.trim().is_empty()
                && !identity.public_key.trim().is_empty()
                && !identity.private_key.trim().is_empty()
            {
                return Ok(identity);
            }
        }

        let path = Self::gateway_identity_path(app)?;
        if path.exists() {
            let raw = std::fs::read_to_string(&path)
                .map_err(|e| format!("读取 OpenClaw gateway 身份失败: {}", e))?;
            let mut identity: GatewayDeviceIdentityRecord = serde_json::from_str(&raw)
                .map_err(|e| format!("解析 OpenClaw gateway 身份失败: {}", e))?;
            if identity.device_id.trim().is_empty() && !identity.public_key.trim().is_empty() {
                let public_key_bytes = URL_SAFE_NO_PAD
                    .decode(identity.public_key.trim())
                    .map_err(|e| format!("解析 OpenClaw gateway 公钥失败: {}", e))?;
                identity.device_id = hex::encode(Sha256::digest(public_key_bytes));
            }
            {
                let mut state = self.state.lock().await;
                state.gateway_identity = Some(identity.clone());
            }
            return Ok(identity);
        }

        let signing_key = SigningKey::generate(&mut OsRng);
        let public_key_bytes = signing_key.verifying_key().as_bytes().to_vec();
        let identity = GatewayDeviceIdentityRecord {
            device_id: hex::encode(Sha256::digest(&public_key_bytes)),
            public_key: URL_SAFE_NO_PAD.encode(public_key_bytes),
            private_key: URL_SAFE_NO_PAD.encode(signing_key.to_bytes()),
        };
        let serialized = serde_json::to_string_pretty(&identity)
            .map_err(|e| format!("序列化 OpenClaw gateway 身份失败: {}", e))?;
        std::fs::write(&path, serialized)
            .map_err(|e| format!("写入 OpenClaw gateway 身份失败: {}", e))?;
        {
            let mut state = self.state.lock().await;
            state.gateway_identity = Some(identity.clone());
        }
        Ok(identity)
    }

    fn normalize_gateway_auth_metadata(value: &str) -> String {
        value.trim().to_ascii_lowercase()
    }

    fn build_gateway_device_auth_payload_v3(
        identity: &GatewayDeviceIdentityRecord,
        signed_at: u64,
        nonce: &str,
        token: Option<&str>,
    ) -> String {
        let platform = Self::normalize_gateway_auth_metadata(std::env::consts::OS);
        let device_family = Self::normalize_gateway_auth_metadata("desktop");
        [
            "v3".to_string(),
            identity.device_id.trim().to_string(),
            OPENCLAW_GATEWAY_CLIENT_ID.to_string(),
            OPENCLAW_GATEWAY_CLIENT_MODE.to_string(),
            OPENCLAW_GATEWAY_ROLE.to_string(),
            OPENCLAW_GATEWAY_SCOPES.join(","),
            signed_at.to_string(),
            token.unwrap_or_default().trim().to_string(),
            nonce.trim().to_string(),
            platform,
            device_family,
        ]
        .join("|")
    }

    pub(super) fn build_openclaw_mobile_session_key(mobile_id: &str) -> String {
        let normalized = mobile_id.trim().to_ascii_lowercase();
        if normalized.is_empty() {
            return String::new();
        }
        format!("agent:main:openclaw-mobile:direct:{}", normalized)
    }

    fn normalize_openclaw_session_key(value: &str) -> String {
        value.trim().to_ascii_lowercase()
    }

    fn normalize_openclaw_gateway_message_id(value: &str) -> String {
        value.trim().to_string()
    }

    fn channel_matches_openclaw_session_key(
        channel: &PairBackendChannel,
        session_key: &str,
    ) -> bool {
        let normalized_session_key = Self::normalize_openclaw_session_key(session_key);
        if normalized_session_key.is_empty() {
            return false;
        }
        Self::normalize_openclaw_session_key(&Self::build_openclaw_mobile_session_key(
            &channel.mobile_id,
        )) == normalized_session_key
    }

    fn extract_openclaw_message_text(value: &Value) -> String {
        if let Some(text) = value.get("text").and_then(Value::as_str) {
            let trimmed = text.trim();
            if !trimmed.is_empty() {
                return trimmed.to_string();
            }
        }
        if let Some(text) = value.get("content").and_then(Value::as_str) {
            let trimmed = text.trim();
            if !trimmed.is_empty() {
                return trimmed.to_string();
            }
        }
        value
            .get("content")
            .and_then(Value::as_array)
            .cloned()
            .unwrap_or_default()
            .into_iter()
            .filter_map(|item| {
                let object = item.as_object()?;
                if object.get("type").and_then(Value::as_str) != Some("text") {
                    return None;
                }
                object
                    .get("text")
                    .and_then(Value::as_str)
                    .map(str::trim)
                    .filter(|text| !text.is_empty())
                    .map(ToString::to_string)
            })
            .collect::<Vec<_>>()
            .join("\n")
            .trim()
            .to_string()
    }

    fn extract_openclaw_request_id(value: &str) -> String {
        let tail = value
            .split("request ID")
            .nth(1)
            .map(str::trim)
            .unwrap_or_default();
        tail.split_whitespace()
            .next()
            .unwrap_or_default()
            .trim_matches(|ch: char| matches!(ch, '.' | '。' | ',' | '，' | ':' | '：'))
            .to_string()
    }

    fn build_openclaw_mobile_error_text(error_message: &str) -> String {
        let normalized = error_message.trim().to_lowercase();
        let request_id = Self::extract_openclaw_request_id(error_message);
        if normalized.contains("403") {
            if !request_id.is_empty() {
                return format!(
                    "OpenClaw 上游返回 403，请检查桌面端 OpenClaw 配置（API Key / Base URL / 模型权限）。request id: {}",
                    request_id
                );
            }
            return "OpenClaw 上游返回 403，请检查桌面端 OpenClaw 配置（API Key / Base URL / 模型权限）。"
                .to_string();
        }
        if !request_id.is_empty() {
            return format!("OpenClaw 处理失败，请重试。request id: {}", request_id);
        }
        "OpenClaw 处理失败，请重试。".to_string()
    }

    fn extract_openclaw_chat_event_text(payload: &Value) -> String {
        for key in [
            "message",
            "delta",
            "messageDelta",
            "contentDelta",
            "textDelta",
        ] {
            if let Some(value) = payload.get(key) {
                let text = Self::extract_openclaw_message_text(value);
                if !text.is_empty() {
                    return text;
                }
                if let Some(text) = value.as_str().map(str::trim).filter(|text| !text.is_empty()) {
                    return text.to_string();
                }
            }
        }

        if let Some(text) = payload
            .get("outputText")
            .and_then(Value::as_str)
            .map(str::trim)
            .filter(|text| !text.is_empty())
        {
            return text.to_string();
        }

        Self::extract_openclaw_message_text(payload)
    }

    fn extract_openclaw_transcript_message_id(value: &Value) -> String {
        value
            .get("__openclaw")
            .and_then(Value::as_object)
            .and_then(|meta| meta.get("id"))
            .and_then(Value::as_str)
            .or_else(|| value.get("id").and_then(Value::as_str))
            .or_else(|| value.get("messageId").and_then(Value::as_str))
            .map(Self::normalize_openclaw_gateway_message_id)
            .unwrap_or_default()
    }

    fn extract_openclaw_transcript_message_seq(value: &Value, fallback_seq: u64) -> u64 {
        value
            .get("__openclaw")
            .and_then(Value::as_object)
            .and_then(|meta| meta.get("seq"))
            .and_then(Value::as_u64)
            .unwrap_or(fallback_seq)
    }

    fn extract_openclaw_transcript_message_role(value: &Value) -> String {
        value
            .get("role")
            .and_then(Value::as_str)
            .map(|role| role.trim().to_ascii_lowercase())
            .unwrap_or_default()
    }

    fn parse_openclaw_transcript_entry(
        value: &Value,
        fallback_seq: u64,
    ) -> Option<OpenClawTranscriptEntry> {
        let role = Self::extract_openclaw_transcript_message_role(value);
        if role != "user" && role != "assistant" {
            return None;
        }
        let text = Self::extract_openclaw_message_text(value);
        if text.trim().is_empty() {
            return None;
        }
        if role == "assistant" && text.trim().eq_ignore_ascii_case("NO_REPLY") {
            return None;
        }
        let gateway_message_id = Self::extract_openclaw_transcript_message_id(value);
        if gateway_message_id.is_empty() {
            return None;
        }
        let ts = value
            .get("timestamp")
            .and_then(Value::as_u64)
            .unwrap_or_else(Self::now_ms);
        Some(OpenClawTranscriptEntry {
            gateway_message_id,
            gateway_message_seq: Self::extract_openclaw_transcript_message_seq(
                value,
                fallback_seq,
            ),
            role,
            text,
            ts,
        })
    }

    fn build_openclaw_transcript_pair_message_id(entry: &OpenClawTranscriptEntry) -> String {
        format!("ocgw_{}", entry.gateway_message_id.trim())
    }

    fn annotate_channel_message_with_transcript_meta(
        message: &mut PairBackendMessage,
        entry: &OpenClawTranscriptEntry,
    ) {
        message.gateway_message_id = entry.gateway_message_id.clone();
        message.gateway_message_seq = entry.gateway_message_seq;
    }

    fn find_channel_message_for_transcript_entry(
        channel: &PairBackendChannel,
        entry: &OpenClawTranscriptEntry,
    ) -> Option<usize> {
        let normalized_text = entry.text.trim();
        if normalized_text.is_empty() {
            return None;
        }
        let max_delta_ms = 2 * 60 * 1000;
        channel
            .messages
            .iter()
            .enumerate()
            .filter(|(_, message)| Self::normalize_chat_message_kind(&message.kind) != "system")
            .filter(|(_, message)| message.gateway_message_id.trim().is_empty())
            .filter(|(_, message)| message.text.trim() == normalized_text)
            .filter(|(_, message)| match entry.role.as_str() {
                "user" => message.origin.trim() == "mobile",
                "assistant" => {
                    message.origin.trim() == "host"
                        && matches!(message.from.trim(), "agent" | "assistant")
                }
                _ => false,
            })
            .filter(|(_, message)| message.ts.abs_diff(entry.ts) <= max_delta_ms)
            .min_by_key(|(_, message)| message.ts.abs_diff(entry.ts))
            .map(|(index, _)| index)
    }

    fn merge_openclaw_reply_text(existing: &str, next: &str) -> String {
        let existing = existing.trim();
        let next = next.trim();
        if existing.is_empty() {
            return next.to_string();
        }
        if next.is_empty() {
            return existing.to_string();
        }
        if existing == next {
            return existing.to_string();
        }
        if next.starts_with(existing) || next.contains(existing) {
            return next.to_string();
        }
        if existing.starts_with(next) || existing.contains(next) {
            return existing.to_string();
        }
        format!("{}{}", existing, next)
    }

    fn remove_pending_openclaw_run_locked(state: &mut PairBackendState, primary_run_id: &str) {
        state.gateway_pending_runs.remove(primary_run_id);
        state
            .gateway_pending_run_aliases
            .retain(|alias_run_id, mapped_primary| {
                alias_run_id != primary_run_id && mapped_primary != primary_run_id
            });
    }

    fn prune_pending_openclaw_runs_locked(state: &mut PairBackendState) {
        let cutoff = Self::now_ms().saturating_sub(OPENCLAW_GATEWAY_PENDING_RUN_TTL_MS);
        let expired = state
            .gateway_pending_runs
            .iter()
            .filter_map(|(primary_run_id, pending)| {
                (pending.last_event_at <= cutoff).then_some(primary_run_id.clone())
            })
            .collect::<Vec<_>>();
        for primary_run_id in expired {
            Self::remove_pending_openclaw_run_locked(state, &primary_run_id);
        }
    }

    async fn resolve_pending_openclaw_run(
        &self,
        run_id: &str,
        session_key: &str,
    ) -> Option<(String, PendingOpenClawRun, bool)> {
        let normalized_session_key = Self::normalize_openclaw_session_key(session_key);
        let mut state = self.state.lock().await;
        Self::prune_pending_openclaw_runs_locked(&mut state);

        if let Some(primary_run_id) = state.gateway_pending_run_aliases.get(run_id).cloned() {
            if let Some(pending) = state.gateway_pending_runs.get(&primary_run_id).cloned() {
                return Some((primary_run_id, pending, false));
            }
            state.gateway_pending_run_aliases.remove(run_id);
        }

        if let Some(pending) = state.gateway_pending_runs.get(run_id).cloned() {
            return Some((run_id.to_string(), pending, false));
        }

        if normalized_session_key.is_empty() {
            return None;
        }

        let mut waiting_followup = Vec::new();
        let mut same_session = Vec::new();
        for (primary_run_id, pending) in state.gateway_pending_runs.iter() {
            if Self::normalize_openclaw_session_key(&pending.session_key) != normalized_session_key {
                continue;
            }
            same_session.push((primary_run_id.clone(), pending.clone()));
            if pending.awaiting_followup_run {
                waiting_followup.push((primary_run_id.clone(), pending.clone()));
            }
        }

        let selected = if waiting_followup.len() == 1 {
            waiting_followup.into_iter().next()
        } else if waiting_followup.len() > 1 {
            waiting_followup
                .into_iter()
                .min_by_key(|(_, pending)| pending.last_event_at)
        } else if same_session.len() == 1 {
            same_session.into_iter().next()
        } else {
            None
        };

        let (primary_run_id, _) = selected?;
        state
            .gateway_pending_run_aliases
            .insert(run_id.to_string(), primary_run_id.clone());
        let pending = if let Some(entry) = state.gateway_pending_runs.get_mut(&primary_run_id) {
            entry.awaiting_followup_run = false;
            entry.last_event_at = Self::now_ms();
            entry.clone()
        } else {
            return None;
        };
        Some((primary_run_id, pending, true))
    }

    async fn finish_gateway_connect_failure(&self, _detail: &str) {
        let mut state = self.state.lock().await;
        state.gateway_connecting = false;
        state.gateway_connected = false;
    }

    pub(super) async fn ensure_openclaw_gateway_ready(
        &self,
        app: &AppHandle,
    ) -> Result<(), String> {
        let _connect_guard = self.gateway_connect_lock.lock().await;
        let (already_connected, should_reset) = {
            let state = self.state.lock().await;
            (
                state.gateway_connected && state.gateway_writer_tx.is_some(),
                state.gateway_writer_tx.is_some()
                    || state.gateway_reader_task.is_some()
                    || state.gateway_writer_task.is_some(),
            )
        };
        if already_connected {
            return Ok(());
        }
        if should_reset {
            self.disconnect_openclaw_gateway("reconnecting").await;
        }

        {
            let mut state = self.state.lock().await;
            state.gateway_connecting = true;
            state.gateway_connected = false;
            state.gateway_generation = state.gateway_generation.saturating_add(1);
        }

        self.append_event("openclaw gateway connecting").await;
        let info = match resolve_gateway_connection_info(app.clone()) {
            Ok(value) => value,
            Err(error) => {
                self.finish_gateway_connect_failure(&error).await;
                return Err(error);
            }
        };
        self.append_event(format!("openclaw gateway ws -> {}", info.ws_url))
            .await;
        let identity = match self.load_or_create_gateway_identity(app).await {
            Ok(value) => value,
            Err(error) => {
                self.finish_gateway_connect_failure(&error).await;
                return Err(error);
            }
        };
        let generation = {
            let state = self.state.lock().await;
            state.gateway_generation
        };

        let mut request = info
            .ws_url
            .clone()
            .into_client_request()
            .map_err(|e| format!("构造 OpenClaw gateway 请求失败: {}", e))?;
        request
            .headers_mut()
            .insert(ORIGIN, HeaderValue::from_static("http://tauri.localhost"));

        let stream = match timeout(
            Duration::from_secs(OPENCLAW_GATEWAY_CONNECT_TIMEOUT_SECS),
            connect_async(request),
        )
        .await
        {
            Ok(Ok((stream, _response))) => stream,
            Ok(Err(error)) => {
                let detail = format!("连接 OpenClaw gateway 失败: {}", error);
                self.finish_gateway_connect_failure(&detail).await;
                return Err(detail);
            }
            Err(_) => {
                let detail = "连接 OpenClaw gateway 超时".to_string();
                self.finish_gateway_connect_failure(&detail).await;
                return Err(detail);
            }
        };

        let (mut gateway_write, mut gateway_read) = stream.split();

        let challenge_nonce = loop {
            let incoming = match timeout(
                Duration::from_secs(OPENCLAW_GATEWAY_CONNECT_TIMEOUT_SECS),
                gateway_read.next(),
            )
            .await
            {
                Ok(Some(Ok(message))) => message,
                Ok(Some(Err(error))) => {
                    let detail = format!("读取 OpenClaw gateway challenge 失败: {}", error);
                    self.finish_gateway_connect_failure(&detail).await;
                    return Err(detail);
                }
                Ok(None) => {
                    let detail = "OpenClaw gateway 在握手前关闭".to_string();
                    self.finish_gateway_connect_failure(&detail).await;
                    return Err(detail);
                }
                Err(_) => {
                    let detail = "等待 OpenClaw gateway challenge 超时".to_string();
                    self.finish_gateway_connect_failure(&detail).await;
                    return Err(detail);
                }
            };

            match incoming {
                WsMessage::Text(text) => {
                    let frame: Value = match serde_json::from_str(&text) {
                        Ok(value) => value,
                        Err(_) => continue,
                    };
                    if read_json_string(&frame, &["type"]) != "event"
                        || read_json_string(&frame, &["event"]) != "connect.challenge"
                    {
                        continue;
                    }
                    let nonce = frame
                        .get("payload")
                        .and_then(Value::as_object)
                        .and_then(|payload| payload.get("nonce"))
                        .and_then(Value::as_str)
                        .unwrap_or_default()
                        .trim()
                        .to_string();
                    if nonce.is_empty() {
                        let detail = "OpenClaw gateway challenge 缺少 nonce".to_string();
                        self.finish_gateway_connect_failure(&detail).await;
                        return Err(detail);
                    }
                    break nonce;
                }
                WsMessage::Binary(data) => {
                    let text = match String::from_utf8(data) {
                        Ok(value) => value,
                        Err(_) => continue,
                    };
                    let frame: Value = match serde_json::from_str(&text) {
                        Ok(value) => value,
                        Err(_) => continue,
                    };
                    if read_json_string(&frame, &["type"]) != "event"
                        || read_json_string(&frame, &["event"]) != "connect.challenge"
                    {
                        continue;
                    }
                    let nonce = frame
                        .get("payload")
                        .and_then(Value::as_object)
                        .and_then(|payload| payload.get("nonce"))
                        .and_then(Value::as_str)
                        .unwrap_or_default()
                        .trim()
                        .to_string();
                    if nonce.is_empty() {
                        let detail = "OpenClaw gateway challenge 缺少 nonce".to_string();
                        self.finish_gateway_connect_failure(&detail).await;
                        return Err(detail);
                    }
                    break nonce;
                }
                WsMessage::Ping(payload) => {
                    let _ = gateway_write.send(WsMessage::Pong(payload)).await;
                }
                WsMessage::Close(frame) => {
                    let reason = frame
                        .as_ref()
                        .map(|close| close.reason.to_string())
                        .unwrap_or_else(|| "gateway closed".to_string());
                    let detail = format!("OpenClaw gateway 提前关闭: {}", reason);
                    self.finish_gateway_connect_failure(&detail).await;
                    return Err(detail);
                }
                _ => {}
            }
        };

        let signed_at = Self::now_ms();
        let signature = match Self::sign_text(
            &identity.private_key,
            &Self::build_gateway_device_auth_payload_v3(
                &identity,
                signed_at,
                &challenge_nonce,
                info.token.as_deref(),
            ),
        ) {
            Ok(value) => value,
            Err(error) => {
                self.finish_gateway_connect_failure(&error).await;
                return Err(error);
            }
        };

        let connect_request_id = Self::random_id("ocgw_connect");
        let mut client_map = Map::new();
        client_map.insert(
            "id".to_string(),
            Value::String(OPENCLAW_GATEWAY_CLIENT_ID.to_string()),
        );
        client_map.insert(
            "version".to_string(),
            Value::String(OPENCLAW_GATEWAY_VERSION.to_string()),
        );
        client_map.insert(
            "platform".to_string(),
            Value::String(std::env::consts::OS.to_string()),
        );
        client_map.insert(
            "deviceFamily".to_string(),
            Value::String("desktop".to_string()),
        );
        client_map.insert(
            "mode".to_string(),
            Value::String(OPENCLAW_GATEWAY_CLIENT_MODE.to_string()),
        );
        client_map.insert(
            "instanceId".to_string(),
            Value::String(Self::random_id("ocgwinst")),
        );

        let mut params = Map::new();
        params.insert(
            "minProtocol".to_string(),
            Value::Number(OPENCLAW_GATEWAY_PROTOCOL_VERSION.into()),
        );
        params.insert(
            "maxProtocol".to_string(),
            Value::Number(OPENCLAW_GATEWAY_PROTOCOL_VERSION.into()),
        );
        params.insert("client".to_string(), Value::Object(client_map));
        params.insert(
            "caps".to_string(),
            Value::Array(
                OPENCLAW_GATEWAY_CAPS
                    .iter()
                    .map(|value| Value::String((*value).to_string()))
                    .collect(),
            ),
        );
        params.insert(
            "role".to_string(),
            Value::String(OPENCLAW_GATEWAY_ROLE.to_string()),
        );
        params.insert(
            "scopes".to_string(),
            Value::Array(
                OPENCLAW_GATEWAY_SCOPES
                    .iter()
                    .map(|value| Value::String((*value).to_string()))
                    .collect(),
            ),
        );
        params.insert(
            "device".to_string(),
            serde_json::json!({
                "id": identity.device_id,
                "publicKey": identity.public_key,
                "signature": signature,
                "signedAt": signed_at,
                "nonce": challenge_nonce,
            }),
        );
        params.insert(
            "userAgent".to_string(),
            Value::String(format!("openclaw-desktop/{}", app.package_info().version)),
        );
        if let Ok(lang) = std::env::var("LANG") {
            let trimmed = lang.trim();
            if !trimmed.is_empty() {
                params.insert("locale".to_string(), Value::String(trimmed.to_string()));
            }
        }
        if let Some(token) = info
            .token
            .as_deref()
            .map(str::trim)
            .filter(|value| !value.is_empty())
        {
            params.insert(
                "auth".to_string(),
                serde_json::json!({
                    "token": token,
                }),
            );
        }

        let connect_frame = serde_json::json!({
            "type": "req",
            "id": connect_request_id,
            "method": "connect",
            "params": Value::Object(params),
        });
        gateway_write
            .send(WsMessage::Text(connect_frame.to_string()))
            .await
            .map_err(|e| format!("发送 OpenClaw gateway connect 请求失败: {}", e))?;
        self.append_event("openclaw gateway connect sent").await;

        loop {
            let incoming = match timeout(
                Duration::from_secs(OPENCLAW_GATEWAY_CONNECT_TIMEOUT_SECS),
                gateway_read.next(),
            )
            .await
            {
                Ok(Some(Ok(message))) => message,
                Ok(Some(Err(error))) => {
                    let detail = format!("读取 OpenClaw gateway connect 响应失败: {}", error);
                    self.finish_gateway_connect_failure(&detail).await;
                    return Err(detail);
                }
                Ok(None) => {
                    let detail = "OpenClaw gateway 在 connect 响应前关闭".to_string();
                    self.finish_gateway_connect_failure(&detail).await;
                    return Err(detail);
                }
                Err(_) => {
                    let detail = "等待 OpenClaw gateway connect 响应超时".to_string();
                    self.finish_gateway_connect_failure(&detail).await;
                    return Err(detail);
                }
            };

            match incoming {
                WsMessage::Text(text) => {
                    let frame: Value = match serde_json::from_str(&text) {
                        Ok(value) => value,
                        Err(_) => continue,
                    };
                    if read_json_string(&frame, &["type"]) != "res"
                        || read_json_string(&frame, &["id"]) != connect_request_id
                    {
                        continue;
                    }
                    if frame.get("ok").and_then(Value::as_bool) != Some(true) {
                        let detail = frame
                            .get("error")
                            .and_then(Value::as_object)
                            .and_then(|error| error.get("message"))
                            .and_then(Value::as_str)
                            .unwrap_or("gateway connect failed")
                            .to_string();
                        self.finish_gateway_connect_failure(&detail).await;
                        return Err(detail);
                    }
                    break;
                }
                WsMessage::Binary(data) => {
                    let text = match String::from_utf8(data) {
                        Ok(value) => value,
                        Err(_) => continue,
                    };
                    let frame: Value = match serde_json::from_str(&text) {
                        Ok(value) => value,
                        Err(_) => continue,
                    };
                    if read_json_string(&frame, &["type"]) != "res"
                        || read_json_string(&frame, &["id"]) != connect_request_id
                    {
                        continue;
                    }
                    if frame.get("ok").and_then(Value::as_bool) != Some(true) {
                        let detail = frame
                            .get("error")
                            .and_then(Value::as_object)
                            .and_then(|error| error.get("message"))
                            .and_then(Value::as_str)
                            .unwrap_or("gateway connect failed")
                            .to_string();
                        self.finish_gateway_connect_failure(&detail).await;
                        return Err(detail);
                    }
                    break;
                }
                WsMessage::Ping(payload) => {
                    let _ = gateway_write.send(WsMessage::Pong(payload)).await;
                }
                WsMessage::Close(frame) => {
                    let reason = frame
                        .as_ref()
                        .map(|close| close.reason.to_string())
                        .unwrap_or_else(|| "gateway closed".to_string());
                    let detail = format!("OpenClaw gateway 在 connect 响应时关闭: {}", reason);
                    self.finish_gateway_connect_failure(&detail).await;
                    return Err(detail);
                }
                _ => {}
            }
        }

        let (writer_tx, mut writer_rx) = mpsc::unbounded_channel::<WsMessage>();
        let writer_handle = tokio::spawn(async move {
            while let Some(message) = writer_rx.recv().await {
                if gateway_write.send(message).await.is_err() {
                    break;
                }
            }
        });

        let backend = self.clone();
        let reader_writer_tx = writer_tx.clone();
        let reader_handle = tokio::spawn(async move {
            loop {
                match gateway_read.next().await {
                    Some(Ok(WsMessage::Text(text))) => {
                        backend
                            .handle_openclaw_gateway_frame(generation, text)
                            .await;
                    }
                    Some(Ok(WsMessage::Binary(data))) => {
                        if let Ok(text) = String::from_utf8(data) {
                            backend
                                .handle_openclaw_gateway_frame(generation, text)
                                .await;
                        }
                    }
                    Some(Ok(WsMessage::Ping(payload))) => {
                        let _ = reader_writer_tx.send(WsMessage::Pong(payload));
                    }
                    Some(Ok(WsMessage::Close(frame))) => {
                        let reason = frame
                            .as_ref()
                            .map(|close| close.reason.to_string())
                            .unwrap_or_else(|| "gateway closed".to_string());
                        backend
                            .mark_openclaw_gateway_closed(generation, &reason)
                            .await;
                        break;
                    }
                    Some(Ok(_)) => {}
                    Some(Err(error)) => {
                        backend
                            .mark_openclaw_gateway_closed(
                                generation,
                                &format!("gateway read failed: {}", error),
                            )
                            .await;
                        break;
                    }
                    None => {
                        backend
                            .mark_openclaw_gateway_closed(generation, "gateway stream ended")
                            .await;
                        break;
                    }
                }
            }
        });

        {
            let mut state = self.state.lock().await;
            if state.gateway_generation != generation {
                drop(state);
                let _ = writer_tx.send(WsMessage::Close(None));
                reader_handle.abort();
                writer_handle.abort();
                return Err("OpenClaw gateway connection 已被新的连接替换".to_string());
            }
            state.gateway_connected = true;
            state.gateway_connecting = false;
            state.gateway_writer_tx = Some(writer_tx);
            state.gateway_reader_task = Some(reader_handle);
            state.gateway_writer_task = Some(writer_handle);
        }

        self.append_event("openclaw gateway connected").await;
        Ok(())
    }

    pub(super) async fn disconnect_openclaw_gateway(&self, reason: &str) {
        let (writer_tx, reader_task, writer_task, pending_requests) = {
            let mut state = self.state.lock().await;
            state.gateway_generation = state.gateway_generation.saturating_add(1);
            state.gateway_connected = false;
            state.gateway_connecting = false;
            state.gateway_pending_runs.clear();
            state.gateway_pending_run_aliases.clear();
            (
                state.gateway_writer_tx.take(),
                state.gateway_reader_task.take(),
                state.gateway_writer_task.take(),
                std::mem::take(&mut state.gateway_pending_requests),
            )
        };
        if let Some(sender) = writer_tx {
            let _ = sender.send(WsMessage::Close(None));
        }
        if let Some(handle) = reader_task {
            handle.abort();
        }
        if let Some(handle) = writer_task {
            handle.abort();
        }
        for (_, pending) in pending_requests {
            let _ = pending.send(Err(format!(
                "openclaw gateway disconnected: {}",
                value_or_dash(reason)
            )));
        }
        if !reason.trim().is_empty() {
            self.append_event(format!("openclaw gateway disconnected: {}", reason))
                .await;
        }
    }

    async fn mark_openclaw_gateway_closed(&self, generation: u64, detail: &str) {
        let (writer_task, pending_requests, had_connection) = {
            let mut state = self.state.lock().await;
            if state.gateway_generation != generation {
                return;
            }
            let had_connection = state.gateway_connected
                || state.gateway_connecting
                || state.gateway_writer_tx.is_some();
            state.gateway_connected = false;
            state.gateway_connecting = false;
            state.gateway_writer_tx = None;
            state.gateway_reader_task = None;
            state.gateway_pending_runs.clear();
            state.gateway_pending_run_aliases.clear();
            (
                state.gateway_writer_task.take(),
                std::mem::take(&mut state.gateway_pending_requests),
                had_connection,
            )
        };
        if let Some(handle) = writer_task {
            handle.abort();
        }
        for (_, pending) in pending_requests {
            let _ = pending.send(Err(format!(
                "openclaw gateway closed: {}",
                value_or_dash(detail)
            )));
        }
        if had_connection {
            self.append_event(format!("openclaw gateway idle: {}", value_or_dash(detail)))
                .await;
        }
    }

    async fn handle_openclaw_gateway_frame(&self, generation: u64, raw: String) {
        let is_current = {
            let state = self.state.lock().await;
            state.gateway_generation == generation
        };
        if !is_current {
            return;
        }

        let frame: Value = match serde_json::from_str(&raw) {
            Ok(value) => value,
            Err(_) => return,
        };
        let frame_type = read_json_string(&frame, &["type"]);
        if frame_type == "res" {
            let request_id = read_json_string(&frame, &["id"]);
            if request_id.is_empty() {
                return;
            }
            let sender = {
                let mut state = self.state.lock().await;
                state.gateway_pending_requests.remove(&request_id)
            };
            let Some(sender) = sender else {
                return;
            };
            if frame.get("ok").and_then(Value::as_bool) == Some(true) {
                let payload = frame.get("payload").cloned().unwrap_or(Value::Null);
                let _ = sender.send(Ok(payload));
            } else {
                let message = frame
                    .get("error")
                    .and_then(Value::as_object)
                    .and_then(|error| error.get("message"))
                    .and_then(Value::as_str)
                    .unwrap_or("gateway request failed")
                    .to_string();
                let _ = sender.send(Err(message));
            }
            return;
        }

        if frame_type == "event" {
            let event_name = read_json_string(&frame, &["event"]);
            if event_name == "chat" {
                let payload = frame.get("payload").cloned().unwrap_or(Value::Null);
                self.handle_openclaw_gateway_chat_event(payload).await;
                return;
            }
            if event_name == "session.message" {
                let payload = frame.get("payload").cloned().unwrap_or(Value::Null);
                let session_key = read_json_string(&payload, &["sessionKey"]);
                self.schedule_openclaw_session_history_sync(&session_key, "session.message");
            }
        }
    }

    async fn request_openclaw_gateway(
        &self,
        app: &AppHandle,
        method: &str,
        params: Value,
    ) -> Result<Value, String> {
        self.ensure_openclaw_gateway_ready(app).await?;
        let request_id = Self::random_id("ocgwreq");
        let (sender, receiver) = oneshot::channel::<Result<Value, String>>();
        let gateway_sender = {
            let mut state = self.state.lock().await;
            state
                .gateway_pending_requests
                .insert(request_id.clone(), sender);
            state.gateway_writer_tx.clone()
        }
        .ok_or_else(|| "OpenClaw gateway 未连接".to_string())?;

        let frame = serde_json::json!({
            "type": "req",
            "id": request_id,
            "method": method,
            "params": params,
        });
        if gateway_sender
            .send(WsMessage::Text(frame.to_string()))
            .is_err()
        {
            let mut state = self.state.lock().await;
            state.gateway_pending_requests.remove(&request_id);
            return Err("OpenClaw gateway 发送队列不可用".to_string());
        }

        match timeout(
            Duration::from_secs(OPENCLAW_GATEWAY_REQUEST_TIMEOUT_SECS),
            receiver,
        )
        .await
        {
            Ok(Ok(result)) => result,
            Ok(Err(_)) => Err("OpenClaw gateway 请求被中断".to_string()),
            Err(_) => {
                let mut state = self.state.lock().await;
                state.gateway_pending_requests.remove(&request_id);
                Err(format!("OpenClaw gateway 请求超时: {}", method))
            }
        }
    }

    async fn sync_openclaw_session_label_for_channel(
        &self,
        app: &AppHandle,
        channel: &PairBackendChannel,
    ) -> Result<(), String> {
        let session_key = Self::build_openclaw_mobile_session_key(&channel.mobile_id);
        if session_key.is_empty() {
            return Ok(());
        }
        let label = resolve_channel_display_name(channel);
        if label.trim().is_empty() {
            return Ok(());
        }
        let _ = self
            .request_openclaw_gateway(
                app,
                "sessions.patch",
                serde_json::json!({
                    "key": session_key,
                    "label": label,
                }),
            )
            .await?;
        Ok(())
    }

    async fn send_existing_host_message_to_mobile(
        &self,
        binding_id: &str,
        mobile_id: &str,
        message: &PairBackendMessage,
        prefer_relay: bool,
        reason: &str,
    ) {
        let payload = Self::build_openclaw_chat_payload(message, "desktop");
        let expect_ack = self
            .channel_supports_message_type(binding_id, OPENCLAW_CHAT_ACK_TYPE)
            .await;
        if expect_ack {
            self.register_pending_mobile_ack(
                binding_id,
                mobile_id,
                &message.id,
                &payload,
                prefer_relay,
            )
            .await;
        }
        match self
            .send_app_envelope_to_mobile_with_delivery(binding_id, mobile_id, payload, prefer_relay)
            .await
        {
            Ok(delivery) => {
                if expect_ack {
                    self.arm_pending_mobile_ack(
                        &message.id,
                        prefer_relay || delivery == "relay",
                    )
                    .await;
                }
                self.append_event(format!(
                    "{} -> mobile={} via={} id={}",
                    reason,
                    mobile_id,
                    delivery,
                    message.id
                ))
                .await;
            }
            Err(error) => {
                if expect_ack {
                    self.clear_pending_mobile_ack(&message.id).await;
                }
                self.append_event(format!(
                    "{} failed: mobile={} id={} error={}",
                    reason,
                    mobile_id,
                    message.id,
                    error
                ))
                .await;
            }
        }
    }

    pub(super) async fn sync_openclaw_session_history_now(
        &self,
        app: &AppHandle,
        session_key: &str,
        reason: &str,
    ) -> Result<(), String> {
        let normalized_session_key = Self::normalize_openclaw_session_key(session_key);
        if normalized_session_key.is_empty() {
            return Ok(());
        }

        let history = self
            .request_openclaw_gateway(
                app,
                "chat.history",
                serde_json::json!({
                    "sessionKey": normalized_session_key,
                    "limit": 400,
                }),
            )
            .await?;
        let transcript_entries = history
            .get("messages")
            .and_then(Value::as_array)
            .cloned()
            .unwrap_or_default()
            .into_iter()
            .enumerate()
            .filter_map(|(index, message)| {
                Self::parse_openclaw_transcript_entry(&message, index as u64 + 1)
            })
            .collect::<Vec<_>>();
        if transcript_entries.is_empty() {
            return Ok(());
        }

        let (
            binding_id,
            mobile_id,
            imported_host_messages,
            matched_existing,
            imported_count,
        ) = {
            let mut state = self.state.lock().await;
            let Some(channel) = state
                .channels
                .iter_mut()
                .find(|channel| Self::channel_matches_openclaw_session_key(channel, &normalized_session_key))
            else {
                return Ok(());
            };

            let binding_id = channel.binding_id.clone();
            let mobile_id = channel.mobile_id.clone();
            let mut imported_host_messages = Vec::<PairBackendMessage>::new();
            let mut matched_existing = 0_usize;
            let mut imported_count = 0_usize;
            let mut next_host_seq = Self::next_channel_origin_seq_locked(channel, "host");
            let mut previous_pair_id: Option<String> = None;

            for entry in transcript_entries {
                let existing_index = channel.messages.iter().position(|message| {
                    message.gateway_message_id.trim() == entry.gateway_message_id.trim()
                });
                let pair_message_id = if let Some(index) = existing_index {
                    let message = &mut channel.messages[index];
                    Self::annotate_channel_message_with_transcript_meta(message, &entry);
                    matched_existing += 1;
                    message.id.clone()
                } else if let Some(index) =
                    Self::find_channel_message_for_transcript_entry(channel, &entry)
                {
                    let message = &mut channel.messages[index];
                    Self::annotate_channel_message_with_transcript_meta(message, &entry);
                    matched_existing += 1;
                    message.id.clone()
                } else {
                    let imported_message = PairBackendMessage {
                        id: Self::build_openclaw_transcript_pair_message_id(&entry),
                        from: if entry.role == "assistant" {
                            "agent".to_string()
                        } else {
                            "desktop".to_string()
                        },
                        text: entry.text.clone(),
                        ts: entry.ts,
                        kind: "chat".to_string(),
                        origin: "host".to_string(),
                        origin_seq: next_host_seq,
                        after: previous_pair_id
                            .iter()
                            .cloned()
                            .collect::<Vec<_>>(),
                        missing_after: Vec::new(),
                        gateway_message_id: entry.gateway_message_id.clone(),
                        gateway_message_seq: entry.gateway_message_seq,
                    };
                    next_host_seq = next_host_seq.saturating_add(1);
                    imported_count += 1;
                    if entry.role == "assistant" || entry.role == "user" {
                        imported_host_messages.push(imported_message.clone());
                    }
                    let pair_message_id = imported_message.id.clone();
                    channel.messages.push(imported_message);
                    pair_message_id
                };
                previous_pair_id = Some(pair_message_id);
            }

            if channel.messages.len() > PAIR_CHANNEL_MESSAGE_LIMIT {
                let keep_from = channel
                    .messages
                    .len()
                    .saturating_sub(PAIR_CHANNEL_MESSAGE_LIMIT);
                channel.messages = channel.messages.split_off(keep_from);
            }
            Self::reconcile_channel_messages_locked(channel);
            (
                binding_id,
                mobile_id,
                imported_host_messages,
                matched_existing,
                imported_count,
            )
        };
        self.emit_snapshot().await;

        if !imported_host_messages.is_empty() && !binding_id.trim().is_empty() && !mobile_id.trim().is_empty()
        {
            for message in imported_host_messages.iter() {
                self.send_existing_host_message_to_mobile(
                    &binding_id,
                    &mobile_id,
                    message,
                    false,
                    "openclaw transcript sync",
                )
                .await;
            }
        }

        if matched_existing > 0 || imported_count > 0 {
            self.append_event(format!(
                "openclaw transcript reconciled: session={} reason={} matched={} imported={}",
                normalized_session_key,
                value_or_dash(reason),
                matched_existing,
                imported_count
            ))
            .await;
        }
        Ok(())
    }

    fn schedule_openclaw_session_history_sync(&self, session_key: &str, reason: &str) {
        let normalized_session_key = Self::normalize_openclaw_session_key(session_key);
        if normalized_session_key.is_empty() {
            return;
        }
        let reason = reason.trim().to_string();
        let backend = self.clone();
        tauri::async_runtime::spawn(async move {
            let app = {
                let mut state = backend.state.lock().await;
                let is_bound_session = state.channels.iter().any(|channel| {
                    Self::channel_matches_openclaw_session_key(channel, &normalized_session_key)
                });
                if !is_bound_session {
                    return;
                }
                let now = Self::now_ms();
                let last_sync_at = state
                    .gateway_history_sync_at
                    .get(&normalized_session_key)
                    .copied()
                    .unwrap_or(0);
                if now < last_sync_at.saturating_add(OPENCLAW_GATEWAY_HISTORY_SYNC_THROTTLE_MS) {
                    return;
                }
                state
                    .gateway_history_sync_at
                    .insert(normalized_session_key.clone(), now);
                state.app.clone()
            };
            let Some(app_handle) = app else {
                return;
            };
            if let Err(error) = backend
                .sync_openclaw_session_history_now(
                    &app_handle,
                    &normalized_session_key,
                    &reason,
                )
                .await
            {
                backend
                    .append_event(format!(
                        "openclaw transcript sync failed: session={} reason={} error={}",
                        normalized_session_key,
                        value_or_dash(&reason),
                        error
                    ))
                    .await;
            }
        });
    }

    pub(super) async fn forward_mobile_message_to_openclaw(
        &self,
        app: &AppHandle,
        binding_id: &str,
        mobile_id: &str,
        text: &str,
        source: &str,
    ) -> Result<(), String> {
        let normalized_text = text.trim();
        if normalized_text.is_empty() {
            return Ok(());
        }
        let prefer_relay_reply = source.trim() == "relay";
        self.append_event(format!(
            "forwarding mobile chat -> openclaw: mobile={} binding={} text={}",
            mobile_id, binding_id, normalized_text
        ))
        .await;
        let session_key = Self::build_openclaw_mobile_session_key(mobile_id);
        if session_key.is_empty() {
            return Err("mobile id is empty".to_string());
        }
        let channel = {
            let state = self.state.lock().await;
            state
                .channels
                .iter()
                .find(|item| {
                    (!binding_id.trim().is_empty() && item.binding_id == binding_id.trim())
                        || (!mobile_id.trim().is_empty() && item.mobile_id == mobile_id.trim())
                })
                .cloned()
        };
        if let Some(channel) = channel {
            if let Err(error) = self
                .sync_openclaw_session_label_for_channel(app, &channel)
                .await
            {
                self.append_event(format!("openclaw session label sync failed: {}", error))
                    .await;
            }
        }

        let run_id = Self::random_id("ocgwrun");
        {
            let mut state = self.state.lock().await;
            Self::prune_pending_openclaw_runs_locked(&mut state);
            state.gateway_pending_runs.insert(
                run_id.clone(),
                PendingOpenClawRun {
                    run_id: run_id.clone(),
                    binding_id: binding_id.trim().to_string(),
                    mobile_id: mobile_id.trim().to_string(),
                    session_key: session_key.clone(),
                    prefer_relay_reply,
                    buffered_text: String::new(),
                    awaiting_followup_run: false,
                    last_event_at: Self::now_ms(),
                },
            );
        }

        let result = self
            .request_openclaw_gateway(
                app,
                "chat.send",
                serde_json::json!({
                    "sessionKey": session_key,
                    "message": normalized_text,
                    "deliver": false,
                    "idempotencyKey": run_id,
                }),
            )
            .await;
        match result {
            Ok(_) => {
                self.append_event(format!(
                    "openclaw chat.send -> mobile={} session={} run={}",
                    mobile_id, session_key, run_id
                ))
                .await;
                Ok(())
            }
            Err(error) => {
                let mut state = self.state.lock().await;
                Self::remove_pending_openclaw_run_locked(&mut state, &run_id);
                drop(state);
                self.notify_openclaw_error_to_mobile(
                    binding_id,
                    mobile_id,
                    &error,
                    prefer_relay_reply,
                )
                    .await;
                Err(error)
            }
        }
    }

    async fn handle_openclaw_gateway_chat_event(&self, payload: Value) {
        let run_id = read_json_string(&payload, &["runId"]);
        if run_id.is_empty() {
            return;
        }
        let payload_session_key = read_json_string(&payload, &["sessionKey"]);
        let pending = self
            .resolve_pending_openclaw_run(&run_id, &payload_session_key)
            .await;
        let Some((primary_run_id, pending, matched_alias)) = pending else {
            self.schedule_openclaw_session_history_sync(&payload_session_key, "chat.event");
            self.append_event(format!(
                "openclaw chat event ignored without pending run: run={} session={}",
                run_id,
                value_or_dash(&payload_session_key)
            ))
            .await;
            return;
        };
        if matched_alias {
            self.append_event(format!(
                "openclaw chat event rebound: alias={} primary={}",
                run_id, primary_run_id
            ))
            .await;
        }

        let payload_session_key = Self::normalize_openclaw_session_key(&payload_session_key);
        if !payload_session_key.is_empty()
            && payload_session_key != Self::normalize_openclaw_session_key(&pending.session_key)
        {
            return;
        }

        let chat_state = read_json_string(&payload, &["state"]);
        self.append_event(format!(
            "openclaw chat event: run={} state={}",
            run_id,
            value_or_dash(&chat_state)
        ))
        .await;
        let event_text = Self::extract_openclaw_chat_event_text(&payload);
        if chat_state == "error" {
            let error_message = read_json_string(&payload, &["errorMessage"]);
            {
                let mut state = self.state.lock().await;
                Self::remove_pending_openclaw_run_locked(&mut state, &primary_run_id);
            }
            self.append_event(format!(
                "openclaw chat error: run={} {}",
                run_id,
                value_or_dash(&error_message)
            ))
            .await;
            self.notify_openclaw_error_to_mobile(
                &pending.binding_id,
                &pending.mobile_id,
                &error_message,
                pending.prefer_relay_reply,
            )
            .await;
            return;
        }
        if chat_state == "aborted" {
            {
                let mut state = self.state.lock().await;
                Self::remove_pending_openclaw_run_locked(&mut state, &primary_run_id);
            }
            self.append_event(format!("openclaw chat aborted: run={}", run_id))
                .await;
            return;
        }
        if chat_state == "delta" {
            if !event_text.is_empty() {
                let mut state = self.state.lock().await;
                if let Some(entry) = state.gateway_pending_runs.get_mut(&primary_run_id) {
                    entry.buffered_text =
                        Self::merge_openclaw_reply_text(&entry.buffered_text, &event_text);
                    entry.awaiting_followup_run = false;
                    entry.last_event_at = Self::now_ms();
                }
            }
            return;
        }
        if chat_state != "final" {
            return;
        }

        let reply_text = {
            let mut state = self.state.lock().await;
            let Some(entry) = state.gateway_pending_runs.get_mut(&primary_run_id) else {
                return;
            };
            entry.last_event_at = Self::now_ms();
            let merged_text = Self::merge_openclaw_reply_text(&entry.buffered_text, &event_text);
            if merged_text.trim().is_empty() {
                entry.awaiting_followup_run = true;
                String::new()
            } else {
                entry.buffered_text = merged_text.clone();
                entry.awaiting_followup_run = false;
                merged_text
            }
        };
        if reply_text.trim().is_empty() {
            self.append_event(format!(
                "openclaw chat final empty: run={} mobile={} waiting-followup",
                run_id, pending.mobile_id
            ))
            .await;
            self.schedule_openclaw_session_history_sync(&pending.session_key, "chat.final.empty");
            return;
        }
        self.mirror_openclaw_reply_to_mobile(pending, &reply_text)
            .await;
        self.schedule_openclaw_session_history_sync(&payload_session_key, "chat.final");
    }

    async fn notify_openclaw_error_to_mobile(
        &self,
        binding_id: &str,
        mobile_id: &str,
        error_message: &str,
        prefer_relay_reply: bool,
    ) {
        let user_text = Self::build_openclaw_mobile_error_text(error_message);
        let outgoing = self
            .build_outgoing_chat_message(binding_id, "agent", &user_text, None)
            .await;
        let _ = self.append_channel_message(binding_id, outgoing.clone()).await;

        let payload = Self::build_openclaw_chat_payload(&outgoing, "desktop");
        let expect_ack = self
            .channel_supports_message_type(binding_id, OPENCLAW_CHAT_ACK_TYPE)
            .await;
        if expect_ack {
            self.register_pending_mobile_ack(
                binding_id,
                mobile_id,
                &outgoing.id,
                &payload,
                prefer_relay_reply,
            )
            .await;
        }
        match self
            .send_app_envelope_to_mobile_with_delivery(
                binding_id,
                mobile_id,
                payload.clone(),
                prefer_relay_reply,
            )
            .await
        {
            Ok(delivery) => {
                if expect_ack {
                    self.arm_pending_mobile_ack(
                        &outgoing.id,
                        prefer_relay_reply || delivery == "relay",
                    )
                    .await;
                }
                self.append_event(format!(
                    "openclaw error sent -> mobile={} via={}",
                    mobile_id, delivery
                ))
                .await;
            }
            Err(error) => {
                if expect_ack {
                    self.clear_pending_mobile_ack(&outgoing.id).await;
                }
                self.append_event(format!("openclaw error mirror failed: {}", error))
                    .await;
            }
        }
    }

    async fn mirror_openclaw_reply_to_mobile(&self, pending: PendingOpenClawRun, text: &str) {
        let normalized_text = text.trim();
        {
            let mut state = self.state.lock().await;
            Self::remove_pending_openclaw_run_locked(&mut state, &pending.run_id);
        }
        if normalized_text.is_empty() {
            return;
        }

        let outgoing = self
            .build_outgoing_chat_message(&pending.binding_id, "agent", normalized_text, None)
            .await;
        let payload = Self::build_openclaw_chat_payload(&outgoing, "desktop");
        let expect_ack = self
            .channel_supports_message_type(&pending.binding_id, OPENCLAW_CHAT_ACK_TYPE)
            .await;
        if expect_ack {
            self.register_pending_mobile_ack(
                &pending.binding_id,
                &pending.mobile_id,
                &outgoing.id,
                &payload,
                pending.prefer_relay_reply,
            )
            .await;
        }
        match self
            .send_app_envelope_to_mobile_with_delivery(
                &pending.binding_id,
                &pending.mobile_id,
                payload.clone(),
                pending.prefer_relay_reply,
            )
            .await
        {
            Ok(delivery) => {
                if expect_ack {
                    self.arm_pending_mobile_ack(
                        &outgoing.id,
                        pending.prefer_relay_reply || delivery == "relay",
                    )
                    .await;
                }
                let _ = self
                    .append_channel_message(&pending.binding_id, outgoing)
                    .await;
                self.append_event(format!(
                    "openclaw reply sent -> mobile={} via={}",
                    pending.mobile_id, delivery
                ))
                .await;
            }
            Err(error) => {
                if expect_ack {
                    self.clear_pending_mobile_ack(&outgoing.id).await;
                }
                self.append_event(format!("openclaw reply mirror failed: {}", error))
                    .await;
            }
        }
    }
}
