use super::*;

pub(super) fn read_json_string(value: &Value, keys: &[&str]) -> String {
    for key in keys {
        if let Some(text) = value.get(*key).and_then(Value::as_str) {
            let trimmed = text.trim();
            if !trimmed.is_empty() {
                return trimmed.to_string();
            }
        }
    }
    String::new()
}

pub(super) fn normalize_sdp_text(raw: &str) -> String {
    let text = raw.trim();
    if text.is_empty() {
        return String::new();
    }
    let normalized = text
        .replace("\r\n", "\n")
        .replace('\r', "\n")
        .replace('\n', "\r\n");
    if normalized.ends_with("\r\n") {
        normalized
    } else {
        format!("{}\r\n", normalized)
    }
}

pub(super) fn value_or_dash(value: &str) -> String {
    let trimmed = value.trim();
    if trimmed.is_empty() {
        "-".to_string()
    } else {
        trimmed.to_string()
    }
}

pub(super) fn normalize_display_name(value: &str) -> String {
    value.split_whitespace().collect::<Vec<_>>().join(" ")
}

pub(super) fn pair_connection_suffix(seed: &str) -> String {
    let normalized: String = seed
        .trim()
        .chars()
        .filter(|ch| ch.is_ascii_alphanumeric())
        .collect();
    if normalized.is_empty() {
        return now_millis_fallback_suffix();
    }
    normalized
        .chars()
        .rev()
        .take(6)
        .collect::<String>()
        .chars()
        .rev()
        .collect()
}

fn now_millis_fallback_suffix() -> String {
    let now = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|value| value.as_millis().to_string())
        .unwrap_or_else(|_| "000000".to_string());
    let len = now.len();
    now[len.saturating_sub(6)..].to_string()
}

pub(super) fn format_pair_connection_name(seed: &str, mobile_name: &str) -> String {
    let suffix = pair_connection_suffix(seed);
    let normalized_mobile_name = normalize_display_name(mobile_name);
    if normalized_mobile_name.is_empty() {
        format!("连接-{}", suffix)
    } else {
        format!("{}-连接-{}", normalized_mobile_name, suffix)
    }
}

pub(super) fn resolve_channel_display_name(channel: &PairBackendChannel) -> String {
    let seed = if !channel.binding_id.trim().is_empty() {
        channel.binding_id.as_str()
    } else if !channel.session_id.trim().is_empty() {
        channel.session_id.as_str()
    } else if !channel.mobile_id.trim().is_empty() {
        channel.mobile_id.as_str()
    } else {
        channel.channel_id.as_str()
    };
    format_pair_connection_name(seed, &channel.mobile_name)
}

pub(super) fn compute_safety_code(
    device_public_key: &str,
    mobile_public_key: &str,
    pair_session_id: &str,
    session_nonce: &str,
) -> String {
    let mut hasher = Sha256::new();
    hasher.update(device_public_key.as_bytes());
    hasher.update(mobile_public_key.as_bytes());
    hasher.update(pair_session_id.as_bytes());
    hasher.update(session_nonce.as_bytes());
    let bytes = hasher.finalize();
    let value = (((bytes[0] as u32) << 16) | ((bytes[1] as u32) << 8) | (bytes[2] as u32)) >> 4;
    format!("{:06}", value % 1_000_000)
}

pub(super) fn find_or_create_channel_mut<'a>(
    channels: &'a mut Vec<PairBackendChannel>,
    session_id: Option<&str>,
    binding_id: Option<&str>,
    mobile_id: Option<&str>,
    created_at: u64,
) -> &'a mut PairBackendChannel {
    let session_id = session_id.unwrap_or_default().trim().to_string();
    let binding_id = binding_id.unwrap_or_default().trim().to_string();
    let mobile_id = mobile_id.unwrap_or_default().trim().to_string();
    if let Some(index) = channels.iter().position(|item| {
        (!binding_id.is_empty() && item.binding_id == binding_id)
            || (!session_id.is_empty() && item.session_id == session_id)
            || (!mobile_id.is_empty() && item.mobile_id == mobile_id)
            || (!session_id.is_empty() && item.channel_id == session_id)
    }) {
        return &mut channels[index];
    }
    channels.push(PairBackendChannel {
        channel_id: if !session_id.is_empty() {
            session_id.clone()
        } else if !binding_id.is_empty() {
            binding_id.clone()
        } else if !mobile_id.is_empty() {
            format!("ch_{}", mobile_id)
        } else {
            PairBackendHandle::random_id("ch")
        },
        session_id,
        mobile_id,
        mobile_name: String::new(),
        binding_id,
        status: "offline".to_string(),
        trust_state: "pending".to_string(),
        created_at,
        ..Default::default()
    });
    channels.last_mut().expect("channel inserted")
}
