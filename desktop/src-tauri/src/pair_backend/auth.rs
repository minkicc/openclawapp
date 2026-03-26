use super::*;
use std::path::PathBuf;
use std::process::Command;

impl PairBackendHandle {
    fn persist_pair_identity(
        &self,
        app: &AppHandle,
        identity: &PairIdentityRecord,
    ) -> Result<(), String> {
        let path = Self::pair_identity_path(app)?;
        let serialized = serde_json::to_string_pretty(identity)
            .map_err(|e| format!("序列化桌面配对身份失败: {}", e))?;
        std::fs::write(&path, serialized).map_err(|e| format!("写入桌面配对身份失败: {}", e))?;
        Ok(())
    }

    fn decode_utf16le_bytes(raw: &[u8]) -> Option<String> {
        if raw.is_empty() || raw.len() % 2 != 0 {
            return None;
        }
        let mut units = Vec::with_capacity(raw.len() / 2);
        for chunk in raw.chunks_exact(2) {
            units.push(u16::from_le_bytes([chunk[0], chunk[1]]));
        }
        String::from_utf16(&units).ok()
    }

    fn try_read_legacy_pair_identity_from_webkit(entity_id: &str) -> Option<PairIdentityRecord> {
        let normalized_entity_id = entity_id.trim();
        if normalized_entity_id.is_empty() {
            return None;
        }

        let home = std::env::var("HOME").ok()?;
        let webkit_root = PathBuf::from(home).join("Library").join("WebKit");
        let key = format!(
            "openclaw.pair.v2.identity.desktop.{}",
            normalized_entity_id
        );
        let mut candidates = Vec::new();
        for app_dir in [
            "dev.openclawapp.desktop",
            "com.openclaw.desktop",
            "OpenClaw",
            "tauri-app",
        ] {
            let base = webkit_root.join(app_dir).join("WebsiteData").join("Default");
            if !base.exists() {
                continue;
            }
            let Ok(level1_entries) = std::fs::read_dir(&base) else {
                continue;
            };
            for level1 in level1_entries.flatten() {
                let level1_path = level1.path();
                if !level1_path.is_dir() {
                    continue;
                }
                let Ok(level2_entries) = std::fs::read_dir(&level1_path) else {
                    continue;
                };
                for level2 in level2_entries.flatten() {
                    let db = level2
                        .path()
                        .join("LocalStorage")
                        .join("localstorage.sqlite3");
                    if db.exists() {
                        candidates.push(db);
                    }
                }
            }
        }
        candidates.sort();
        candidates.dedup();

        for db in candidates {
            let Ok(output) = Command::new("sqlite3")
                .arg(db.as_os_str())
                .arg(format!(
                    "select hex(value) from ItemTable where key = '{}' limit 1;",
                    key.replace('\'', "''")
                ))
                .output()
            else {
                continue;
            };
            if !output.status.success() {
                continue;
            }
            let hex_text = String::from_utf8_lossy(&output.stdout).trim().to_string();
            if hex_text.is_empty() {
                continue;
            }
            let Ok(raw_bytes) = hex::decode(hex_text) else {
                continue;
            };
            let Some(json_text) = Self::decode_utf16le_bytes(&raw_bytes) else {
                continue;
            };
            let Ok(identity) = serde_json::from_str::<PairIdentityRecord>(json_text.trim()) else {
                continue;
            };
            if identity.entity_id.trim() == normalized_entity_id
                && !identity.public_key.trim().is_empty()
                && !identity.private_key.trim().is_empty()
            {
                return Some(identity);
            }
        }

        None
    }

    async fn try_restore_legacy_pair_identity(
        &self,
        app: &AppHandle,
        entity_id: &str,
    ) -> Result<Option<PairIdentityRecord>, String> {
        let recovered = Self::try_read_legacy_pair_identity_from_webkit(entity_id);
        let Some(identity) = recovered else {
            return Ok(None);
        };
        self.persist_pair_identity(app, &identity)?;
        {
            let mut state = self.state.lock().await;
            state.identity = Some(identity.clone());
        }
        Ok(Some(identity))
    }

    pub(super) async fn load_or_create_identity(
        &self,
        app: &AppHandle,
        entity_id: &str,
    ) -> Result<PairIdentityRecord, String> {
        let cached = {
            let state = self.state.lock().await;
            state.identity.clone()
        };
        if let Some(identity) = cached {
            if identity.entity_id == entity_id {
                return Ok(identity);
            }
        }

        let path = Self::pair_identity_path(app)?;
        if path.exists() {
            let raw = std::fs::read_to_string(&path)
                .map_err(|e| format!("读取桌面配对身份失败: {}", e))?;
            let mut identity: PairIdentityRecord =
                serde_json::from_str(&raw).map_err(|e| format!("解析桌面配对身份失败: {}", e))?;
            identity.entity_id = entity_id.to_string();
            {
                let mut state = self.state.lock().await;
                state.identity = Some(identity.clone());
            }
            return Ok(identity);
        }

        if let Some(identity) = self.try_restore_legacy_pair_identity(app, entity_id).await? {
            self.append_event(format!(
                "recovered pair identity from legacy webview storage: device={}",
                entity_id
            ))
            .await;
            return Ok(identity);
        }

        let signing_key = SigningKey::generate(&mut OsRng);
        let identity = PairIdentityRecord {
            entity_id: entity_id.to_string(),
            public_key: URL_SAFE_NO_PAD.encode(signing_key.verifying_key().as_bytes()),
            private_key: URL_SAFE_NO_PAD.encode(signing_key.to_bytes()),
        };
        self.persist_pair_identity(app, &identity)?;
        {
            let mut state = self.state.lock().await;
            state.identity = Some(identity.clone());
        }
        Ok(identity)
    }

    pub(super) fn build_auth_login_text(challenge: &PairChallenge) -> String {
        format!(
            "openclaw-v2-auth-login\n{}\n{}\n{}\n{}\n{}",
            challenge.challenge_id,
            challenge.nonce,
            challenge.entity_type,
            challenge.entity_id,
            challenge.public_key
        )
    }

    pub(super) fn build_peer_hello_text(
        binding_id: &str,
        entity_type: &str,
        entity_id: &str,
        public_key: &str,
        nonce: &str,
    ) -> String {
        format!(
            "openclaw-v2-peer-hello\n{}\n{}\n{}\n{}\n{}",
            binding_id, entity_type, entity_id, public_key, nonce
        )
    }

    pub(super) fn sign_text(private_key_base64url: &str, text: &str) -> Result<String, String> {
        let secret_bytes = URL_SAFE_NO_PAD
            .decode(private_key_base64url)
            .map_err(|e| format!("解析私钥失败: {}", e))?;
        let signing_key = match secret_bytes.len() {
            32 => {
                let mut raw = [0u8; 32];
                raw.copy_from_slice(&secret_bytes);
                SigningKey::from_bytes(&raw)
            }
            64 => {
                let mut raw = [0u8; 32];
                raw.copy_from_slice(&secret_bytes[..32]);
                SigningKey::from_bytes(&raw)
            }
            _ => return Err("私钥长度无效".to_string()),
        };
        Ok(URL_SAFE_NO_PAD.encode(signing_key.sign(text.as_bytes()).to_bytes()))
    }

    pub(super) fn verify_text(public_key_base64url: &str, text: &str, signature_base64url: &str) -> Result<bool, String> {
        let public_key = URL_SAFE_NO_PAD
            .decode(public_key_base64url)
            .map_err(|e| format!("解析公钥失败: {}", e))?;
        let signature_bytes = URL_SAFE_NO_PAD
            .decode(signature_base64url)
            .map_err(|e| format!("解析签名失败: {}", e))?;
        let verifying_key = VerifyingKey::from_bytes(
            &public_key
                .as_slice()
                .try_into()
                .map_err(|_| "公钥长度无效".to_string())?,
        )
        .map_err(|e| format!("构造公钥失败: {}", e))?;
        let signature = Signature::from_slice(&signature_bytes)
            .map_err(|e| format!("构造签名失败: {}", e))?;
        Ok(verifying_key.verify(text.as_bytes(), &signature).is_ok())
    }

    pub(super) async fn request_json<T: for<'de> Deserialize<'de>>(
        &self,
        base_url: &str,
        path: &str,
        method: reqwest::Method,
        body: Option<Value>,
        token: Option<&str>,
    ) -> Result<T, String> {
        let url = format!(
            "{}/{}",
            base_url.trim_end_matches('/'),
            path.trim_start_matches('/')
        );
        let mut request = self.http.request(method, &url);
        request = request.header(CONTENT_TYPE, "application/json");
        if let Some(auth) = token.filter(|value| !value.trim().is_empty()) {
            request = request.header(AUTHORIZATION, format!("Bearer {}", auth.trim()));
        }
        if let Some(json) = body {
            request = request.json(&json);
        }
        let response = request
            .send()
            .await
            .map_err(|e| format!("请求 {} 失败: {}", path, e))?;
        let status = response.status();
        let value: Value = response
            .json()
            .await
            .map_err(|e| format!("解析 {} 响应失败: {}", path, e))?;
        if !status.is_success() || value.get("ok").and_then(Value::as_bool) == Some(false) {
            let message = value
                .get("message")
                .and_then(Value::as_str)
                .or_else(|| value.get("error").and_then(Value::as_str))
                .unwrap_or("request failed");
            return Err(message.to_string());
        }
        serde_json::from_value(value).map_err(|e| format!("解析 {} 数据失败: {}", path, e))
    }

    pub(super) async fn ensure_auth_session(&self, app: &AppHandle) -> Result<(String, String, PairIdentityRecord, PairAuthSession), String> {
        let (base_url, device_id, cached_auth_base_url, cached_session) = {
            let state = self.state.lock().await;
            (
                state.configured_server_url.clone(),
                state.configured_device_id.clone(),
                state.auth_base_url.clone(),
                state.auth_session.clone(),
            )
        };
        if base_url.is_empty() || device_id.is_empty() {
            return Err("通信尚未配置".to_string());
        }
        if let Some(session) = cached_session {
            if cached_auth_base_url == base_url && !session.token.trim().is_empty() {
                let identity = self.load_or_create_identity(app, &device_id).await?;
                return Ok((base_url, device_id, identity, session));
            }
        }

        let mut identity = self.load_or_create_identity(app, &device_id).await?;
        let session = match self
            .request_auth_session_with_identity(&base_url, &device_id, &identity)
            .await
        {
            Ok(session) => session,
            Err(error) if error.contains("already exists with another public key") => {
                if let Some(restored) = self.try_restore_legacy_pair_identity(app, &device_id).await? {
                    identity = restored;
                    self.append_event(format!(
                        "restored legacy pair identity after server mismatch: device={}",
                        device_id
                    ))
                    .await;
                    self.request_auth_session_with_identity(&base_url, &device_id, &identity)
                        .await?
                } else {
                    return Err(error);
                }
            }
            Err(error) => return Err(error),
        };
        {
            let mut state = self.state.lock().await;
            state.identity = Some(identity.clone());
            state.auth_session = Some(session.clone());
            state.auth_base_url = base_url.clone();
        }
        self.append_event(format!("v2 auth ready: device={}", device_id)).await;
        Ok((base_url, device_id, identity, session))
    }

    async fn request_auth_session_with_identity(
        &self,
        base_url: &str,
        device_id: &str,
        identity: &PairIdentityRecord,
    ) -> Result<PairAuthSession, String> {
        let challenge_response: Value = self
            .request_json(
                base_url,
                "/v2/auth/challenge",
                reqwest::Method::POST,
                Some(serde_json::json!({
                    "entityType": "desktop",
                    "entityId": device_id,
                    "publicKey": identity.public_key,
                })),
                None,
            )
            .await?;
        let challenge: PairChallenge = serde_json::from_value(
            challenge_response
                .get("challenge")
                .cloned()
                .ok_or_else(|| "challenge 响应缺失".to_string())?,
        )
        .map_err(|e| format!("解析 challenge 失败: {}", e))?;
        let signature =
            Self::sign_text(&identity.private_key, &Self::build_auth_login_text(&challenge))?;
        let login_response: Value = self
            .request_json(
                base_url,
                "/v2/auth/login",
                reqwest::Method::POST,
                Some(serde_json::json!({
                    "entityType": "desktop",
                    "entityId": device_id,
                    "publicKey": identity.public_key,
                    "challengeId": challenge.challenge_id,
                    "signature": signature,
                })),
                None,
            )
            .await?;
        serde_json::from_value(
            login_response
                .get("session")
                .cloned()
                .ok_or_else(|| "login 响应缺失".to_string())?,
        )
        .map_err(|e| format!("解析 auth session 失败: {}", e))
    }

    pub(super) async fn announce_presence(&self, app: &AppHandle) -> Result<(String, String, PairIdentityRecord, PairAuthSession), String> {
        let (base_url, device_id, identity, session) = self.ensure_auth_session(app).await?;
        let _response: Value = self
            .request_json(
                &base_url,
                "/v2/presence/announce",
                reqwest::Method::POST,
                Some(serde_json::json!({
                    "platform": std::env::consts::OS,
                    "appVersion": app.package_info().version.to_string(),
                    "capabilities": {
                        "signaling": ["sse"],
                        "pairing": ["qr", "safety-code"],
                        "chat": true,
                    }
                })),
                Some(&session.token),
            )
            .await?;
        Ok((base_url, device_id, identity, session))
    }

    pub(super) async fn heartbeat_once(&self, app: &AppHandle) -> Result<(), String> {
        let (base_url, _device_id, _identity, session) = self.ensure_auth_session(app).await?;
        let _response: Value = self
            .request_json(
                &base_url,
                "/v2/presence/heartbeat",
                reqwest::Method::POST,
                Some(serde_json::json!({
                    "platform": std::env::consts::OS,
                    "appVersion": app.package_info().version.to_string(),
                    "capabilities": {
                        "signaling": ["sse"],
                        "pairing": ["qr", "safety-code"],
                        "chat": true,
                    }
                })),
                Some(&session.token),
            )
            .await?;
        Ok(())
    }

    pub(super) async fn list_bindings(&self, app: &AppHandle) -> Result<Vec<PairBinding>, String> {
        let (base_url, _device_id, _identity, session) = self.ensure_auth_session(app).await?;
        let response: Value = self
            .request_json(
                &base_url,
                "/v2/bindings",
                reqwest::Method::GET,
                None,
                Some(&session.token),
            )
            .await?;
        let bindings_value = response
            .get("bindings")
            .cloned()
            .unwrap_or_else(|| Value::Array(Vec::new()));
        serde_json::from_value(bindings_value).map_err(|e| format!("解析 bindings 失败: {}", e))
    }

    pub(super) async fn refresh_bindings(&self, app: &AppHandle) -> Result<(), String> {
        let bindings = self.list_bindings(app).await?;
        {
            let mut state = self.state.lock().await;
            let channel_open = state.channel_open;
            for binding in bindings.into_iter().filter(|item| item.trust_state == "active") {
                let channel = find_or_create_channel_mut(
                    &mut state.channels,
                    Some(&binding.pair_session_id),
                    Some(&binding.binding_id),
                    Some(&binding.mobile_id),
                    binding.created_at,
                );
                channel.session_id = binding.pair_session_id.clone();
                channel.binding_id = binding.binding_id.clone();
                channel.mobile_id = binding.mobile_id.clone();
                channel.device_public_key = Some(binding.device_public_key.clone());
                channel.mobile_public_key = Some(binding.mobile_public_key.clone());
                channel.trust_state = binding.trust_state.clone();
                channel.status = if channel_open {
                    "active".to_string()
                } else {
                    "offline".to_string()
                };
                channel.approved_at = binding.approved_at;
            }
        }
        self.emit_snapshot().await;
        Ok(())
    }

    pub(super) async fn resolve_ice_servers(&self, app: &AppHandle) -> Result<Vec<RTCIceServer>, String> {
        let (base_url, _device_id, _identity, session) = self.ensure_auth_session(app).await?;
        let now = Self::now_ms();
        {
            let state = self.state.lock().await;
            if let Some(cached) = state.ice_cache.get(&base_url) {
                if cached.expires_at > now + 5_000 {
                    return Ok(cached.ice_servers.clone());
                }
            }
        }
        let response: Value = self
            .request_json(
                &base_url,
                "/v2/ice-servers",
                reqwest::Method::GET,
                None,
                Some(&session.token),
            )
            .await?;
        let ttl_seconds = response
            .get("ttlSeconds")
            .and_then(Value::as_u64)
            .unwrap_or(600)
            .max(60);
        let servers_payload: Vec<PairIceServerPayload> = serde_json::from_value(
            response
                .get("iceServers")
                .cloned()
                .unwrap_or_else(|| Value::Array(Vec::new())),
        )
        .unwrap_or_default();
        let mut resolved = servers_payload
            .into_iter()
            .filter(|item| !item.urls.is_empty())
            .map(|item| RTCIceServer {
                urls: item.urls,
                username: item.username,
                credential: item.credential,
                ..Default::default()
            })
            .collect::<Vec<_>>();
        if resolved.is_empty() {
            resolved = vec![RTCIceServer {
                urls: vec![
                    "stun:stun.cloudflare.com:3478".to_string(),
                    "stun:stun.l.google.com:19302".to_string(),
                ],
                ..Default::default()
            }];
        }
        {
            let mut state = self.state.lock().await;
            state.ice_cache.insert(
                base_url,
                CachedIceServers {
                    ice_servers: resolved.clone(),
                    expires_at: now + ttl_seconds * 1_000,
                },
            );
        }
        Ok(resolved)
    }

    pub(super) async fn send_signal(
        &self,
        app: &AppHandle,
        to_id: &str,
        signal_type: &str,
        payload: Value,
    ) -> Result<(), String> {
        let (base_url, device_id, _identity, session) = self.ensure_auth_session(app).await?;
        let _response: Value = self
            .request_json(
                &base_url,
                "/v2/signal/send",
                reqwest::Method::POST,
                Some(serde_json::json!({
                    "fromType": "desktop",
                    "fromId": device_id,
                    "toType": "mobile",
                    "toId": to_id,
                    "type": signal_type,
                    "payload": payload,
                })),
                Some(&session.token),
            )
            .await?;
        Ok(())
    }

    pub(super) async fn create_session(&self, app: &AppHandle) -> Result<PairBackendSnapshot, String> {
        let (base_url, _device_id, _identity, session) = self.ensure_auth_session(app).await?;
        let response: Value = self
            .request_json(
                &base_url,
                "/v2/pair/sessions",
                reqwest::Method::POST,
                Some(serde_json::json!({ "ttlSeconds": 180 })),
                Some(&session.token),
            )
            .await?;
        let pair_session: PairSessionRecord = serde_json::from_value(
            response
                .get("session")
                .cloned()
                .ok_or_else(|| "pair session 响应缺失".to_string())?,
        )
        .map_err(|e| format!("解析 pair session 失败: {}", e))?;
        let qr_payload: Value = response
            .get("qrPayload")
            .cloned()
            .unwrap_or_else(|| Value::Object(Default::default()));
        {
            let mut state = self.state.lock().await;
            let channel = find_or_create_channel_mut(
                &mut state.channels,
                Some(&pair_session.pair_session_id),
                pair_session.binding_id.as_deref(),
                pair_session.claimed_mobile_id.as_deref(),
                pair_session.created_at,
            );
            channel.session_id = pair_session.pair_session_id.clone();
            channel.channel_id = pair_session.pair_session_id.clone();
            channel.status = "pending".to_string();
            channel.trust_state = "pending".to_string();
            channel.mobile_id = pair_session.claimed_mobile_id.unwrap_or_default();
            channel.qr_payload = Some(qr_payload);
            channel.session_nonce = Some(pair_session.session_nonce.clone());
            channel.device_public_key = Some(pair_session.device_public_key.clone());
        }
        self.append_event(format!("pair session created: {}", pair_session.pair_session_id))
            .await;
        Ok(self.snapshot().await)
    }

    pub(super) async fn approve_channel(&self, app: &AppHandle, channel_id: &str) -> Result<PairBackendSnapshot, String> {
        let binding_id = {
            let state = self.state.lock().await;
            state
                .channels
                .iter()
                .find(|item| item.channel_id == channel_id)
                .and_then(|item| if item.binding_id.is_empty() { None } else { Some(item.binding_id.clone()) })
                .ok_or_else(|| "bindingId missing".to_string())?
        };
        let (base_url, _device_id, _identity, session) = self.ensure_auth_session(app).await?;
        let response: Value = self
            .request_json(
                &base_url,
                "/v2/pair/approvals",
                reqwest::Method::POST,
                Some(serde_json::json!({ "bindingId": binding_id })),
                Some(&session.token),
            )
            .await?;
        let binding: PairBinding = serde_json::from_value(
            response
                .get("binding")
                .cloned()
                .ok_or_else(|| "approve 响应缺失".to_string())?,
        )
        .map_err(|e| format!("解析 approve binding 失败: {}", e))?;
        {
            let mut state = self.state.lock().await;
            let channel_open = state.channel_open;
            let channel = find_or_create_channel_mut(
                &mut state.channels,
                Some(&binding.pair_session_id),
                Some(&binding.binding_id),
                Some(&binding.mobile_id),
                binding.created_at,
            );
            channel.session_id = binding.pair_session_id.clone();
            channel.binding_id = binding.binding_id.clone();
            channel.mobile_id = binding.mobile_id.clone();
            channel.device_public_key = Some(binding.device_public_key.clone());
            channel.mobile_public_key = Some(binding.mobile_public_key.clone());
            channel.trust_state = binding.trust_state.clone();
            channel.status = if channel_open {
                "active".to_string()
            } else {
                "offline".to_string()
            };
            channel.approved_at = binding.approved_at;
        }
        self.append_event(format!("pair approved: binding={}", binding.binding_id))
            .await;
        Ok(self.snapshot().await)
    }

    pub(super) async fn revoke_channel(&self, app: &AppHandle, channel_id: &str) -> Result<PairBackendSnapshot, String> {
        let binding_id = {
            let state = self.state.lock().await;
            state
                .channels
                .iter()
                .find(|item| item.channel_id == channel_id)
                .and_then(|item| if item.binding_id.is_empty() { None } else { Some(item.binding_id.clone()) })
                .ok_or_else(|| "bindingId missing".to_string())?
        };
        let (base_url, _device_id, _identity, session) = self.ensure_auth_session(app).await?;
        let _response: Value = self
            .request_json(
                &base_url,
                "/v2/pair/revoke",
                reqwest::Method::POST,
                Some(serde_json::json!({ "bindingId": binding_id })),
                Some(&session.token),
            )
            .await?;
        self.dispose_peer(&binding_id, "binding revoked", "disconnected")
            .await;
        {
            let mut state = self.state.lock().await;
            state.channels.retain(|item| item.channel_id != channel_id);
        }
        self.append_event(format!("channel deleted: {}", channel_id)).await;
        Ok(self.snapshot().await)
    }

    pub(super) fn spawn_connect_task(&self, app: AppHandle, from_reconnect: bool) {
        let backend = self.clone();
        tokio::spawn(async move {
            if let Err(error) = backend.connect(app, from_reconnect).await {
                backend
                    .append_event(format!("pair connect failed: {}", error))
                    .await;
            }
        });
    }


}
