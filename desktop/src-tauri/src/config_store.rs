use super::*;

pub(crate) fn config_path(app: &AppHandle) -> Result<PathBuf, String> {
    Ok(app_config_dir(app)?.join(CONFIG_FILE_NAME))
}

pub(crate) fn trim_utf8_bom(raw: &str) -> &str {
    raw.strip_prefix('\u{feff}').unwrap_or(raw)
}

pub(crate) fn read_config(app: &AppHandle) -> Result<Option<StoredConfig>, String> {
    migrate_legacy_app_data_if_needed(app)?;

    let path = config_path(app)?;
    if !path.exists() {
        return Ok(None);
    }

    let raw = fs::read_to_string(&path).map_err(|e| format!("读取配置失败: {}", e))?;
    let cfg: StoredConfig =
        serde_json::from_str(trim_utf8_bom(&raw)).map_err(|e| format!("配置格式错误: {}", e))?;
    Ok(Some(cfg))
}

pub(crate) fn write_config(app: &AppHandle, cfg: &StoredConfig) -> Result<(), String> {
    let path = config_path(app)?;
    let data = serde_json::to_string_pretty(cfg).map_err(|e| format!("序列化配置失败: {}", e))?;
    fs::write(path, data).map_err(|e| format!("写入配置失败: {}", e))?;
    Ok(())
}

fn parse_config_updated_at(value: &str) -> Option<DateTime<Utc>> {
    chrono::DateTime::parse_from_rfc3339(value)
        .ok()
        .map(|dt| dt.with_timezone(&Utc))
}

fn maybe_migrate_legacy_custom_api_mode(cfg: &mut StoredConfig) -> bool {
    if !cfg.provider.trim().eq_ignore_ascii_case("custom")
        || !cfg
            .custom_api_mode
            .trim()
            .eq_ignore_ascii_case("openai-completions")
    {
        return false;
    }

    let Some(updated_at) = parse_config_updated_at(&cfg.updated_at) else {
        return false;
    };

    let Ok(cutoff_raw) = chrono::DateTime::parse_from_rfc3339(CUSTOM_API_MODE_MIGRATION_CUTOFF)
    else {
        return false;
    };
    let cutoff = cutoff_raw.with_timezone(&Utc);

    if updated_at >= cutoff {
        return false;
    }

    cfg.custom_api_mode = default_custom_api_mode();
    cfg.updated_at = Utc::now().to_rfc3339();
    true
}

fn maybe_backfill_channel_device_id(cfg: &mut StoredConfig) -> bool {
    let has_server_url = cfg
        .channel_server_base_url
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .is_some();
    let missing_device_id = cfg
        .channel_device_id
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .is_none();

    if !has_server_url || !missing_device_id {
        return false;
    }

    cfg.channel_device_id = Some(generate_channel_device_id());
    cfg.updated_at = Utc::now().to_rfc3339();
    true
}

fn sync_custom_api_mode_from_runtime_if_newer(
    app: &AppHandle,
    cfg: &mut StoredConfig,
    resolved: &ResolvedOpenClawCommand,
) -> Result<(), String> {
    let _ = (app, cfg, resolved);
    Ok(())
}

pub(crate) fn read_config_with_runtime_custom_api_mode_sync(
    app: &AppHandle,
) -> Result<Option<StoredConfig>, String> {
    let Some(mut cfg) = read_config(app)? else {
        return Ok(None);
    };

    if maybe_migrate_legacy_custom_api_mode(&mut cfg) {
        write_config(app, &cfg)?;
    }

    if maybe_backfill_channel_device_id(&mut cfg) {
        write_config(app, &cfg)?;
    }

    let resolved = resolve_openclaw_command(&cfg, app);
    sync_custom_api_mode_from_runtime_if_newer(app, &mut cfg, &resolved)?;
    let normalized =
        normalize_custom_api_mode_for_base_url(cfg.base_url.as_deref(), &cfg.custom_api_mode);
    if normalized != cfg.custom_api_mode {
        cfg.custom_api_mode = normalized;
        cfg.updated_at = Utc::now().to_rfc3339();
        write_config(app, &cfg)?;
    }
    Ok(Some(cfg))
}

pub(crate) fn mask_api_key(api_key: &str) -> String {
    if api_key.chars().count() <= 8 {
        return "********".to_string();
    }

    let start: String = api_key.chars().take(4).collect();
    let end: String = api_key
        .chars()
        .rev()
        .take(4)
        .collect::<String>()
        .chars()
        .rev()
        .collect();

    format!("{}...{}", start, end)
}

pub(crate) fn is_config_ready(config: &StoredConfig) -> bool {
    !config.api_key.trim().is_empty()
}

pub(crate) fn load_state_response(app: &AppHandle) -> Result<StateResponse, String> {
    let config = read_config_with_runtime_custom_api_mode_sync(app)?;

    let public_config = config.as_ref().map(|cfg| PublicConfig {
        provider: cfg.provider.clone(),
        model: cfg.model.clone(),
        api_key_masked: mask_api_key(&cfg.api_key),
        base_url: cfg.base_url.clone().unwrap_or_default(),
        custom_api_mode: cfg.custom_api_mode.clone(),
        custom_headers: cfg.custom_headers.clone(),
        skills_dirs: cfg.skills_dirs.clone(),
        openclaw_command: cfg.openclaw_command.clone(),
        channel_server_base_url: cfg.channel_server_base_url.clone(),
        channel_device_id: cfg.channel_device_id.clone(),
        updated_at: cfg.updated_at.clone(),
    });

    let is_configured = config.as_ref().map(is_config_ready).unwrap_or(false);

    Ok(StateResponse {
        is_configured,
        config: public_config,
        platform: env::consts::OS.to_string(),
        version: app.package_info().version.to_string(),
    })
}

pub(crate) fn read_raw_config_snapshot(app: &AppHandle) -> Result<Option<StoredConfig>, String> {
    read_config_with_runtime_custom_api_mode_sync(app)
}

pub(crate) fn resolve_config_path_string(app: &AppHandle) -> Result<String, String> {
    Ok(config_path(app)?.to_string_lossy().to_string())
}

pub(crate) fn save_config_payload(
    payload: SavePayload,
    app: AppHandle,
) -> Result<ActionResponse, String> {
    let existing = read_config(&app)?;
    let api_key = payload.api_key.trim().to_string();
    if api_key.is_empty() {
        return Ok(ActionResponse {
            ok: false,
            message: "Model API Key 不能为空。".to_string(),
            detail: None,
            copied_from: None,
            copied_to: None,
        });
    }

    let provider = payload
        .provider
        .clone()
        .unwrap_or_else(|| "openai".to_string())
        .trim()
        .to_string();
    let model = payload.model.clone().unwrap_or_default().trim().to_string();
    let base_url = payload
        .base_url
        .clone()
        .map(|v| v.trim().to_string())
        .filter(|v| !v.is_empty());

    if model.is_empty() {
        return Ok(ActionResponse {
            ok: false,
            message: "Model 不能为空。".to_string(),
            detail: None,
            copied_from: None,
            copied_to: None,
        });
    }

    if provider.eq_ignore_ascii_case("custom") && base_url.is_none() {
        return Ok(ActionResponse {
            ok: false,
            message: "Provider 为 custom 时，Base URL 不能为空。".to_string(),
            detail: None,
            copied_from: None,
            copied_to: None,
        });
    }

    let is_custom_provider = provider.eq_ignore_ascii_case("custom");
    let custom_api_mode = match normalize_custom_api_mode(payload.custom_api_mode.as_deref()) {
        Ok(mode) => mode,
        Err(message) => {
            return Ok(ActionResponse {
                ok: false,
                message,
                detail: None,
                copied_from: None,
                copied_to: None,
            })
        }
    };
    let custom_api_mode = if is_custom_provider {
        normalize_custom_api_mode_for_base_url(base_url.as_deref(), &custom_api_mode)
    } else {
        custom_api_mode
    };
    let mut custom_headers = match parse_custom_headers_json(payload.custom_headers_json.as_deref()) {
        Ok(headers) => headers,
        Err(message) => {
            return Ok(ActionResponse {
                ok: false,
                message,
                detail: None,
                copied_from: None,
                copied_to: None,
            })
        }
    };

    if is_custom_provider {
        maybe_apply_mdlbus_header_defaults(
            base_url.as_deref(),
            &custom_api_mode,
            &mut custom_headers,
        );
    } else {
        custom_headers.clear();
    }

    let skills_dirs = normalize_skills_dirs(&payload.skills_dirs);
    if let Some(missing) = skills_dirs.iter().find(|p| !PathBuf::from(p).exists()) {
        return Ok(ActionResponse {
            ok: false,
            message: format!("skills 目录不存在: {}", missing),
            detail: None,
            copied_from: None,
            copied_to: None,
        });
    }

    let channel_server_base_url = match normalize_channel_server_base_url(
        payload.channel_server_base_url.as_deref(),
    ) {
        Ok(Some(value)) => Some(value),
        Ok(None) => existing.as_ref().and_then(|cfg| {
            normalize_channel_server_base_url(cfg.channel_server_base_url.as_deref())
                .ok()
                .flatten()
        }),
        Err(message) => {
            return Ok(ActionResponse {
                ok: false,
                message,
                detail: None,
                copied_from: None,
                copied_to: None,
            })
        }
    };
    let channel_device_id = normalize_channel_device_id(payload.channel_device_id.as_deref())
        .or_else(|| {
            existing
                .as_ref()
                .and_then(|cfg| normalize_channel_device_id(cfg.channel_device_id.as_deref()))
        })
        .or_else(|| channel_server_base_url.as_ref().map(|_| generate_channel_device_id()));

    let cfg = StoredConfig {
        provider,
        model,
        api_key,
        base_url,
        custom_api_mode: if is_custom_provider {
            custom_api_mode
        } else {
            default_custom_api_mode()
        },
        custom_headers,
        skills_dirs,
        openclaw_command: payload
            .openclaw_command
            .unwrap_or_else(|| "openclaw".to_string())
            .trim()
            .to_string(),
        channel_server_base_url,
        channel_device_id,
        updated_at: Utc::now().to_rfc3339(),
    };

    write_config(&app, &cfg)?;
    let resolved = resolve_openclaw_command(&cfg, &app);
    if let Err(e) = apply_runtime_default_model_overrides(&app, &cfg, &resolved) {
        return Ok(ActionResponse {
            ok: false,
            message: "同步 OpenClaw 默认模型配置失败。".to_string(),
            detail: Some(e),
            copied_from: None,
            copied_to: None,
        });
    }

    let pair_backend = app.state::<PairBackendHandle>().inner().clone();
    let app_handle = app.clone();
    tauri::async_runtime::spawn(async move {
        if let Err(e) = pair_backend.reload_from_app_config(app_handle).await {
            eprintln!("pair backend reload after save failed: {}", e);
        }
    });

    Ok(ActionResponse {
        ok: true,
        message: "配置已保存。".to_string(),
        detail: None,
        copied_from: None,
        copied_to: None,
    })
}
