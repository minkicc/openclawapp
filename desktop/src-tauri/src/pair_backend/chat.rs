use super::*;

impl PairBackendHandle {
    fn normalize_chat_message_kind(value: &str) -> String {
        if value.trim() == "system" {
            "system".to_string()
        } else {
            "chat".to_string()
        }
    }

    fn normalize_chat_message_ids(values: &[String]) -> Vec<String> {
        let mut seen = std::collections::HashSet::new();
        values
            .iter()
            .map(|value| value.trim().to_string())
            .filter(|value| !value.is_empty())
            .filter(|value| seen.insert(value.clone()))
            .collect()
    }

    fn is_graph_chat_message(message: &PairBackendMessage) -> bool {
        Self::normalize_chat_message_kind(&message.kind) != "system" && !message.id.trim().is_empty()
    }

    fn compare_pair_message_order(
        left: &PairBackendMessage,
        right: &PairBackendMessage,
    ) -> std::cmp::Ordering {
        left.ts
            .cmp(&right.ts)
            .then_with(|| left.id.cmp(&right.id))
    }

    fn reconcile_channel_messages_locked(channel: &mut PairBackendChannel) {
        for message in channel.messages.iter_mut() {
            message.kind = Self::normalize_chat_message_kind(&message.kind);
            if message.kind == "system" {
                message.after.clear();
                message.missing_after.clear();
            } else {
                message.after = Self::normalize_chat_message_ids(&message.after);
                message.missing_after.clear();
            }
        }

        let known_ids = channel
            .messages
            .iter()
            .filter(|message| Self::is_graph_chat_message(message))
            .map(|message| message.id.clone())
            .collect::<std::collections::HashSet<_>>();

        for message in channel.messages.iter_mut() {
            if message.kind == "system" {
                continue;
            }
            message.missing_after = message
                .after
                .iter()
                .filter(|parent_id| !known_ids.contains(parent_id.as_str()))
                .cloned()
                .collect();
        }

        let message_by_id = channel
            .messages
            .iter()
            .filter(|message| Self::is_graph_chat_message(message))
            .map(|message| (message.id.clone(), message.clone()))
            .collect::<std::collections::HashMap<_, _>>();
        let mut indegree = std::collections::HashMap::<String, usize>::new();
        let mut children_by_parent =
            std::collections::HashMap::<String, Vec<String>>::new();

        for message in message_by_id.values() {
            let parent_ids = message
                .after
                .iter()
                .filter(|parent_id| known_ids.contains(parent_id.as_str()))
                .cloned()
                .collect::<Vec<_>>();
            indegree.insert(message.id.clone(), parent_ids.len());
            for parent_id in parent_ids {
                children_by_parent
                    .entry(parent_id)
                    .or_default()
                    .push(message.id.clone());
            }
        }

        let mut ready = message_by_id
            .values()
            .filter(|message| indegree.get(&message.id).copied().unwrap_or(0) == 0)
            .cloned()
            .collect::<Vec<_>>();
        ready.sort_by(Self::compare_pair_message_order);

        let mut ordered_ids = Vec::<String>::new();
        while !ready.is_empty() {
            let current = ready.remove(0);
            ordered_ids.push(current.id.clone());
            if let Some(children) = children_by_parent.get(&current.id).cloned() {
                for child_id in children {
                    let next_degree = indegree
                        .get(&child_id)
                        .copied()
                        .unwrap_or(0)
                        .saturating_sub(1);
                    indegree.insert(child_id.clone(), next_degree);
                    if next_degree == 0 {
                        if let Some(child) = message_by_id.get(&child_id).cloned() {
                            ready.push(child);
                        }
                    }
                }
                ready.sort_by(Self::compare_pair_message_order);
            }
        }

        let ordered_set = ordered_ids
            .iter()
            .cloned()
            .collect::<std::collections::HashSet<_>>();
        let mut remaining = message_by_id
            .values()
            .filter(|message| !ordered_set.contains(message.id.as_str()))
            .cloned()
            .collect::<Vec<_>>();
        remaining.sort_by(Self::compare_pair_message_order);
        ordered_ids.extend(remaining.into_iter().map(|message| message.id));

        let order_index = ordered_ids
            .iter()
            .enumerate()
            .map(|(index, id)| (id.clone(), index))
            .collect::<std::collections::HashMap<_, _>>();

        channel.messages.sort_by(|left, right| match (
            order_index.get(&left.id).copied(),
            order_index.get(&right.id).copied(),
        ) {
            (Some(left_index), Some(right_index)) => left_index.cmp(&right_index),
            _ => Self::compare_pair_message_order(left, right),
        });

        let mut missing_ids = channel
            .messages
            .iter()
            .flat_map(|message| message.missing_after.clone())
            .collect::<Vec<_>>();
        missing_ids.sort();
        missing_ids.dedup();
        channel.missing_message_ids = missing_ids;
    }

    fn collect_channel_leaf_ids_locked(channel: &PairBackendChannel) -> Vec<String> {
        let known_ids = channel
            .messages
            .iter()
            .filter(|message| Self::is_graph_chat_message(message))
            .map(|message| message.id.clone())
            .collect::<std::collections::HashSet<_>>();
        let referenced_ids = channel
            .messages
            .iter()
            .filter(|message| Self::is_graph_chat_message(message))
            .flat_map(|message| {
                message
                    .after
                    .iter()
                    .filter(|parent_id| known_ids.contains(parent_id.as_str()))
                    .cloned()
                    .collect::<Vec<_>>()
            })
            .collect::<std::collections::HashSet<_>>();

        channel
            .messages
            .iter()
            .filter(|message| Self::is_graph_chat_message(message))
            .filter(|message| !referenced_ids.contains(message.id.as_str()))
            .map(|message| message.id.clone())
            .collect()
    }

    pub(super) async fn current_channel_leaf_ids(&self, binding_id: &str) -> Vec<String> {
        let state = self.state.lock().await;
        state
            .channels
            .iter()
            .find(|channel| channel.binding_id == binding_id || channel.channel_id == binding_id)
            .map(Self::collect_channel_leaf_ids_locked)
            .unwrap_or_default()
    }

    pub(super) async fn channel_supports_message_type(
        &self,
        binding_id: &str,
        message_type: &str,
    ) -> bool {
        let normalized = message_type.trim();
        if normalized.is_empty() {
            return false;
        }
        let state = self.state.lock().await;
        state
            .channels
            .iter()
            .find(|channel| channel.binding_id == binding_id || channel.channel_id == binding_id)
            .and_then(|channel| channel.peer_capabilities.as_ref())
            .map(|capabilities| {
                !capabilities.supported_messages.is_empty()
                    && capabilities
                        .supported_messages
                        .iter()
                        .any(|item| item.trim() == normalized)
            })
            .unwrap_or(false)
    }

    fn parse_openclaw_chat_payload(payload: &Value) -> Option<PairBackendMessage> {
        let body = payload.get("payload")?.as_object()?;
        let text = body.get("text").and_then(Value::as_str).unwrap_or_default().to_string();
        if text.trim().is_empty() {
            return None;
        }
        let after = body
            .get("after")
            .and_then(Value::as_array)
            .cloned()
            .unwrap_or_default()
            .into_iter()
            .filter_map(|item| item.as_str().map(|value| value.trim().to_string()))
            .filter(|value| !value.is_empty())
            .collect::<Vec<_>>();
        let ts = payload
            .get("ts")
            .and_then(Value::as_u64)
            .unwrap_or_else(Self::now_ms);
        let id = body
            .get("id")
            .and_then(Value::as_str)
            .map(|value| value.trim().to_string())
            .filter(|value| !value.is_empty())
            .unwrap_or_else(|| Self::random_id("msg"));
        Some(PairBackendMessage {
            id,
            from: String::new(),
            text,
            ts,
            kind: "chat".to_string(),
            after,
            missing_after: Vec::new(),
        })
    }

    fn parse_openclaw_sync_request_ids(payload: &Value) -> Vec<String> {
        payload
            .get("payload")
            .and_then(Value::as_object)
            .and_then(|body| body.get("messageIds"))
            .and_then(Value::as_array)
            .cloned()
            .unwrap_or_default()
            .into_iter()
            .filter_map(|item| item.as_str().map(|value| value.trim().to_string()))
            .filter(|value| !value.is_empty())
            .collect::<Vec<_>>()
    }

    fn parse_openclaw_ack_ids(payload: &Value) -> Vec<String> {
        payload
            .get("payload")
            .and_then(Value::as_object)
            .and_then(|body| body.get("messageIds"))
            .and_then(Value::as_array)
            .cloned()
            .unwrap_or_default()
            .into_iter()
            .filter_map(|item| item.as_str().map(|value| value.trim().to_string()))
            .filter(|value| !value.is_empty())
            .collect::<Vec<_>>()
    }

    pub(super) fn build_openclaw_chat_payload(message: &PairBackendMessage, from: &str) -> Value {
        serde_json::json!({
            "type": OPENCLAW_CHAT_MESSAGE_TYPE,
            "payload": {
                "id": message.id,
                "after": message.after,
                "text": message.text,
            },
            "ts": message.ts,
            "from": from,
        })
    }

    fn build_openclaw_chat_ack_payload(message_ids: &[String], from: &str) -> Value {
        serde_json::json!({
            "type": OPENCLAW_CHAT_ACK_TYPE,
            "payload": {
                "messageIds": Self::normalize_chat_message_ids(message_ids),
            },
            "ts": Self::now_ms(),
            "from": from,
        })
    }

    fn build_openclaw_sync_request_payload(message_ids: &[String], from: &str) -> Value {
        serde_json::json!({
            "type": OPENCLAW_CHAT_SYNC_REQUEST_TYPE,
            "payload": {
                "messageIds": Self::normalize_chat_message_ids(message_ids),
            },
            "ts": Self::now_ms(),
            "from": from,
        })
    }

    pub(super) async fn build_outgoing_chat_message(
        &self,
        binding_id: &str,
        from: &str,
        text: &str,
        ts: Option<u64>,
    ) -> PairBackendMessage {
        PairBackendMessage {
            id: Self::random_id("msg"),
            from: from.trim().to_string(),
            text: text.trim().to_string(),
            ts: ts.unwrap_or_else(Self::now_ms),
            kind: "chat".to_string(),
            after: self.current_channel_leaf_ids(binding_id).await,
            missing_after: Vec::new(),
        }
    }

    async fn mark_mobile_ack_received(&self, message_ids: &[String]) {
        let normalized_ids = Self::normalize_chat_message_ids(message_ids);
        if normalized_ids.is_empty() {
            return;
        }
        let removed = {
            let mut state = self.state.lock().await;
            normalized_ids
                .iter()
                .filter_map(|message_id| state.pending_mobile_acks.remove(message_id))
                .collect::<Vec<_>>()
        };
        if !removed.is_empty() {
            self.append_event(format!(
                "mobile ack received ids={}",
                removed
                    .iter()
                    .map(|pending| pending.message_id.clone())
                    .collect::<Vec<_>>()
                    .join(",")
            ))
            .await;
        }
    }

    fn schedule_mobile_ack_retry(&self, message_id: String) {
        let backend = self.clone();
        std::thread::spawn(move || {
            std::thread::sleep(Duration::from_secs(3));
            tauri::async_runtime::block_on(async move {
                backend.retry_pending_mobile_ack(&message_id).await;
            });
        });
    }

    pub(super) async fn register_pending_mobile_ack(
        &self,
        binding_id: &str,
        mobile_id: &str,
        message_id: &str,
        payload: &Value,
        prefer_relay: bool,
    ) {
        let normalized_message_id = message_id.trim().to_string();
        if normalized_message_id.is_empty() {
            return;
        }
        {
            let mut state = self.state.lock().await;
            state.pending_mobile_acks.insert(
                normalized_message_id.clone(),
                PendingMobileAck {
                    message_id: normalized_message_id.clone(),
                    binding_id: binding_id.trim().to_string(),
                    mobile_id: mobile_id.trim().to_string(),
                    payload: payload.clone(),
                    prefer_relay,
                    attempts: 0,
                },
            );
        }
    }

    pub(super) async fn arm_pending_mobile_ack(&self, message_id: &str, prefer_relay: bool) {
        let normalized_message_id = message_id.trim().to_string();
        if normalized_message_id.is_empty() {
            return;
        }
        let exists = {
            let mut state = self.state.lock().await;
            let Some(entry) = state.pending_mobile_acks.get_mut(&normalized_message_id) else {
                return;
            };
            entry.prefer_relay = prefer_relay;
            true
        };
        if exists {
            self.schedule_mobile_ack_retry(normalized_message_id);
        }
    }

    pub(super) async fn clear_pending_mobile_ack(&self, message_id: &str) {
        let normalized_message_id = message_id.trim().to_string();
        if normalized_message_id.is_empty() {
            return;
        }
        let mut state = self.state.lock().await;
        state.pending_mobile_acks.remove(&normalized_message_id);
    }

    async fn retry_pending_mobile_ack(&self, message_id: &str) {
        let pending = {
            let mut state = self.state.lock().await;
            let Some(entry) = state.pending_mobile_acks.get_mut(message_id) else {
                return;
            };
            if entry.attempts >= 2 {
                state.pending_mobile_acks.remove(message_id);
                None
            } else {
                entry.attempts += 1;
                Some(entry.clone())
            }
        };
        let Some(pending) = pending else {
            self.append_event(format!("mobile ack timeout: id={}", message_id))
                .await;
            return;
        };
        match self
            .send_app_envelope_to_mobile_with_delivery(
                &pending.binding_id,
                &pending.mobile_id,
                pending.payload.clone(),
                pending.prefer_relay || pending.attempts > 0,
            )
            .await
        {
            Ok(delivery) => {
                self.append_event(format!(
                    "retry chat -> mobile={} via={} id={} attempt={}",
                    pending.mobile_id, delivery, pending.message_id, pending.attempts
                ))
                .await;
                self.schedule_mobile_ack_retry(pending.message_id.clone());
            }
            Err(error) => {
                self.append_event(format!(
                    "retry chat failed: mobile={} id={} error={}",
                    pending.mobile_id, pending.message_id, error
                ))
                .await;
            }
        }
    }

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
        if !self.is_current_peer_instance(&peer.binding_id, peer).await {
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
        if !self.is_current_peer_instance(&peer.binding_id, peer).await {
            self.append_event(format!(
                "ignored stale peer callback: binding={} ({})",
                peer.binding_id, detail
            ))
            .await;
            return;
        }
        self.dispose_peer(&peer.binding_id, detail, state_name)
            .await;
    }

    pub(super) async fn dispose_peer_if_current_channel(
        &self,
        peer: &Arc<DesktopPeer>,
        channel: &Arc<RTCDataChannel>,
        detail: &str,
        state_name: &str,
    ) {
        if !self.is_current_data_channel_instance(peer, channel).await {
            self.append_event(format!(
                "ignored stale data channel callback: binding={} ({})",
                peer.binding_id, detail
            ))
            .await;
            return;
        }
        self.dispose_peer(&peer.binding_id, detail, state_name)
            .await;
    }

    pub(super) async fn send_peer_hello(&self, peer: Arc<DesktopPeer>) -> Result<(), String> {
        let (identity, device_id) = {
            let state = self.state.lock().await;
            (
                state
                    .identity
                    .clone()
                    .ok_or_else(|| "desktop identity missing".to_string())?,
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

    pub(super) async fn send_peer_capabilities(
        &self,
        peer: Arc<DesktopPeer>,
    ) -> Result<(), String> {
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
                OPENCLAW_CHAT_MESSAGE_TYPE,
                OPENCLAW_CHAT_ACK_TYPE,
                OPENCLAW_CHAT_SYNC_REQUEST_TYPE
            ],
            "features": ["chat"],
            "appId": "openclaw",
            "appVersion": "desktop-shell"
        });
        self.send_peer_json(&peer, &payload).await?;
        *sent = true;
        Ok(())
    }

    pub(super) async fn process_mobile_app_message(
        &self,
        binding_id: &str,
        mobile_id: &str,
        payload: &Value,
        source: &str,
    ) -> Result<(), String> {
        let event_type = payload
            .get("type")
            .and_then(Value::as_str)
            .unwrap_or_default()
            .trim()
            .to_string();

        if event_type == OPENCLAW_CHAT_ACK_TYPE {
            let message_ids = Self::parse_openclaw_ack_ids(payload);
            self.mark_mobile_ack_received(&message_ids).await;
            return Ok(());
        }

        if event_type == OPENCLAW_CHAT_SYNC_REQUEST_TYPE {
            let message_ids = Self::parse_openclaw_sync_request_ids(payload);
            if message_ids.is_empty() {
                return Ok(());
            }
            self.resend_channel_messages_to_mobile(
                binding_id,
                mobile_id,
                &message_ids,
                source.trim() == "relay",
            )
            .await;
            return Ok(());
        }

        if event_type == OPENCLAW_CHAT_MESSAGE_TYPE {
            let Some(mut message) = Self::parse_openclaw_chat_payload(payload) else {
                return Ok(());
            };
            message.from = "mobile".to_string();
            let text = message.text.clone();
            let (inserted, newly_missing_ids) =
                self.append_channel_message(binding_id, message).await;
            self.append_event(format!("{} chat from {}: {}", source, mobile_id, text))
                .await;
            if !newly_missing_ids.is_empty() {
                self.request_missing_messages_from_mobile(
                    binding_id,
                    mobile_id,
                    &newly_missing_ids,
                    source.trim() == "relay",
                )
                .await;
            }
            if !inserted {
                return Ok(());
            }
            let app = {
                let state = self.state.lock().await;
                state.app.clone()
            };
            if let Some(app_handle) = app {
                let backend = self.clone();
                let binding_id = binding_id.trim().to_string();
                let mobile_id = mobile_id.trim().to_string();
                let forwarded_text = text.clone();
                let forwarded_source = source.trim().to_string();
                tokio::spawn(async move {
                    if let Err(error) = backend
                        .forward_mobile_message_to_openclaw(
                            &app_handle,
                            &binding_id,
                            &mobile_id,
                            &forwarded_text,
                            &forwarded_source,
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

        self.append_event(format!(
            "{} app message from {}: {}",
            source,
            mobile_id,
            value_or_dash(&event_type)
        ))
        .await;
        Ok(())
    }

    async fn request_missing_messages_from_mobile(
        &self,
        binding_id: &str,
        mobile_id: &str,
        message_ids: &[String],
        prefer_relay: bool,
    ) {
        let normalized_ids = Self::normalize_chat_message_ids(message_ids);
        if normalized_ids.is_empty() {
            return;
        }
        let payload = Self::build_openclaw_sync_request_payload(&normalized_ids, "desktop");
        match self
            .send_app_envelope_to_mobile_with_delivery(
                binding_id,
                mobile_id,
                payload,
                prefer_relay,
            )
            .await
        {
            Ok(delivery) => {
                self.append_event(format!(
                    "request missing chat -> mobile={} via={} ids={}",
                    mobile_id,
                    delivery,
                    normalized_ids.join(",")
                ))
                .await;
            }
            Err(error) => {
                self.append_event(format!(
                    "request missing chat failed: mobile={} error={}",
                    mobile_id, error
                ))
                .await;
            }
        }
    }

    async fn resend_channel_messages_to_mobile(
        &self,
        binding_id: &str,
        mobile_id: &str,
        message_ids: &[String],
        prefer_relay: bool,
    ) {
        let normalized_ids = Self::normalize_chat_message_ids(message_ids);
        if normalized_ids.is_empty() {
            return;
        }
        let known_messages = {
            let state = self.state.lock().await;
            state
                .channels
                .iter()
                .find(|item| item.binding_id == binding_id || item.channel_id == binding_id)
                .map(|channel| {
                    channel
                        .messages
                        .iter()
                        .filter(|message| {
                            Self::normalize_chat_message_kind(&message.kind) != "system"
                                && message.from != "mobile"
                                && normalized_ids.contains(&message.id)
                        })
                        .cloned()
                        .collect::<Vec<_>>()
                })
                .unwrap_or_default()
        };

        for message in known_messages {
            let payload = Self::build_openclaw_chat_payload(&message, "desktop");
            match self
                .send_app_envelope_to_mobile_with_delivery(
                    binding_id,
                    mobile_id,
                    payload,
                    prefer_relay,
                )
                .await
            {
                Ok(delivery) => {
                    self.append_event(format!(
                        "resend chat -> mobile={} via={} id={}",
                        mobile_id, delivery, message.id
                    ))
                    .await;
                }
                Err(error) => {
                    self.append_event(format!(
                        "resend chat failed: mobile={} id={} error={}",
                        mobile_id, message.id, error
                    ))
                    .await;
                }
            }
        }
    }

    async fn relay_app_message_to_mobile(
        &self,
        app: &AppHandle,
        binding_id: &str,
        mobile_id: &str,
        payload: &Value,
    ) -> Result<(), String> {
        self.send_signal(
            app,
            mobile_id,
            OPENCLAW_RELAY_APP_SIGNAL_TYPE,
            serde_json::json!({
                "bindingId": binding_id,
                "mobileId": mobile_id,
                "message": payload,
            }),
        )
        .await
    }

    pub(super) async fn send_app_envelope_to_mobile(
        &self,
        binding_id: &str,
        mobile_id: &str,
        payload: Value,
    ) -> Result<&'static str, String> {
        self.send_app_envelope_to_mobile_with_delivery(binding_id, mobile_id, payload, false)
            .await
    }

    pub(super) async fn send_app_envelope_to_mobile_with_delivery(
        &self,
        binding_id: &str,
        mobile_id: &str,
        payload: Value,
        prefer_relay: bool,
    ) -> Result<&'static str, String> {
        let (peer, peer_ready) = {
            let state = self.state.lock().await;
            let peer = state.peers.get(binding_id).cloned();
            let peer_ready = state
                .channels
                .iter()
                .find(|item| item.binding_id == binding_id)
                .map(|item| item.peer_state == "connected")
                .unwrap_or(false);
            (peer, peer_ready)
        };

        if !prefer_relay && peer_ready {
            if let Some(peer) = peer {
                match self.send_peer_json(&peer, &payload).await {
                    Ok(_) => return Ok("p2p"),
                    Err(error) => {
                        self.append_event(format!(
                            "peer send failed, fallback to relay: binding={} mobile={} error={}",
                            binding_id,
                            mobile_id,
                            error
                        ))
                        .await;
                    }
                }
            }
        }

        let app = {
            let state = self.state.lock().await;
            state.app.clone()
        }
        .ok_or_else(|| "app handle is unavailable".to_string())?;
        self.relay_app_message_to_mobile(&app, binding_id, mobile_id, &payload)
            .await?;
        Ok("relay")
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
                if let Some(channel) = state
                    .channels
                    .iter_mut()
                    .find(|item| item.binding_id == peer.binding_id)
                {
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

        self.process_mobile_app_message(&peer.binding_id, &peer.mobile_id, &payload, "peer")
            .await
    }

    pub(super) async fn append_channel_message(
        &self,
        binding_id: &str,
        mut message: PairBackendMessage,
    ) -> (bool, Vec<String>) {
        let mut inserted = false;
        let mut newly_missing_ids = Vec::<String>::new();
        {
            let mut state = self.state.lock().await;
            if let Some(channel) = state
                .channels
                .iter_mut()
                .find(|item| item.binding_id == binding_id || item.channel_id == binding_id)
            {
                let previous_missing = channel
                    .missing_message_ids
                    .iter()
                    .cloned()
                    .collect::<std::collections::HashSet<_>>();

                message.kind = Self::normalize_chat_message_kind(&message.kind);
                if message.kind == "system" {
                    message.after.clear();
                    message.missing_after.clear();
                } else {
                    message.after = Self::normalize_chat_message_ids(&message.after);
                }

                if let Some(existing) = channel
                    .messages
                    .iter_mut()
                    .find(|item| !message.id.trim().is_empty() && item.id == message.id)
                {
                    existing.from = message.from.clone();
                    existing.text = message.text.clone();
                    existing.ts = message.ts;
                    existing.kind = message.kind.clone();
                    existing.after = message.after.clone();
                } else {
                    inserted = true;
                    channel.messages.push(message);
                    if channel.messages.len() > 300 {
                        let keep_from = channel.messages.len().saturating_sub(300);
                        channel.messages = channel.messages.split_off(keep_from);
                    }
                }
                Self::reconcile_channel_messages_locked(channel);
                newly_missing_ids = channel
                    .missing_message_ids
                    .iter()
                    .filter(|message_id| !previous_missing.contains(message_id.as_str()))
                    .cloned()
                    .collect();
            }
        }
        self.emit_snapshot().await;
        (inserted, newly_missing_ids)
    }

    pub(super) async fn send_peer_json(
        &self,
        peer: &DesktopPeer,
        payload: &Value,
    ) -> Result<(), String> {
        let text = serde_json::to_string(payload)
            .map_err(|e| format!("序列化 peer payload 失败: {}", e))?;
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
            if channel.trust_state == "pending" {
                return Err("请先在移动端完成安全码确认".to_string());
            }
            if channel.trust_state == "revoked" {
                return Err("该绑定已被撤销".to_string());
            }
            if let Some(capabilities) = &channel.peer_capabilities {
                if channel.peer_state == "connected"
                    && !capabilities.supported_messages.is_empty()
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
        let outgoing = self
            .build_outgoing_chat_message(&binding_id, "desktop", text, None)
            .await;
        let payload = Self::build_openclaw_chat_payload(&outgoing, "desktop");
        let expect_ack = self
            .channel_supports_message_type(&binding_id, OPENCLAW_CHAT_ACK_TYPE)
            .await;
        if expect_ack {
            self.register_pending_mobile_ack(&binding_id, &mobile_id, &outgoing.id, &payload, false)
                .await;
        }
        let delivery = match self
            .send_app_envelope_to_mobile(
                &binding_id,
                &mobile_id,
                payload.clone(),
            )
            .await
        {
            Ok(delivery) => delivery,
            Err(error) => {
                if expect_ack {
                    self.clear_pending_mobile_ack(&outgoing.id).await;
                }
                return Err(error);
            }
        };
        let _ = self.append_channel_message(&binding_id, outgoing).await;
        if expect_ack {
            self.arm_pending_mobile_ack(
                &payload["payload"]["id"].as_str().unwrap_or_default(),
                delivery == "relay",
            )
            .await;
        }
        self.append_event(format!("chat sent -> mobile={} via={}", mobile_id, delivery))
            .await;
        Ok(self.snapshot().await)
    }

    pub(super) async fn set_channel_peer_state(
        &self,
        binding_id: &str,
        peer_state: &str,
        detail: &str,
    ) {
        {
            let mut state = self.state.lock().await;
            if let Some(channel) = state
                .channels
                .iter_mut()
                .find(|item| item.binding_id == binding_id)
            {
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
            if let Some(channel) = state
                .channels
                .iter_mut()
                .find(|item| item.binding_id == binding_id)
            {
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
