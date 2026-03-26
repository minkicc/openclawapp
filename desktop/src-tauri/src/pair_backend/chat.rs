use super::*;

impl PairBackendHandle {
    pub(super) async fn is_current_peer_instance(
        &self,
        binding_id: &str,
        expected: &Arc<DesktopPeer>,
    ) -> bool {
        let current = {
            let state = self.state.lock().await;
            state.peers.get(binding_id).cloned()
        };
        current
            .as_ref()
            .map(|peer| Arc::ptr_eq(peer, expected))
            .unwrap_or(false)
    }

    pub(super) async fn is_current_data_channel_instance(
        &self,
        peer: &Arc<DesktopPeer>,
        channel: &Arc<RTCDataChannel>,
    ) -> bool {
        if !self
            .is_current_peer_instance(&peer.binding_id, peer)
            .await
        {
            return false;
        }
        let current = peer.data_channel.lock().await;
        current
            .as_ref()
            .map(|value| Arc::ptr_eq(value, channel))
            .unwrap_or(false)
    }

    pub(super) async fn dispose_peer_if_current(
        &self,
        peer: &Arc<DesktopPeer>,
        detail: &str,
        state_name: &str,
    ) {
        if !self
            .is_current_peer_instance(&peer.binding_id, peer)
            .await
        {
            self.append_event(format!(
                "ignored stale peer callback: binding={} ({})",
                peer.binding_id, detail
            ))
            .await;
            return;
        }
        self.dispose_peer(&peer.binding_id, detail, state_name).await;
    }

    pub(super) async fn dispose_peer_if_current_channel(
        &self,
        peer: &Arc<DesktopPeer>,
        channel: &Arc<RTCDataChannel>,
        detail: &str,
        state_name: &str,
    ) {
        if !self
            .is_current_data_channel_instance(peer, channel)
            .await
        {
            self.append_event(format!(
                "ignored stale data channel callback: binding={} ({})",
                peer.binding_id, detail
            ))
            .await;
            return;
        }
        self.dispose_peer(&peer.binding_id, detail, state_name).await;
    }

    pub(super) async fn send_peer_hello(&self, peer: Arc<DesktopPeer>) -> Result<(), String> {
        let (identity, device_id) = {
            let state = self.state.lock().await;
            (
                state.identity.clone().ok_or_else(|| "desktop identity missing".to_string())?,
                state.configured_device_id.clone(),
            )
        };
        {
            let hello_sent = peer.hello_sent.lock().await;
            if *hello_sent {
                return Ok(());
            }
        }
        let nonce = Self::random_id("nonce");
        let signature = Self::sign_text(
            &identity.private_key,
            &Self::build_peer_hello_text(
                &peer.binding_id,
                "desktop",
                &device_id,
                &identity.public_key,
                &nonce,
            ),
        )?;
        let payload = serde_json::json!({
            "type": PAIR_CAPABILITY_HELLO_TYPE,
            "bindingId": peer.binding_id,
            "entityType": "desktop",
            "entityId": device_id,
            "publicKey": identity.public_key,
            "nonce": nonce,
            "signature": signature,
        });
        self.send_peer_json(&peer, &payload).await?;
        {
            let mut hello_sent = peer.hello_sent.lock().await;
            *hello_sent = true;
        }
        self.append_event(format!("peer hello sent: binding={}", peer.binding_id))
            .await;
        let remote_verified = *peer.remote_verified.lock().await;
        if remote_verified {
            self.set_channel_peer_state(&peer.binding_id, "connected", "peer verified")
                .await;
            self.send_peer_capabilities(peer).await?;
        } else {
            self.set_channel_peer_state(&peer.binding_id, "verifying", "hello sent")
                .await;
        }
        Ok(())
    }

    pub(super) async fn send_peer_capabilities(&self, peer: Arc<DesktopPeer>) -> Result<(), String> {
        let mut sent = peer.capabilities_sent.lock().await;
        if *sent || !*peer.hello_sent.lock().await || !*peer.remote_verified.lock().await {
            return Ok(());
        }
        let payload = serde_json::json!({
            "type": PAIR_CAPABILITY_CAPS_TYPE,
            "protocolVersion": "openclaw-pair-v2",
            "supportedMessages": [
                PAIR_CAPABILITY_HELLO_TYPE,
                PAIR_CAPABILITY_CAPS_TYPE,
                OPENCLAW_CHAT_MESSAGE_TYPE
            ],
            "features": ["chat"],
            "appId": "openclaw",
            "appVersion": "desktop-shell"
        });
        self.send_peer_json(&peer, &payload).await?;
        *sent = true;
        Ok(())
    }

    pub(super) async fn handle_peer_message(
        &self,
        peer: Arc<DesktopPeer>,
        message: DataChannelMessage,
    ) -> Result<(), String> {
        let raw = String::from_utf8(message.data.to_vec())
            .map_err(|e| format!("peer payload 非 UTF-8: {}", e))?;
        let payload: Value =
            serde_json::from_str(&raw).map_err(|e| format!("解析 peer payload 失败: {}", e))?;
        let event_type = payload
            .get("type")
            .and_then(Value::as_str)
            .unwrap_or_default()
            .trim()
            .to_string();
        if event_type == PAIR_CAPABILITY_HELLO_TYPE {
            let binding_id = read_json_string(&payload, &["bindingId"]);
            let entity_type = read_json_string(&payload, &["entityType"]);
            let entity_id = read_json_string(&payload, &["entityId"]);
            let public_key = read_json_string(&payload, &["publicKey"]);
            let nonce = read_json_string(&payload, &["nonce"]);
            let signature = read_json_string(&payload, &["signature"]);
            if binding_id != peer.binding_id
                || entity_type != "mobile"
                || entity_id != peer.mobile_id
            {
                return Err("peer hello does not match trusted binding".to_string());
            }
            let mut mobile_public_key = {
                let state = self.state.lock().await;
                state
                    .channels
                    .iter()
                    .find(|item| item.binding_id == peer.binding_id)
                    .and_then(|item| item.mobile_public_key.clone())
                    .unwrap_or_default()
            };
            if mobile_public_key.trim().is_empty() {
                let app = {
                    let state = self.state.lock().await;
                    state.app.clone()
                };
                if let Some(app_handle) = app {
                    let _ = self.refresh_bindings(&app_handle).await;
                    mobile_public_key = {
                        let state = self.state.lock().await;
                        state
                            .channels
                            .iter()
                            .find(|item| item.binding_id == peer.binding_id)
                            .and_then(|item| item.mobile_public_key.clone())
                            .unwrap_or_default()
                    };
                }
            }
            if public_key != mobile_public_key {
                return Err("peer hello public key mismatch".to_string());
            }
            let verified = Self::verify_text(
                &mobile_public_key,
                &Self::build_peer_hello_text(
                    &binding_id,
                    &entity_type,
                    &entity_id,
                    &public_key,
                    &nonce,
                ),
                &signature,
            )?;
            if !verified {
                return Err("peer hello signature verification failed".to_string());
            }
            {
                let mut remote_verified = peer.remote_verified.lock().await;
                *remote_verified = true;
            }
            if !*peer.hello_sent.lock().await {
                self.send_peer_hello(peer.clone()).await?;
            }
            self.set_channel_peer_state(&peer.binding_id, "connected", "peer verified")
                .await;
            self.send_peer_capabilities(peer).await?;
            return Ok(());
        }

        if !*peer.remote_verified.lock().await {
            self.append_event("ignored peer payload before auth verification")
                .await;
            return Ok(());
        }

        if event_type == PAIR_CAPABILITY_CAPS_TYPE {
            let capabilities = PairBackendCapabilities {
                protocol_version: read_json_string(&payload, &["protocolVersion"]),
                supported_messages: payload
                    .get("supportedMessages")
                    .and_then(Value::as_array)
                    .cloned()
                    .unwrap_or_default()
                    .into_iter()
                    .filter_map(|item| item.as_str().map(|value| value.trim().to_string()))
                    .filter(|value| !value.is_empty())
                    .collect(),
                features: payload
                    .get("features")
                    .and_then(Value::as_array)
                    .cloned()
                    .unwrap_or_default()
                    .into_iter()
                    .filter_map(|item| item.as_str().map(|value| value.trim().to_string()))
                    .filter(|value| !value.is_empty())
                    .collect(),
                app_id: read_json_string(&payload, &["appId"]),
                app_version: read_json_string(&payload, &["appVersion"]),
            };
            {
                let mut state = self.state.lock().await;
                if let Some(channel) = state.channels.iter_mut().find(|item| item.binding_id == peer.binding_id) {
                    channel.peer_capabilities = Some(capabilities.clone());
                }
            }
            self.append_event(format!(
                "peer capabilities: mobile={} app={} version={} messages={}",
                peer.mobile_id,
                value_or_dash(&capabilities.app_id),
                value_or_dash(&capabilities.app_version),
                if capabilities.supported_messages.is_empty() {
                    "-".to_string()
                } else {
                    capabilities.supported_messages.join(",")
                }
            ))
            .await;
            self.emit_snapshot().await;
            return Ok(());
        }

        if event_type == OPENCLAW_CHAT_MESSAGE_TYPE {
            let text = payload
                .get("payload")
                .and_then(Value::as_object)
                .and_then(|map| map.get("text"))
                .and_then(Value::as_str)
                .unwrap_or_default()
                .to_string();
            let ts = payload
                .get("ts")
                .and_then(Value::as_u64)
                .unwrap_or_else(Self::now_ms);
            self.append_channel_message(
                &peer.binding_id,
                PairBackendMessage {
                    id: Self::random_id("msg"),
                    from: "mobile".to_string(),
                    text: text.clone(),
                    ts,
                },
            )
            .await;
            self.append_event(format!("peer chat from {}: {}", peer.mobile_id, text))
                .await;
            let app = {
                let state = self.state.lock().await;
                state.app.clone()
            };
            if let Some(app_handle) = app {
                let backend = self.clone();
                let binding_id = peer.binding_id.clone();
                let mobile_id = peer.mobile_id.clone();
                let forwarded_text = text.clone();
                tokio::spawn(async move {
                    if let Err(error) = backend
                        .forward_mobile_message_to_openclaw(
                            &app_handle,
                            &binding_id,
                            &mobile_id,
                            &forwarded_text,
                        )
                        .await
                    {
                        backend
                            .append_event(format!("openclaw chat.send failed: {}", error))
                            .await;
                    }
                });
            }
            return Ok(());
        }

        self.append_event(format!("peer app message from {}: {}", peer.mobile_id, event_type))
            .await;
        Ok(())
    }

    pub(super) async fn append_channel_message(&self, binding_id: &str, message: PairBackendMessage) {
        {
            let mut state = self.state.lock().await;
            if let Some(channel) = state
                .channels
                .iter_mut()
                .find(|item| item.binding_id == binding_id || item.channel_id == binding_id)
            {
                channel.messages.push(message);
                if channel.messages.len() > 300 {
                    let keep_from = channel.messages.len().saturating_sub(300);
                    channel.messages = channel.messages.split_off(keep_from);
                }
            }
        }
        self.emit_snapshot().await;
    }

    pub(super) async fn send_peer_json(&self, peer: &DesktopPeer, payload: &Value) -> Result<(), String> {
        let text = serde_json::to_string(payload).map_err(|e| format!("序列化 peer payload 失败: {}", e))?;
        let current = peer.data_channel.lock().await;
        let channel = current
            .as_ref()
            .cloned()
            .ok_or_else(|| "peer channel is not ready".to_string())?;
        channel
            .send_text(text)
            .await
            .map_err(|e| format!("发送 peer 消息失败: {}", e))?;
        Ok(())
    }

    pub(super) async fn send_chat_to_peer(
        &self,
        channel_id: &str,
        text: &str,
    ) -> Result<PairBackendSnapshot, String> {
        let (binding_id, mobile_id) = {
            let state = self.state.lock().await;
            let channel = state
                .channels
                .iter()
                .find(|item| item.channel_id == channel_id)
                .ok_or_else(|| "会话不存在".to_string())?;
            if channel.peer_state != "connected" {
                return Err("P2P 通道尚未就绪".to_string());
            }
            if let Some(capabilities) = &channel.peer_capabilities {
                if !capabilities.supported_messages.is_empty()
                    && !capabilities
                        .supported_messages
                        .iter()
                        .any(|item| item == OPENCLAW_CHAT_MESSAGE_TYPE)
                {
                    return Err("对端未声明支持 OpenClaw 聊天消息".to_string());
                }
            }
            (channel.binding_id.clone(), channel.mobile_id.clone())
        };
        let peer = {
            let state = self.state.lock().await;
            state
                .peers
                .get(&binding_id)
                .cloned()
                .ok_or_else(|| "peer channel is not ready".to_string())?
        };
        self.send_peer_json(
            &peer,
            &serde_json::json!({
                "type": OPENCLAW_CHAT_MESSAGE_TYPE,
                "payload": { "text": text },
                "ts": Self::now_ms(),
                "from": "desktop"
            }),
        )
        .await?;
        self.append_channel_message(
            &binding_id,
            PairBackendMessage {
                id: Self::random_id("msg"),
                from: "desktop".to_string(),
                text: text.to_string(),
                ts: Self::now_ms(),
            },
        )
        .await;
        self.append_event(format!("peer chat sent -> mobile={}", mobile_id))
            .await;
        Ok(self.snapshot().await)
    }

    pub(super) async fn set_channel_peer_state(&self, binding_id: &str, peer_state: &str, detail: &str) {
        {
            let mut state = self.state.lock().await;
            if let Some(channel) = state.channels.iter_mut().find(|item| item.binding_id == binding_id) {
                channel.peer_state = peer_state.to_string();
                channel.peer_detail = detail.to_string();
            }
        }
        self.append_event(format!(
            "peer {}: binding={}{}",
            peer_state,
            binding_id,
            if detail.is_empty() {
                String::new()
            } else {
                format!(" ({})", detail)
            }
        ))
        .await;
        self.emit_snapshot().await;
    }

    pub(super) async fn dispose_peer(&self, binding_id: &str, detail: &str, state_name: &str) {
        let peer = {
            let mut state = self.state.lock().await;
            state.peers.remove(binding_id)
        };
        if let Some(peer) = peer {
            if let Some(dc) = peer.data_channel.lock().await.take() {
                let _ = dc.close().await;
            }
            let _ = peer.peer.close().await;
        }
        {
            let mut state = self.state.lock().await;
            if let Some(channel) = state.channels.iter_mut().find(|item| item.binding_id == binding_id) {
                channel.peer_state = state_name.to_string();
                channel.peer_detail = detail.to_string();
            }
        }
        self.append_event(format!(
            "peer {}: binding={} ({})",
            state_name, binding_id, detail
        ))
        .await;
        self.emit_snapshot().await;
    }
}
