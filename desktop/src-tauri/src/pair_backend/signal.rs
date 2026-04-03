use super::*;
use crate::{read_config_with_runtime_custom_api_mode_sync, StoredConfig};

impl PairBackendHandle {
    async fn find_channel_for_signal(
        &self,
        binding_id: &str,
        mobile_id: &str,
    ) -> Option<PairBackendChannel> {
        let state = self.state.lock().await;
        state
            .channels
            .iter()
            .find(|item| {
                (!binding_id.is_empty() && item.binding_id == binding_id)
                    || (!mobile_id.is_empty() && item.mobile_id == mobile_id)
            })
            .cloned()
    }

    async fn ensure_channel_for_signal(
        &self,
        app: &AppHandle,
        binding_id: &str,
        mobile_id: &str,
    ) -> Result<Option<PairBackendChannel>, String> {
        if let Some(channel) = self.find_channel_for_signal(binding_id, mobile_id).await {
            return Ok(Some(channel));
        }

        if let Err(error) = self.refresh_bindings(app).await {
            self.append_event(format!("refresh bindings before signal failed: {}", error))
                .await;
        }

        if let Some(channel) = self.find_channel_for_signal(binding_id, mobile_id).await {
            return Ok(Some(channel));
        }

        if binding_id.is_empty() && mobile_id.is_empty() {
            return Ok(None);
        }

        let channel = {
            let mut state = self.state.lock().await;
            let channel_open = state.channel_open;
            let channel = find_or_create_channel_mut(
                &mut state.channels,
                None,
                (!binding_id.is_empty()).then_some(binding_id),
                (!mobile_id.is_empty()).then_some(mobile_id),
                Self::now_ms(),
            );
            if !binding_id.is_empty() {
                channel.binding_id = binding_id.to_string();
                if channel.channel_id.trim().is_empty() {
                    channel.channel_id = binding_id.to_string();
                }
            }
            if !mobile_id.is_empty() {
                channel.mobile_id = mobile_id.to_string();
            }
            if channel.status != "pending" {
                channel.status = if channel_open {
                    "active".to_string()
                } else {
                    "offline".to_string()
                };
            }
            if channel.trust_state.trim().is_empty() || channel.trust_state == "pending" {
                channel.trust_state = "active".to_string();
            }
            channel.clone()
        };

        self.append_event(format!(
            "bootstrapped channel from signal: binding={} mobile={}",
            value_or_dash(binding_id),
            value_or_dash(mobile_id)
        ))
        .await;
        self.emit_snapshot().await;
        Ok(Some(channel))
    }

    async fn create_answerer_peer(
        &self,
        app: &AppHandle,
        channel: &PairBackendChannel,
    ) -> Result<Arc<DesktopPeer>, String> {
        let binding_id = channel.binding_id.trim().to_string();
        if binding_id.is_empty() {
            return Err("bindingId missing".to_string());
        }
        let ice_servers = self.resolve_ice_servers(app).await?;
        let peer_connection = Arc::new(
            self.api
                .new_peer_connection(RTCConfiguration {
                    ice_servers,
                    ..Default::default()
                })
                .await
                .map_err(|e| format!("创建 WebRTC peer 失败: {}", e))?,
        );
        let peer = Arc::new(DesktopPeer {
            binding_id: binding_id.clone(),
            mobile_id: channel.mobile_id.clone(),
            peer: peer_connection.clone(),
            data_channel: Arc::new(Mutex::new(None)),
            pending_remote_candidates: Arc::new(Mutex::new(Vec::new())),
            hello_sent: Arc::new(Mutex::new(false)),
            remote_verified: Arc::new(Mutex::new(false)),
            capabilities_sent: Arc::new(Mutex::new(false)),
        });
        self.install_peer_callbacks(app.clone(), peer.clone(), channel.clone())
            .await;
        {
            let mut state = self.state.lock().await;
            state.peers.insert(binding_id, peer.clone());
        }
        Ok(peer)
    }

    async fn send_answer_signal(
        &self,
        app: &AppHandle,
        peer: &DesktopPeer,
        description: RTCSessionDescription,
    ) -> Result<(), String> {
        self.send_signal(
            app,
            &peer.mobile_id,
            "webrtc.answer",
            serde_json::json!({
                "bindingId": peer.binding_id,
                "description": {
                    "type": description.sdp_type.to_string(),
                    "sdp": description.sdp,
                }
            }),
        )
        .await?;
        self.append_event(format!(
            "peer answer sent: binding={} mobile={}",
            peer.binding_id, peer.mobile_id
        ))
        .await;
        Ok(())
    }

    async fn peer_has_same_remote_description(
        &self,
        peer: &DesktopPeer,
        description_type: &str,
        description_sdp: &str,
    ) -> bool {
        let Some(current) = peer.peer.remote_description().await else {
            return false;
        };
        current
            .sdp_type
            .to_string()
            .eq_ignore_ascii_case(description_type.trim())
            && normalize_sdp_text(&current.sdp) == normalize_sdp_text(description_sdp)
    }

    pub(super) async fn connect(&self, app: AppHandle, from_reconnect: bool) -> Result<(), String> {
        if !from_reconnect {
            self.cancel_reconnect_task().await;
        }
        let (open, desired) = {
            let state = self.state.lock().await;
            (state.channel_open, state.desired_connected)
        };
        if !open && !from_reconnect {
            return Ok(());
        }
        if !desired && from_reconnect {
            return Ok(());
        }
        let (base_url, device_id, _identity, session) = self.announce_presence(&app).await?;
        let generation = {
            let mut state = self.state.lock().await;
            state.connect_generation = state.connect_generation.saturating_add(1);
            state.reconnect_attempts = if from_reconnect {
                state.reconnect_attempts
            } else {
                0
            };
            if let Some(handle) = state.sse_task.take() {
                handle.abort();
            }
            if let Some(handle) = state.heartbeat_task.take() {
                handle.abort();
            }
            state.connection_state = if from_reconnect {
                "reconnecting".to_string()
            } else {
                "connecting".to_string()
            };
            state.status_message = "正在连接配对通道...".to_string();
            state.status_type = String::new();
            state.desired_connected = true;
            state.channel_open = true;
            state.connect_generation
        };
        self.append_event(format!(
            "connecting v2 stream -> {}/v2/signal/stream?clientType=desktop&clientId={}&token={}",
            base_url, device_id, session.token
        ))
        .await;
        self.emit_snapshot().await;

        let backend = self.clone();
        let sse_app = app.clone();
        let sse_base_url = base_url.clone();
        let sse_token = session.token.clone();
        let sse_device_id = device_id.clone();
        let sse_handle = tokio::spawn(async move {
            if let Err(error) = backend
                .run_signal_stream(sse_app, generation, sse_base_url, sse_token, sse_device_id)
                .await
            {
                backend
                    .append_event(format!("v2 signal stream disconnected: {}", error))
                    .await;
                backend.handle_stream_failure(generation).await;
            }
        });
        let heartbeat_backend = self.clone();
        let heartbeat_app = app.clone();
        let heartbeat_handle = tokio::spawn(async move {
            loop {
                tokio::time::sleep(Duration::from_secs(PAIR_HEARTBEAT_SECS)).await;
                let still_current = {
                    let state = heartbeat_backend.state.lock().await;
                    state.channel_open
                        && state.desired_connected
                        && state.connect_generation == generation
                };
                if !still_current {
                    break;
                }
                if let Err(error) = heartbeat_backend.heartbeat_once(&heartbeat_app).await {
                    heartbeat_backend
                        .append_event(format!("presence heartbeat failed: {}", error))
                        .await;
                    heartbeat_backend.handle_stream_failure(generation).await;
                    break;
                }
            }
        });
        {
            let mut state = self.state.lock().await;
            if state.connect_generation == generation {
                state.sse_task = Some(sse_handle);
                state.heartbeat_task = Some(heartbeat_handle);
            } else {
                sse_handle.abort();
                heartbeat_handle.abort();
            }
        }
        Ok(())
    }

    pub(super) async fn run_signal_stream(
        &self,
        app: AppHandle,
        generation: u64,
        base_url: String,
        token: String,
        device_id: String,
    ) -> Result<(), String> {
        let encoded_device_id: String =
            url::form_urlencoded::byte_serialize(device_id.as_bytes()).collect();
        let encoded_token: String =
            url::form_urlencoded::byte_serialize(token.as_bytes()).collect();
        let stream_url = format!(
            "{}/v2/signal/stream?clientType=desktop&clientId={}&token={}",
            base_url.trim_end_matches('/'),
            encoded_device_id,
            encoded_token,
        );
        let response = self
            .http
            .get(&stream_url)
            .send()
            .await
            .map_err(|e| format!("连接信令流失败: {}", e))?;
        if !response.status().is_success() {
            return Err(format!("HTTP {}", response.status()));
        }
        {
            let mut state = self.state.lock().await;
            if state.connect_generation != generation || !state.channel_open {
                return Ok(());
            }
            state.connection_state = "connected".to_string();
            state.status_message = "配对通道已连接。".to_string();
            state.status_type = "success".to_string();
            for channel in &mut state.channels {
                if channel.trust_state != "revoked" && channel.status != "pending" {
                    channel.status = "active".to_string();
                }
            }
        }
        self.append_event("v2 signal stream connected").await;
        let _ = self.refresh_bindings(&app).await;
        self.emit_snapshot().await;

        let byte_stream = response.bytes_stream().map(|item| {
            item.map_err(|error| std::io::Error::new(std::io::ErrorKind::Other, error.to_string()))
        });
        let reader = StreamReader::new(byte_stream);
        let mut reader = BufReader::new(reader);
        let mut line = String::new();
        let mut data_lines: Vec<String> = Vec::new();

        loop {
            line.clear();
            let count = reader
                .read_line(&mut line)
                .await
                .map_err(|e| format!("读取信令流失败: {}", e))?;
            if count == 0 {
                break;
            }
            let trimmed = line.trim_end_matches(['\r', '\n']);
            if trimmed.is_empty() {
                if data_lines.is_empty() {
                    continue;
                }
                let payload = data_lines.join("\n");
                data_lines.clear();
                let envelope: PairSignalEnvelope = match serde_json::from_str(&payload) {
                    Ok(value) => value,
                    Err(_) => continue,
                };
                if envelope.r#type == "stream.opened" {
                    continue;
                }
                self.handle_signal_event(&app, generation, envelope).await?;
                continue;
            }
            if let Some(rest) = trimmed.strip_prefix("data:") {
                data_lines.push(rest.trim_start().to_string());
            }
        }

        Ok(())
    }

    pub(super) async fn handle_stream_failure(&self, generation: u64) {
        let should_reconnect = {
            let mut state = self.state.lock().await;
            if state.connect_generation != generation {
                return;
            }
            state.connection_state = "disconnected".to_string();
            state.status_message = "配对通道已断开。".to_string();
            state.status_type = "error".to_string();
            for channel in &mut state.channels {
                if channel.status != "pending" && channel.trust_state != "revoked" {
                    channel.status = "offline".to_string();
                }
            }
            state.reconnect_attempts = state.reconnect_attempts.saturating_add(1);
            state.desired_connected && state.channel_open
        };
        self.emit_snapshot().await;
        if should_reconnect {
            self.schedule_reconnect(generation).await;
        }
    }

    pub(super) async fn schedule_reconnect(&self, generation: u64) {
        self.cancel_reconnect_task().await;
        let wait_ms = {
            let state = self.state.lock().await;
            let power = state.reconnect_attempts.min(4);
            (PAIR_RECONNECT_BASE_MS * 2u64.pow(power)).min(PAIR_RECONNECT_MAX_MS)
        };
        self.append_event(format!(
            "ws reconnect scheduled in {}s",
            (wait_ms + 999) / 1000
        ))
        .await;
        let backend = self.clone();
        let app = {
            let state = self.state.lock().await;
            state.app.clone()
        };
        let handle = tokio::spawn(async move {
            tokio::time::sleep(Duration::from_millis(wait_ms)).await;
            let Some(app_handle) = app else {
                return;
            };
            let still_current = {
                let state = backend.state.lock().await;
                state.channel_open
                    && state.desired_connected
                    && state.connect_generation == generation
            };
            if !still_current {
                return;
            }
            backend.spawn_connect_task(app_handle, true);
        });
        let mut state = self.state.lock().await;
        state.reconnect_task = Some(handle);
    }

    pub(super) async fn cancel_reconnect_task(&self) {
        let handle = {
            let mut state = self.state.lock().await;
            state.reconnect_task.take()
        };
        if let Some(task) = handle {
            task.abort();
        }
    }

    pub(super) async fn disconnect(&self) {
        let (sse_task, heartbeat_task, reconnect_task, peer_keys) = {
            let mut state = self.state.lock().await;
            state.channel_open = false;
            state.desired_connected = false;
            state.connection_state = "disconnected".to_string();
            state.status_message = "配对通道已断开。".to_string();
            state.status_type = String::new();
            for channel in &mut state.channels {
                if channel.status != "pending" && channel.trust_state != "revoked" {
                    channel.status = "offline".to_string();
                }
            }
            (
                state.sse_task.take(),
                state.heartbeat_task.take(),
                state.reconnect_task.take(),
                state.peers.keys().cloned().collect::<Vec<_>>(),
            )
        };
        if let Some(task) = sse_task {
            task.abort();
        }
        if let Some(task) = heartbeat_task {
            task.abort();
        }
        if let Some(task) = reconnect_task {
            task.abort();
        }
        for key in peer_keys {
            self.dispose_peer(&key, "desktop channel closed", "disconnected")
                .await;
        }
        self.disconnect_openclaw_gateway("pair channel closed")
            .await;
        self.append_event("ws disconnected by user").await;
        self.emit_snapshot().await;
    }

    pub async fn reload_from_app_config(
        &self,
        app: AppHandle,
    ) -> Result<PairBackendSnapshot, String> {
        self.set_app_handle(app.clone()).await;
        let config = read_config_with_runtime_custom_api_mode_sync(&app)?.unwrap_or(StoredConfig {
            provider: String::new(),
            model: String::new(),
            api_key: String::new(),
            base_url: None,
            custom_api_mode: String::new(),
            custom_headers: Default::default(),
            skills_dirs: Vec::new(),
            openclaw_command: "openclaw".to_string(),
            channel_server_base_url: None,
            channel_device_id: None,
            updated_at: String::new(),
        });
        let base_url = config
            .channel_server_base_url
            .as_deref()
            .map(Self::normalize_base_url)
            .transpose()?
            .unwrap_or_default();
        let device_id = config
            .channel_device_id
            .unwrap_or_default()
            .trim()
            .to_string();
        let should_connect = !base_url.is_empty() && !device_id.is_empty();
        {
            let mut state = self.state.lock().await;
            state.configured_server_url = base_url.clone();
            state.configured_device_id = device_id.clone();
            state.channel_open = should_connect;
            state.desired_connected = should_connect;
            if !should_connect {
                state.status_message =
                    "通信功能尚未配置。请先在下方填写服务端地址并保存，设备 ID 会自动生成。"
                        .to_string();
                state.status_type = String::new();
            } else {
                state.status_message.clear();
                state.status_type.clear();
            }
        }
        self.emit_snapshot().await;
        if should_connect {
            self.append_event("auto opening pair channel after config sync")
                .await;
            self.connect(app.clone(), false).await?;
        } else {
            self.disconnect().await;
        }
        Ok(self.snapshot().await)
    }

    pub(super) async fn snapshot(&self) -> PairBackendSnapshot {
        let state = self.state.lock().await;
        self.snapshot_from_state(&state)
    }

    pub(super) async fn handle_signal_event(
        &self,
        app: &AppHandle,
        generation: u64,
        envelope: PairSignalEnvelope,
    ) -> Result<(), String> {
        let still_current = {
            let state = self.state.lock().await;
            state.connect_generation == generation && state.channel_open
        };
        if !still_current {
            return Ok(());
        }
        let event_type = envelope.r#type.trim().to_string();
        let from_id = envelope
            .from
            .as_ref()
            .map(|value| value.id.trim().to_string())
            .unwrap_or_default();
        let payload = envelope
            .payload
            .unwrap_or_else(|| Value::Object(Default::default()));

        if event_type == "pair.claimed" {
            let mobile_id = read_json_string(&payload, &["mobileId", "mobile_id"]);
            let mobile_name = read_json_string(&payload, &["mobileName", "mobile_name"]);
            let session_id = read_json_string(&payload, &["pairSessionId", "pair_session_id"]);
            let binding_id = read_json_string(&payload, &["bindingId", "binding_id"]);
            let device_public_key =
                read_json_string(&payload, &["devicePublicKey", "device_public_key"]);
            let mobile_public_key =
                read_json_string(&payload, &["mobilePublicKey", "mobile_public_key"]);
            let session_nonce = read_json_string(&payload, &["sessionNonce", "session_nonce"]);
            let trust_state = read_json_string(&payload, &["trustState", "trust_state"]);
            let safety_code = if !device_public_key.is_empty()
                && !mobile_public_key.is_empty()
                && !session_id.is_empty()
                && !session_nonce.is_empty()
            {
                Some(compute_safety_code(
                    &device_public_key,
                    &mobile_public_key,
                    &session_id,
                    &session_nonce,
                ))
            } else {
                None
            };
            {
                let mut state = self.state.lock().await;
                let channel = find_or_create_channel_mut(
                    &mut state.channels,
                    Some(&session_id),
                    Some(&binding_id),
                    Some(&mobile_id),
                    Self::now_ms(),
                );
                if !session_id.is_empty() {
                    channel.session_id = session_id.clone();
                }
                if !binding_id.is_empty() {
                    channel.binding_id = binding_id.clone();
                }
                if !mobile_id.is_empty() {
                    channel.mobile_id = mobile_id.clone();
                }
                if !mobile_name.is_empty() {
                    channel.mobile_name = mobile_name.clone();
                }
                if !device_public_key.is_empty() {
                    channel.device_public_key = Some(device_public_key.clone());
                }
                if !mobile_public_key.is_empty() {
                    channel.mobile_public_key = Some(mobile_public_key.clone());
                }
                if !session_nonce.is_empty() {
                    channel.session_nonce = Some(session_nonce.clone());
                }
                if let Some(code) = safety_code.clone() {
                    channel.safety_code = Some(code);
                }
                channel.trust_state = if trust_state.is_empty() {
                    "pending".to_string()
                } else {
                    trust_state
                };
                channel.status = "pending".to_string();
                channel.peer_state = "idle".to_string();
            }
            self.append_event(format!(
                "pair claimed: session={} mobile={} safety={}",
                value_or_dash(&session_id),
                value_or_dash(&mobile_id),
                value_or_dash(safety_code.as_deref().unwrap_or(""))
            ))
            .await;
            self.emit_snapshot().await;
            return Ok(());
        }

        if event_type == "pair.revoked" {
            let binding_id = read_json_string(&payload, &["bindingId", "binding_id"]);
            let mobile_id = read_json_string(&payload, &["mobileId", "mobile_id"]);
            self.dispose_peer(&binding_id, "binding revoked", "disconnected")
                .await;
            {
                let mut state = self.state.lock().await;
                if let Some(channel) = state.channels.iter_mut().find(|item| {
                    (!binding_id.is_empty() && item.binding_id == binding_id)
                        || (!mobile_id.is_empty() && item.mobile_id == mobile_id)
                }) {
                    channel.status = "offline".to_string();
                    channel.trust_state = "revoked".to_string();
                }
            }
            self.append_event(format!(
                "pair revoked: binding={} mobile={}",
                value_or_dash(&binding_id),
                value_or_dash(&mobile_id)
            ))
            .await;
            self.emit_snapshot().await;
            return Ok(());
        }

        if matches!(
            event_type.as_str(),
            "webrtc.offer" | "webrtc.answer" | "webrtc.ice"
        ) {
            let signal_payload: PairSignalPayload =
                serde_json::from_value(payload).map_err(|e| format!("解析信令失败: {}", e))?;
            let binding_id = signal_payload.binding_id.trim().to_string();
            let mobile_id = if signal_payload.mobile_id.trim().is_empty() {
                from_id
            } else {
                signal_payload.mobile_id.trim().to_string()
            };
            let channel = self
                .ensure_channel_for_signal(app, &binding_id, &mobile_id)
                .await?;
            let Some(channel) = channel else {
                self.append_event(format!(
                    "peer signal ignored without channel: type={} binding={}",
                    event_type,
                    value_or_dash(&binding_id)
                ))
                .await;
                return Ok(());
            };
            if event_type == "webrtc.offer" {
                self.accept_offer(app, &channel, signal_payload).await?;
                return Ok(());
            }
            if event_type == "webrtc.ice" {
                self.handle_remote_ice(&channel, signal_payload).await?;
                return Ok(());
            }
            return Ok(());
        }

        Ok(())
    }

    pub(super) async fn accept_offer(
        &self,
        app: &AppHandle,
        channel: &PairBackendChannel,
        payload: PairSignalPayload,
    ) -> Result<(), String> {
        let binding_id = channel.binding_id.trim().to_string();
        if binding_id.is_empty() {
            return Err("bindingId missing".to_string());
        }
        let description = payload
            .description
            .ok_or_else(|| "offer sdp missing".to_string())?;
        let normalized_offer_sdp = normalize_sdp_text(&description.sdp);
        let existing_peer = {
            let state = self.state.lock().await;
            state.peers.get(&binding_id).cloned()
        };
        let mut reuse_existing_peer = None;
        if let Some(peer) = existing_peer {
            let same_offer = self
                .peer_has_same_remote_description(
                    &peer,
                    &description.sdp_type,
                    &normalized_offer_sdp,
                )
                .await;
            if same_offer {
                if let Some(local_description) = peer.peer.local_description().await {
                    if local_description
                        .sdp_type
                        .to_string()
                        .eq_ignore_ascii_case("answer")
                        && !local_description.sdp.trim().is_empty()
                    {
                        self.append_event(format!(
                            "peer duplicate offer, resend answer: binding={}",
                            binding_id
                        ))
                        .await;
                        return self.send_answer_signal(app, &peer, local_description).await;
                    }
                }
                reuse_existing_peer = Some(peer);
            } else {
                let has_remote = peer.peer.remote_description().await.is_some();
                let has_local = peer.peer.local_description().await.is_some();
                let has_data_channel = peer.data_channel.lock().await.is_some();
                if has_remote || has_local || has_data_channel {
                    self.dispose_peer(&binding_id, "recreate as answerer", "connecting")
                        .await;
                } else {
                    reuse_existing_peer = Some(peer);
                }
            }
        }

        let peer = if let Some(peer) = reuse_existing_peer {
            peer
        } else {
            self.create_answerer_peer(app, channel).await?
        };

        let queued_candidates = {
            let mut state = self.state.lock().await;
            state
                .pending_remote_candidates
                .remove(&binding_id)
                .unwrap_or_default()
        };
        if !queued_candidates.is_empty() {
            let mut pending = peer.pending_remote_candidates.lock().await;
            pending.extend(queued_candidates);
        }

        self.set_channel_peer_state(&binding_id, "connecting", "received offer")
            .await;

        let same_offer = self
            .peer_has_same_remote_description(&peer, &description.sdp_type, &normalized_offer_sdp)
            .await;
        if !same_offer {
            let offer = RTCSessionDescription::offer(normalized_offer_sdp)
                .map_err(|e| format!("解析远端 offer 失败: {}", e))?;
            peer.peer
                .set_remote_description(offer)
                .await
                .map_err(|e| format!("设置远端 offer 失败: {}", e))?;
        }
        self.flush_remote_candidates(&peer).await?;
        let answer = peer
            .peer
            .create_answer(None)
            .await
            .map_err(|e| format!("创建 answer 失败: {}", e))?;
        peer.peer
            .set_local_description(answer.clone())
            .await
            .map_err(|e| format!("设置本地 answer 失败: {}", e))?;
        let local_description = peer.peer.local_description().await.unwrap_or(answer);
        self.send_answer_signal(app, &peer, local_description)
            .await?;
        Ok(())
    }

    pub(super) async fn handle_remote_ice(
        &self,
        channel: &PairBackendChannel,
        payload: PairSignalPayload,
    ) -> Result<(), String> {
        let binding_id = channel.binding_id.trim().to_string();
        if binding_id.is_empty() {
            return Ok(());
        }
        let candidate = match payload.candidate {
            Some(value) if !value.candidate.trim().is_empty() => value,
            _ => return Ok(()),
        };
        let peer = {
            let state = self.state.lock().await;
            state.peers.get(&binding_id).cloned()
        };
        let Some(peer) = peer else {
            let mut state = self.state.lock().await;
            state
                .pending_remote_candidates
                .entry(binding_id)
                .or_default()
                .push(candidate);
            return Ok(());
        };
        if peer.peer.remote_description().await.is_some() {
            peer.peer
                .add_ice_candidate(candidate)
                .await
                .map_err(|e| format!("添加远端 ICE 失败: {}", e))?;
        } else {
            let mut pending = peer.pending_remote_candidates.lock().await;
            pending.push(candidate);
        }
        Ok(())
    }

    pub(super) async fn flush_remote_candidates(&self, peer: &DesktopPeer) -> Result<(), String> {
        let queued = {
            let mut pending = peer.pending_remote_candidates.lock().await;
            let copy = pending.clone();
            pending.clear();
            copy
        };
        for candidate in queued {
            peer.peer
                .add_ice_candidate(candidate)
                .await
                .map_err(|e| format!("补发远端 ICE 失败: {}", e))?;
        }
        Ok(())
    }

    pub(super) async fn install_peer_callbacks(
        &self,
        app: AppHandle,
        peer: Arc<DesktopPeer>,
        channel: PairBackendChannel,
    ) {
        let backend = self.clone();
        let binding_id = peer.binding_id.clone();
        let mobile_id = peer.mobile_id.clone();
        peer.peer.on_ice_candidate(Box::new(move |candidate| {
            let backend = backend.clone();
            let app = app.clone();
            let binding_id = binding_id.clone();
            let mobile_id = mobile_id.clone();
            Box::pin(async move {
                if let Some(candidate) = candidate {
                    if let Ok(candidate_json) = candidate.to_json() {
                        let _ = backend
                            .send_signal(
                                &app,
                                &mobile_id,
                                "webrtc.ice",
                                serde_json::json!({
                                    "bindingId": binding_id,
                                    "candidate": candidate_json,
                                }),
                            )
                            .await;
                    }
                }
            })
        }));

        let backend = self.clone();
        let peer_state = peer.clone();
        peer.peer
            .on_peer_connection_state_change(Box::new(move |state| {
                let backend = backend.clone();
                let peer_state = peer_state.clone();
                Box::pin(async move {
                    if !backend
                        .is_current_peer_instance(&peer_state.binding_id, &peer_state)
                        .await
                    {
                        backend
                            .append_event(format!(
                                "ignored stale peer state: binding={} state={}",
                                peer_state.binding_id, state
                            ))
                            .await;
                        return;
                    }
                    match state {
                        RTCPeerConnectionState::Failed => {
                            backend
                                .dispose_peer_if_current(
                                    &peer_state,
                                    "peer connection failed",
                                    "failed",
                                )
                                .await;
                        }
                        RTCPeerConnectionState::Closed => {
                            backend
                                .dispose_peer_if_current(
                                    &peer_state,
                                    &format!("peer connection {}", state),
                                    "disconnected",
                                )
                                .await;
                        }
                        RTCPeerConnectionState::Disconnected => {
                            backend
                                .set_channel_peer_state(
                                    &peer_state.binding_id,
                                    "disconnected",
                                    "peer connection disconnected",
                                )
                                .await;
                        }
                        _ => {}
                    }
                })
            }));

        let backend = self.clone();
        let peer_ice = peer.clone();
        peer.peer
            .on_ice_connection_state_change(Box::new(move |state| {
                let backend = backend.clone();
                let peer_ice = peer_ice.clone();
                Box::pin(async move {
                    if !backend
                        .is_current_peer_instance(&peer_ice.binding_id, &peer_ice)
                        .await
                    {
                        return;
                    }
                    if state == RTCIceConnectionState::Failed {
                        backend
                            .dispose_peer_if_current(&peer_ice, "ice failed", "failed")
                            .await;
                    }
                })
            }));

        let backend = self.clone();
        let peer_for_dc = peer.clone();
        let channel_for_dc = channel.clone();
        peer.peer.on_data_channel(Box::new(move |dc| {
            let backend = backend.clone();
            let peer_for_dc = peer_for_dc.clone();
            let channel_for_dc = channel_for_dc.clone();
            Box::pin(async move {
                backend
                    .attach_data_channel(peer_for_dc, channel_for_dc, dc)
                    .await;
            })
        }));

        self.set_channel_peer_state(&peer.binding_id, "connecting", "answerer peer ready")
            .await;
    }

    pub(super) async fn attach_data_channel(
        &self,
        peer: Arc<DesktopPeer>,
        channel: PairBackendChannel,
        dc: Arc<RTCDataChannel>,
    ) {
        {
            let mut current = peer.data_channel.lock().await;
            if let Some(previous) = current.replace(dc.clone()) {
                let _ = previous.close().await;
            }
        }
        let backend = self.clone();
        let peer_open = peer.clone();
        let dc_open = dc.clone();
        dc.on_open(Box::new(move || {
            let backend = backend.clone();
            let peer_open = peer_open.clone();
            let dc_open = dc_open.clone();
            Box::pin(async move {
                if !backend
                    .is_current_data_channel_instance(&peer_open, &dc_open)
                    .await
                {
                    backend
                        .append_event(format!(
                            "ignored stale data channel open: binding={}",
                            peer_open.binding_id
                        ))
                        .await;
                    return;
                }
                backend
                    .set_channel_peer_state(
                        &peer_open.binding_id,
                        "channel-open",
                        "data channel open",
                    )
                    .await;
                let _ = backend.send_peer_hello(peer_open).await;
            })
        }));

        let backend = self.clone();
        let peer_close = peer.clone();
        let dc_close = dc.clone();
        dc.on_close(Box::new(move || {
            let backend = backend.clone();
            let peer_close = peer_close.clone();
            let dc_close = dc_close.clone();
            Box::pin(async move {
                backend
                    .dispose_peer_if_current_channel(
                        &peer_close,
                        &dc_close,
                        "data channel closed",
                        "disconnected",
                    )
                    .await;
            })
        }));

        let backend = self.clone();
        let peer_error = peer.clone();
        let dc_error = dc.clone();
        dc.on_error(Box::new(move |error| {
            let backend = backend.clone();
            let peer_error = peer_error.clone();
            let dc_error = dc_error.clone();
            Box::pin(async move {
                backend
                    .dispose_peer_if_current_channel(
                        &peer_error,
                        &dc_error,
                        &format!("data channel error: {}", error),
                        "failed",
                    )
                    .await;
            })
        }));

        let backend = self.clone();
        let peer_msg = peer.clone();
        let dc_msg = dc.clone();
        dc.on_message(Box::new(move |message: DataChannelMessage| {
            let backend = backend.clone();
            let peer_msg = peer_msg.clone();
            let dc_msg = dc_msg.clone();
            Box::pin(async move {
                if !backend
                    .is_current_data_channel_instance(&peer_msg, &dc_msg)
                    .await
                {
                    backend
                        .append_event(format!(
                            "ignored stale data channel message: binding={}",
                            peer_msg.binding_id
                        ))
                        .await;
                    return;
                }
                let _ = backend.handle_peer_message(peer_msg, message).await;
            })
        }));

        self.set_channel_peer_state(&channel.binding_id, "connecting", "data channel attached")
            .await;
    }
}
