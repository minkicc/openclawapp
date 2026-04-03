use super::*;
#[cfg(target_os = "macos")]
use cocoa::{
    base::{id, nil},
    foundation::NSString,
};
#[cfg(target_os = "macos")]
use objc::{class, msg_send};
use tauri::Window;
#[cfg(any(
    target_os = "linux",
    target_os = "dragonfly",
    target_os = "freebsd",
    target_os = "netbsd",
    target_os = "openbsd"
))]
use webkit2gtk::traits::WebViewExt;
#[cfg(windows)]
use windows::core::PCWSTR;

#[derive(Debug, Clone)]
pub(crate) struct GatewayConnectionInfo {
    pub ws_url: String,
    pub token: Option<String>,
}

pub(crate) fn resolve_gateway_connection_info(
    app: AppHandle,
) -> Result<GatewayConnectionInfo, String> {
    let response = get_dashboard_url_impl(app)?;
    if !response.ok {
        return Err(response
            .detail
            .filter(|value| !value.trim().is_empty())
            .unwrap_or(response.message));
    }
    let dashboard_url = response.detail.unwrap_or_default().trim().to_string();
    if dashboard_url.is_empty() {
        return Err("OpenClaw gateway url is empty".to_string());
    }
    let parsed =
        url::Url::parse(&dashboard_url).map_err(|e| format!("OpenClaw gateway url 无效: {}", e))?;
    let token = {
        let fragment = parsed.fragment().unwrap_or_default();
        let fragment_params = url::form_urlencoded::parse(fragment.as_bytes())
            .into_owned()
            .collect::<std::collections::HashMap<String, String>>();
        let search_params = parsed
            .query_pairs()
            .into_owned()
            .collect::<std::collections::HashMap<String, String>>();
        fragment_params
            .get("token")
            .cloned()
            .or_else(|| search_params.get("token").cloned())
            .filter(|value| !value.trim().is_empty())
    };
    let mut ws_url = parsed;
    ws_url.set_fragment(None);
    ws_url.set_query(None);
    match ws_url.scheme() {
        "https" => {
            let _ = ws_url.set_scheme("wss");
        }
        _ => {
            let _ = ws_url.set_scheme("ws");
        }
    }
    Ok(GatewayConnectionInfo {
        ws_url: ws_url.to_string(),
        token,
    })
}

pub(crate) fn get_dashboard_url_impl(app: AppHandle) -> Result<ActionResponse, String> {
    let cfg = match read_config_with_runtime_custom_api_mode_sync(&app)? {
        Some(cfg) => cfg,
        None => {
            return Ok(ActionResponse {
                ok: false,
                message: "请先完成 API Key 配置。".to_string(),
                detail: None,
                copied_from: None,
                copied_to: None,
            });
        }
    };

    if !is_config_ready(&cfg) {
        return Ok(ActionResponse {
            ok: false,
            message: "请先完成 API Key 配置。".to_string(),
            detail: None,
            copied_from: None,
            copied_to: None,
        });
    }

    let resolved = resolve_openclaw_command(&cfg, &app);
    let mut dashboard_prep_changed = false;
    if should_refresh_dashboard_prep(&app, &cfg) {
        if let Err(e) = sync_custom_provider_if_needed(&app, &cfg, &resolved) {
            return Ok(ActionResponse {
                ok: false,
                message: "同步 OpenClaw Custom Provider 配置失败。".to_string(),
                detail: Some(e),
                copied_from: None,
                copied_to: None,
            });
        }
        if let Err(e) = apply_runtime_default_model_overrides(&app, &cfg, &resolved) {
            return Ok(ActionResponse {
                ok: false,
                message: "同步 OpenClaw 默认模型配置失败。".to_string(),
                detail: Some(e),
                copied_from: None,
                copied_to: None,
            });
        }
        match apply_openclaw_mobile_channel_overrides(&app, &cfg, &resolved) {
            Ok(changed) => {
                dashboard_prep_changed = changed;
            }
            Err(e) => {
                return Ok(ActionResponse {
                    ok: false,
                    message: "同步通信渠道配置失败。".to_string(),
                    detail: Some(e),
                    copied_from: None,
                    copied_to: None,
                });
            }
        }
        persist_dashboard_prep_fingerprint(&app, &cfg);
    }
    let force_restart = dashboard_prep_changed || should_force_restart_gateway(&app, &cfg);
    let started = match ensure_gateway_running(&app, &cfg, &resolved, force_restart) {
        Ok(v) => v,
        Err(e) => {
            let is_timeout = e.contains("超时");
            return Ok(ActionResponse {
                ok: false,
                message: if is_timeout {
                    "Dashboard 启动超时。".to_string()
                } else {
                    "Dashboard 服务未就绪，且自动启动 Gateway 失败。".to_string()
                },
                detail: Some(e),
                copied_from: None,
                copied_to: None,
            });
        }
    };

    let url = format!("{}/#token={}", app_gateway_http_url(), APP_GATEWAY_TOKEN);
    if !is_dashboard_url_reachable(&url) {
        return Ok(ActionResponse {
            ok: false,
            message: "Dashboard 地址已获取，但服务仍不可访问。".to_string(),
            detail: Some(format!(
                "URL: {}\nGateway 自动启动: {}",
                url,
                if started { "是" } else { "否" }
            )),
            copied_from: None,
            copied_to: None,
        });
    }

    persist_gateway_runtime_fingerprint(&app, &cfg);

    Ok(ActionResponse {
        ok: true,
        message: format!("Dashboard 地址获取成功（来源: {}）。", resolved.source),
        detail: Some(url),
        copied_from: None,
        copied_to: None,
    })
}

#[tauri::command]
pub fn get_dashboard_url(app: AppHandle) -> Result<ActionResponse, String> {
    get_dashboard_url_impl(app)
}

#[tauri::command]
pub fn open_dashboard_window(app: AppHandle) -> Result<ActionResponse, String> {
    let response = get_dashboard_url_impl(app.clone())?;
    if !response.ok {
        return Ok(response);
    }

    let url = response.detail.clone().unwrap_or_default();
    if let Err(e) = url::Url::parse(&url) {
        return Ok(ActionResponse {
            ok: false,
            message: "Dashboard 地址格式无效。".to_string(),
            detail: Some(e.to_string()),
            copied_from: None,
            copied_to: None,
        });
    }

    if let Some(dashboard_window) = app.get_window("dashboard") {
        let _ = dashboard_window.close();
    }

    let Some(main_window) = app.get_window("main") else {
        return Ok(ActionResponse {
            ok: false,
            message: "主窗口不存在，无法打开 Dashboard。".to_string(),
            detail: None,
            copied_from: None,
            copied_to: None,
        });
    };

    navigate_window_to_url(&main_window, &url)?;
    let _ = main_window.show();
    let _ = main_window.unminimize();
    let _ = main_window.set_focus();

    Ok(ActionResponse {
        ok: true,
        message: "Dashboard 已在当前窗口打开。".to_string(),
        detail: Some(url),
        copied_from: None,
        copied_to: None,
    })
}

#[tauri::command]
pub fn open_dashboard_session(
    session_key: String,
    app: AppHandle,
) -> Result<ActionResponse, String> {
    let normalized_session_key = session_key.trim().to_string();
    if normalized_session_key.is_empty() {
        return Ok(ActionResponse {
            ok: false,
            message: "会话键不能为空。".to_string(),
            detail: None,
            copied_from: None,
            copied_to: None,
        });
    }

    let response = get_dashboard_url_impl(app.clone())?;
    if !response.ok {
        return Ok(response);
    }

    let raw_url = response.detail.clone().unwrap_or_default();
    let mut url = match url::Url::parse(&raw_url) {
        Ok(parsed) => parsed,
        Err(error) => {
            return Ok(ActionResponse {
                ok: false,
                message: "Dashboard 地址格式无效。".to_string(),
                detail: Some(error.to_string()),
                copied_from: None,
                copied_to: None,
            });
        }
    };

    url.set_path("/chat");
    {
        let mut query = url.query_pairs_mut();
        query.clear();
        query.append_pair("session", &normalized_session_key);
    }

    if let Some(dashboard_window) = app.get_window("dashboard") {
        let _ = dashboard_window.close();
    }

    let Some(main_window) = app.get_window("main") else {
        return Ok(ActionResponse {
            ok: false,
            message: "主窗口不存在，无法打开 Dashboard 会话。".to_string(),
            detail: None,
            copied_from: None,
            copied_to: None,
        });
    };

    navigate_window_to_url(&main_window, url.as_str())?;
    let _ = main_window.show();
    let _ = main_window.unminimize();
    let _ = main_window.set_focus();

    Ok(ActionResponse {
        ok: true,
        message: "Dashboard 会话已在当前窗口打开。".to_string(),
        detail: Some(url.to_string()),
        copied_from: None,
        copied_to: None,
    })
}

#[cfg(target_os = "macos")]
#[allow(unexpected_cfgs)]
fn navigate_window_to_url(window: &Window<tauri::Wry>, url: &str) -> Result<(), String> {
    let target_url = url.to_string();
    window
        .with_webview(move |webview| unsafe {
            let ns_url_string = NSString::alloc(nil).init_str(&target_url);
            let ns_url: id = msg_send![class!(NSURL), URLWithString: ns_url_string];
            let request: id = msg_send![class!(NSMutableURLRequest), requestWithURL: ns_url];
            let _: () = msg_send![webview.inner(), loadRequest: request];
        })
        .map_err(|e| e.to_string())
}

#[cfg(any(
    target_os = "linux",
    target_os = "dragonfly",
    target_os = "freebsd",
    target_os = "netbsd",
    target_os = "openbsd"
))]
fn navigate_window_to_url(window: &Window<tauri::Wry>, url: &str) -> Result<(), String> {
    let target_url = url.to_string();
    window
        .with_webview(move |webview| {
            webview.inner().load_uri(&target_url);
        })
        .map_err(|e| e.to_string())
}

#[cfg(windows)]
fn navigate_window_to_url(window: &Window<tauri::Wry>, url: &str) -> Result<(), String> {
    let target_url = url.to_string();
    window
        .with_webview(move |webview| unsafe {
            let wide: Vec<u16> = target_url
                .encode_utf16()
                .chain(std::iter::once(0))
                .collect();
            if let Ok(core) = webview.controller().CoreWebView2() {
                let _ = core.Navigate(PCWSTR::from_raw(wide.as_ptr()));
            }
        })
        .map_err(|e| e.to_string())
}
