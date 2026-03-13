#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use std::collections::{BTreeMap, BTreeSet};
use std::env;
use std::fs;
use std::net::{IpAddr, Ipv4Addr, TcpStream, ToSocketAddrs, UdpSocket};
#[cfg(target_os = "windows")]
use std::os::windows::process::CommandExt;
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use std::thread;
use std::time::{Duration, Instant};
use tauri::AppHandle;

const CONFIG_FILE_NAME: &str = "openclaw.config.json";
const MANAGED_KERNEL_DIR_NAME: &str = "managed-kernel";
const BUNDLED_KERNEL_DIR_NAME: &str = "kernel";
const OPENCLAW_RUNTIME_HOME_DIR_NAME: &str = "openclaw-home";
const OPENCLAW_RUNTIME_WORKSPACE_DIR_NAME: &str = "openclaw-workspace";
const GATEWAY_RUNTIME_FINGERPRINT_FILE_NAME: &str = "gateway-runtime-fingerprint.txt";
const APP_GATEWAY_PORT: u16 = 28789;
const APP_GATEWAY_TOKEN: &str = "openclaw-desktop-local";
const APP_GATEWAY_READY_TIMEOUT_SECS: u64 = 60;
const DEFAULT_CUSTOM_API_MODE: &str = "openai-responses";
const CUSTOM_API_MODE_MIGRATION_CUTOFF: &str = "2026-03-11T00:00:00Z";
const LEGACY_APP_IDENTIFIER: &str = "com.openclaw.desktop";

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct StoredConfig {
    provider: String,
    model: String,
    api_key: String,
    #[serde(default)]
    base_url: Option<String>,
    #[serde(default = "default_custom_api_mode")]
    custom_api_mode: String,
    #[serde(default)]
    custom_headers: BTreeMap<String, String>,
    skills_dirs: Vec<String>,
    openclaw_command: String,
    #[serde(default)]
    channel_server_base_url: Option<String>,
    #[serde(default)]
    channel_device_id: Option<String>,
    updated_at: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct PublicConfig {
    provider: String,
    model: String,
    api_key_masked: String,
    base_url: String,
    custom_api_mode: String,
    custom_headers: BTreeMap<String, String>,
    skills_dirs: Vec<String>,
    openclaw_command: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    channel_server_base_url: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    channel_device_id: Option<String>,
    updated_at: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct StateResponse {
    is_configured: bool,
    config: Option<PublicConfig>,
    platform: String,
    version: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct ActionResponse {
    ok: bool,
    message: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    detail: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    copied_from: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    copied_to: Option<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct KernelStatusResponse {
    installed: bool,
    command_path: String,
    version: String,
    source: String,
    npm_available: bool,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct KernelVersionMetaResponse {
    current_version: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    latest_version: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    latest_error: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct SavePayload {
    provider: Option<String>,
    model: Option<String>,
    api_key: String,
    base_url: Option<String>,
    #[serde(default)]
    custom_api_mode: Option<String>,
    #[serde(default)]
    custom_headers_json: Option<String>,
    skills_dirs: Vec<String>,
    openclaw_command: Option<String>,
    #[serde(default)]
    channel_server_base_url: Option<String>,
    #[serde(default)]
    channel_device_id: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct FetchModelsPayload {
    provider: Option<String>,
    base_url: String,
    api_key: Option<String>,
    #[serde(default)]
    custom_api_mode: Option<String>,
    #[serde(default)]
    custom_headers_json: Option<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct FetchModelsResponse {
    ok: bool,
    message: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    detail: Option<String>,
    models: Vec<String>,
}

#[derive(Debug, Clone)]
struct ResolvedOpenClawCommand {
    program: String,
    prefix_args: Vec<String>,
    source: String,
    display_path: String,
}

fn default_custom_api_mode() -> String {
    DEFAULT_CUSTOM_API_MODE.to_string()
}

fn normalize_custom_api_mode(raw: Option<&str>) -> Result<String, String> {
    let value = raw.unwrap_or("").trim().to_lowercase();
    if value.is_empty() {
        return Ok(default_custom_api_mode());
    }

    match value.as_str() {
        "openai-completions" | "openai-responses" | "anthropic-messages" => Ok(value),
        _ => Err(
            "Custom API 模式不合法。仅支持 openai-completions、openai-responses、anthropic-messages。"
                .to_string(),
        ),
    }
}

fn parse_custom_headers_json(raw: Option<&str>) -> Result<BTreeMap<String, String>, String> {
    let text = raw.unwrap_or("").trim();
    if text.is_empty() {
        return Ok(BTreeMap::new());
    }

    let value: serde_json::Value =
        serde_json::from_str(text).map_err(|e| format!("Custom Headers JSON 解析失败: {}", e))?;
    let object = value
        .as_object()
        .ok_or_else(|| "Custom Headers 必须是 JSON 对象。".to_string())?;

    let mut headers = BTreeMap::new();
    for (key, val) in object {
        let header_name = key.trim();
        if header_name.is_empty() {
            return Err("Custom Headers 中存在空 Header 名称。".to_string());
        }

        let header_value = val
            .as_str()
            .ok_or_else(|| format!("Header `{}` 的值必须是字符串。", header_name))?
            .trim()
            .to_string();

        if !header_value.is_empty() {
            headers.insert(header_name.to_string(), header_value);
        }
    }

    Ok(headers)
}

fn maybe_apply_mdlbus_header_defaults(
    base_url: Option<&str>,
    custom_api_mode: &str,
    headers: &mut BTreeMap<String, String>,
) {
    if !custom_api_mode.eq_ignore_ascii_case("openai-responses") || !headers.is_empty() {
        return;
    }

    let Some(url) = base_url else {
        return;
    };

    let Ok(parsed) = url::Url::parse(url) else {
        return;
    };

    let Some(host) = parsed.host_str() else {
        return;
    };

    if host.eq_ignore_ascii_case("mdlbus.com") {
        headers.insert(
            "User-Agent".to_string(),
            "Mozilla/5.0 (X11; Linux x86_64) OpenClaw/2026.2.14".to_string(),
        );
        headers.insert("Accept".to_string(), "application/json".to_string());
    }
}

fn normalize_custom_api_mode_for_base_url(base_url: Option<&str>, custom_api_mode: &str) -> String {
    let _ = base_url;
    custom_api_mode.to_string()
}

fn normalized_base_url(value: &str) -> String {
    value.trim().trim_end_matches('/').to_string()
}

fn model_endpoint_candidates(base_url: &str) -> Vec<String> {
    let normalized = normalized_base_url(base_url);
    let mut urls: Vec<String> = Vec::new();
    let mut seen = BTreeSet::new();

    let push = |url: String, seen: &mut BTreeSet<String>, urls: &mut Vec<String>| {
        if !url.is_empty() && seen.insert(url.clone()) {
            urls.push(url);
        }
    };

    if normalized.ends_with("/v1") {
        push(format!("{}/models", normalized), &mut seen, &mut urls);
        push(
            format!("{}/v1/models", normalized.trim_end_matches("/v1")),
            &mut seen,
            &mut urls,
        );
        push(
            format!("{}/models", normalized.trim_end_matches("/v1")),
            &mut seen,
            &mut urls,
        );
    } else {
        push(format!("{}/v1/models", normalized), &mut seen, &mut urls);
        push(format!("{}/models", normalized), &mut seen, &mut urls);
    }

    urls
}

fn collect_model_ids_from_value(value: &serde_json::Value, models: &mut Vec<String>, seen: &mut BTreeSet<String>) {
    match value {
        serde_json::Value::Array(items) => {
            for item in items {
                match item {
                    serde_json::Value::String(model_id) => {
                        let trimmed = model_id.trim();
                        if !trimmed.is_empty() && seen.insert(trimmed.to_lowercase()) {
                            models.push(trimmed.to_string());
                        }
                    }
                    serde_json::Value::Object(obj) => {
                        if let Some(id) = obj.get("id").and_then(|v| v.as_str()) {
                            let trimmed = id.trim();
                            if !trimmed.is_empty() && seen.insert(trimmed.to_lowercase()) {
                                models.push(trimmed.to_string());
                            }
                        }
                    }
                    _ => {}
                }
            }
        }
        serde_json::Value::Object(obj) => {
            if let Some(data) = obj.get("data") {
                collect_model_ids_from_value(data, models, seen);
            }
            if let Some(data) = obj.get("models") {
                collect_model_ids_from_value(data, models, seen);
            }
            if let Some(result) = obj.get("result") {
                collect_model_ids_from_value(result, models, seen);
            }
            if let Some(items) = obj.get("items") {
                collect_model_ids_from_value(items, models, seen);
            }
        }
        _ => {}
    }
}

fn extract_model_ids(raw: &str) -> Vec<String> {
    let Ok(json) = serde_json::from_str::<serde_json::Value>(raw) else {
        return Vec::new();
    };

    let mut models = Vec::new();
    let mut seen = BTreeSet::new();
    collect_model_ids_from_value(&json, &mut models, &mut seen);
    models
}

fn mask_api_key(api_key: &str) -> String {
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

fn is_config_ready(config: &StoredConfig) -> bool {
    !config.api_key.trim().is_empty()
}

fn config_path(app: &AppHandle) -> Result<PathBuf, String> {
    let dir = app_config_dir(app)?;
    Ok(dir.join(CONFIG_FILE_NAME))
}

fn trim_utf8_bom(raw: &str) -> &str {
    raw.strip_prefix('\u{feff}').unwrap_or(raw)
}

fn read_config(app: &AppHandle) -> Result<Option<StoredConfig>, String> {
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

fn write_config(app: &AppHandle, cfg: &StoredConfig) -> Result<(), String> {
    let path = config_path(app)?;
    let data = serde_json::to_string_pretty(cfg).map_err(|e| format!("序列化配置失败: {}", e))?;
    fs::write(path, data).map_err(|e| format!("写入配置失败: {}", e))?;
    Ok(())
}

fn normalize_skills_dirs(skills_dirs: &[String]) -> Vec<String> {
    skills_dirs
        .iter()
        .map(|v| v.trim())
        .filter(|v| !v.is_empty())
        .map(|v| {
            let as_path = PathBuf::from(v);
            let absolute = if as_path.is_absolute() {
                as_path
            } else {
                env::current_dir()
                    .unwrap_or_else(|_| PathBuf::from("."))
                    .join(as_path)
            };

            absolute.to_string_lossy().to_string()
        })
        .collect()
}

fn copy_dir_recursive(source: &Path, target: &Path) -> Result<(), String> {
    if !source.exists() {
        return Ok(());
    }

    fs::create_dir_all(target).map_err(|e| format!("创建目录失败: {}", e))?;

    for entry in fs::read_dir(source).map_err(|e| format!("读取目录失败: {}", e))? {
        let entry = entry.map_err(|e| format!("读取目录项失败: {}", e))?;
        let source_path = entry.path();
        let target_path = target.join(entry.file_name());

        if source_path.is_dir() {
            copy_dir_recursive(&source_path, &target_path)?;
        } else {
            fs::copy(&source_path, &target_path).map_err(|e| {
                format!(
                    "复制文件失败 ({} -> {}): {}",
                    source_path.display(),
                    target_path.display(),
                    e
                )
            })?;
        }
    }

    Ok(())
}

fn resolve_bundled_skills_dir(app: &AppHandle) -> Option<PathBuf> {
    let runtime_resources = runtime_resources_dir();
    let candidates = [
        runtime_resources
            .as_ref()
            .map(|dir| dir.join("_up_").join("resources").join("skills")),
        runtime_resources
            .as_ref()
            .map(|dir| dir.join("resources").join("skills")),
        runtime_resources.as_ref().map(|dir| dir.join("skills")),
        app.path_resolver()
            .resolve_resource("_up_/resources/skills"),
        app.path_resolver().resolve_resource("resources/skills"),
        app.path_resolver().resolve_resource("skills"),
        Some(PathBuf::from("../resources/skills")),
        Some(PathBuf::from("resources/skills")),
    ];

    candidates
        .into_iter()
        .flatten()
        .find(|candidate| candidate.exists())
}

fn resolve_bundled_bin_dir(app: &AppHandle) -> Option<PathBuf> {
    let runtime_resources = runtime_resources_dir();
    let candidates = [
        runtime_resources
            .as_ref()
            .map(|dir| dir.join("_up_").join("resources").join("bin")),
        runtime_resources
            .as_ref()
            .map(|dir| dir.join("resources").join("bin")),
        runtime_resources.as_ref().map(|dir| dir.join("bin")),
        app.path_resolver().resolve_resource("_up_/resources/bin"),
        app.path_resolver().resolve_resource("resources/bin"),
        app.path_resolver().resolve_resource("bin"),
        Some(PathBuf::from("../resources/bin")),
        Some(PathBuf::from("resources/bin")),
    ];

    candidates
        .into_iter()
        .flatten()
        .find(|candidate| candidate.exists())
}

fn resolve_bundled_kernel_dir(app: &AppHandle) -> Option<PathBuf> {
    let nested = format!("resources/{}", BUNDLED_KERNEL_DIR_NAME);
    let runtime_resources = runtime_resources_dir();
    let candidates = [
        runtime_resources.as_ref().map(|dir| {
            dir.join("_up_")
                .join("resources")
                .join(BUNDLED_KERNEL_DIR_NAME)
        }),
        runtime_resources
            .as_ref()
            .map(|dir| dir.join("resources").join(BUNDLED_KERNEL_DIR_NAME)),
        runtime_resources
            .as_ref()
            .map(|dir| dir.join(BUNDLED_KERNEL_DIR_NAME)),
        app.path_resolver()
            .resolve_resource(&format!("_up_/resources/{}", BUNDLED_KERNEL_DIR_NAME)),
        app.path_resolver().resolve_resource(&nested),
        app.path_resolver()
            .resolve_resource(BUNDLED_KERNEL_DIR_NAME),
        Some(PathBuf::from(format!(
            "../resources/{}",
            BUNDLED_KERNEL_DIR_NAME
        ))),
        Some(PathBuf::from(format!(
            "resources/{}",
            BUNDLED_KERNEL_DIR_NAME
        ))),
    ];

    candidates
        .into_iter()
        .flatten()
        .find(|candidate| candidate.exists())
}

fn runtime_resources_dir() -> Option<PathBuf> {
    let exe = env::current_exe().ok()?;
    let exe_dir = exe.parent()?;
    let contents_dir = exe_dir.parent()?;
    let resources = contents_dir.join("Resources");
    if resources.exists() {
        Some(resources)
    } else {
        None
    }
}

fn app_config_dir(app: &AppHandle) -> Result<PathBuf, String> {
    let dir = app
        .path_resolver()
        .app_config_dir()
        .ok_or_else(|| "无法获取配置目录。".to_string())?;
    fs::create_dir_all(&dir).map_err(|e| format!("创建配置目录失败: {}", e))?;
    Ok(dir)
}

fn legacy_app_config_dir_candidates() -> Vec<PathBuf> {
    let mut candidates = Vec::new();

    #[cfg(target_os = "macos")]
    {
        if let Ok(home) = env::var("HOME") {
            candidates.push(
                PathBuf::from(home)
                    .join("Library")
                    .join("Application Support")
                    .join(LEGACY_APP_IDENTIFIER),
            );
        }
    }

    #[cfg(target_os = "linux")]
    {
        if let Ok(xdg_config_home) = env::var("XDG_CONFIG_HOME") {
            if !xdg_config_home.trim().is_empty() {
                candidates.push(PathBuf::from(xdg_config_home).join(LEGACY_APP_IDENTIFIER));
            }
        }
        if let Ok(home) = env::var("HOME") {
            candidates.push(
                PathBuf::from(home)
                    .join(".config")
                    .join(LEGACY_APP_IDENTIFIER),
            );
        }
    }

    #[cfg(target_os = "windows")]
    {
        if let Ok(appdata) = env::var("APPDATA") {
            candidates.push(PathBuf::from(appdata).join(LEGACY_APP_IDENTIFIER));
        }
        if let Ok(userprofile) = env::var("USERPROFILE") {
            candidates.push(
                PathBuf::from(userprofile)
                    .join("AppData")
                    .join("Roaming")
                    .join(LEGACY_APP_IDENTIFIER),
            );
        }
    }

    candidates
}

fn migrate_legacy_app_data_if_needed(app: &AppHandle) -> Result<(), String> {
    let current_dir = app_config_dir(app)?;
    if current_dir.join(CONFIG_FILE_NAME).exists()
        || current_dir.join(MANAGED_KERNEL_DIR_NAME).exists()
    {
        return Ok(());
    }

    let legacy_dir = legacy_app_config_dir_candidates().into_iter().find(|dir| {
        dir != &current_dir
            && (dir.join(CONFIG_FILE_NAME).exists() || dir.join(MANAGED_KERNEL_DIR_NAME).exists())
    });

    let Some(legacy_dir) = legacy_dir else {
        return Ok(());
    };

    copy_dir_recursive(&legacy_dir, &current_dir)?;
    Ok(())
}

fn managed_kernel_root(app: &AppHandle) -> Result<PathBuf, String> {
    let root = app_config_dir(app)?.join(MANAGED_KERNEL_DIR_NAME);
    fs::create_dir_all(&root).map_err(|e| format!("创建内核目录失败: {}", e))?;
    Ok(root)
}

fn openclaw_runtime_home_dir(app: &AppHandle) -> Result<PathBuf, String> {
    let dir = app_config_dir(app)?.join(OPENCLAW_RUNTIME_HOME_DIR_NAME);
    fs::create_dir_all(&dir).map_err(|e| format!("创建 OpenClaw 运行时目录失败: {}", e))?;
    Ok(dir)
}

fn openclaw_runtime_workspace_dir(app: &AppHandle) -> Result<PathBuf, String> {
    let dir = app_config_dir(app)?.join(OPENCLAW_RUNTIME_WORKSPACE_DIR_NAME);
    fs::create_dir_all(&dir).map_err(|e| format!("创建 OpenClaw 工作区目录失败: {}", e))?;
    Ok(dir)
}

fn managed_openclaw_script_path(app: &AppHandle) -> Result<PathBuf, String> {
    let root = managed_kernel_root(app)?;
    Ok(root
        .join("node_modules")
        .join("openclaw")
        .join("openclaw.mjs"))
}

fn bundled_openclaw_script_path(app: &AppHandle) -> Option<PathBuf> {
    resolve_bundled_kernel_dir(app).map(|root| {
        root.join("node_modules")
            .join("openclaw")
            .join("openclaw.mjs")
    })
}

fn node_binary_file_name() -> &'static str {
    if cfg!(target_os = "windows") {
        "node.exe"
    } else {
        "node"
    }
}

fn find_node_in_kernel_root(kernel_root: &Path) -> Option<PathBuf> {
    let node_bin = node_binary_file_name();
    let package_root = kernel_root.join("node_modules").join("node");

    // Legacy layout: node_modules/node/bin/node
    let legacy = package_root.join("bin").join(node_bin);
    if legacy.exists() {
        return Some(legacy);
    }

    // Current npm `node` package layout:
    // node_modules/node/node_modules/node-bin-*/bin/node
    let nested_root = package_root.join("node_modules");
    if let Ok(entries) = fs::read_dir(&nested_root) {
        for entry in entries.flatten() {
            let path = entry.path();
            let file_name = path.file_name().and_then(|n| n.to_str()).unwrap_or_default();
            if !file_name.starts_with("node-bin-") {
                continue;
            }

            let nested_bin = path.join("bin").join(node_bin);
            if nested_bin.exists() {
                return Some(nested_bin);
            }
        }
    }

    None
}

fn managed_node_command_path(app: &AppHandle) -> Option<PathBuf> {
    managed_kernel_root(app)
        .ok()
        .and_then(|root| find_node_in_kernel_root(&root))
}

fn bundled_node_command_path(app: &AppHandle) -> Option<PathBuf> {
    let bundled_kernel_node = resolve_bundled_kernel_dir(app)
        .and_then(|root| find_node_in_kernel_root(&root));

    let bundled_bin_node = resolve_bundled_bin_dir(app).map(|dir| {
        dir.join(node_binary_file_name())
    });

    let candidates = [bundled_kernel_node, bundled_bin_node];
    candidates.into_iter().flatten().find(|candidate| candidate.exists())
}

fn parse_node_version_tuple(raw: &str) -> Option<(u32, u32, u32)> {
    let cleaned = raw.trim().trim_start_matches(['v', 'V']).trim();
    if cleaned.is_empty() {
        return None;
    }

    let mut parts = cleaned.split('.');
    let major = parts.next()?.trim().parse::<u32>().ok()?;
    let minor = parts
        .next()
        .and_then(|v| v.trim().parse::<u32>().ok())
        .unwrap_or(0);
    let patch = parts
        .next()
        .and_then(|v| v.trim().parse::<u32>().ok())
        .unwrap_or(0);
    Some((major, minor, patch))
}

fn node_major_for_program(program: &str) -> Option<u32> {
    let output = Command::new(program).arg("--version").output().ok()?;
    if !output.status.success() {
        return None;
    }

    let stdout = String::from_utf8_lossy(&output.stdout).trim().to_string();
    let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
    let version = if !stdout.is_empty() { stdout } else { stderr };
    parse_node_version_tuple(&version).map(|(major, _, _)| major)
}

fn is_preferred_node_major(major: u32) -> bool {
    (18..=22).contains(&major)
}

fn nvm_node_candidate_paths() -> Vec<PathBuf> {
    let home = match env::var("HOME") {
        Ok(v) if !v.trim().is_empty() => v,
        _ => return Vec::new(),
    };

    let versions_root = PathBuf::from(home).join(".nvm").join("versions").join("node");
    let entries = match fs::read_dir(versions_root) {
        Ok(v) => v,
        Err(_) => return Vec::new(),
    };

    let mut candidates: Vec<((u32, u32, u32), PathBuf)> = Vec::new();
    for entry in entries.flatten() {
        let path = entry.path();
        if !path.is_dir() {
            continue;
        }

        let name = path
            .file_name()
            .and_then(|n| n.to_str())
            .unwrap_or_default()
            .trim()
            .to_string();
        let Some(version) = parse_node_version_tuple(&name) else {
            continue;
        };

        let bin = path.join("bin").join(node_binary_file_name());
        if !bin.exists() {
            continue;
        }

        candidates.push((version, bin));
    }

    candidates.sort_by(|a, b| b.0.cmp(&a.0));
    candidates.into_iter().map(|(_, path)| path).collect()
}

fn resolve_node_command(app: &AppHandle) -> Option<String> {
    let mut ordered_candidates: Vec<String> = Vec::new();
    let mut seen = BTreeSet::new();
    let mut push_candidate = |candidate: String| {
        if candidate.trim().is_empty() || seen.contains(&candidate) {
            return;
        }
        seen.insert(candidate.clone());
        ordered_candidates.push(candidate);
    };

    if let Some(path) = managed_node_command_path(app) {
        push_candidate(path.to_string_lossy().to_string());
    }

    if let Some(path) = bundled_node_command_path(app) {
        push_candidate(path.to_string_lossy().to_string());
    }

    for path in nvm_node_candidate_paths() {
        push_candidate(path.to_string_lossy().to_string());
    }

    if cfg!(target_os = "macos") {
        let mac_candidates = [
            "/opt/homebrew/bin/node",
            "/usr/local/bin/node",
            "/usr/bin/node",
        ];
        for candidate in mac_candidates {
            if PathBuf::from(candidate).exists() {
                push_candidate(candidate.to_string());
            }
        }
    }

    if cfg!(target_os = "windows") {
        let mut win_candidates: Vec<PathBuf> = Vec::new();
        if let Ok(program_files) = env::var("ProgramFiles") {
            win_candidates.push(PathBuf::from(program_files).join("nodejs").join("node.exe"));
        }
        if let Ok(program_files_x86) = env::var("ProgramFiles(x86)") {
            win_candidates.push(
                PathBuf::from(program_files_x86)
                    .join("nodejs")
                    .join("node.exe"),
            );
        }
        for candidate in win_candidates {
            if candidate.exists() {
                push_candidate(candidate.to_string_lossy().to_string());
            }
        }
    }

    if cfg!(target_os = "linux") {
        let linux_candidates = ["/usr/bin/node", "/usr/local/bin/node", "/snap/bin/node"];
        for candidate in linux_candidates {
            if PathBuf::from(candidate).exists() {
                push_candidate(candidate.to_string());
            }
        }
    }

    if is_command_available("node") {
        push_candidate("node".to_string());
    }

    let mut fallback: Option<String> = None;
    for candidate in ordered_candidates {
        let Some(major) = node_major_for_program(&candidate) else {
            continue;
        };

        if is_preferred_node_major(major) {
            return Some(candidate);
        }

        if fallback.is_none() {
            fallback = Some(candidate);
        }
    }

    fallback
}

fn npm_command_name() -> &'static str {
    if cfg!(target_os = "windows") {
        "npm.cmd"
    } else {
        "npm"
    }
}

fn is_command_available(command: &str) -> bool {
    Command::new(command)
        .arg("--version")
        .output()
        .map(|output| output.status.success())
        .unwrap_or(false)
}

fn command_version_with_args(program: &str, prefix_args: &[String]) -> String {
    let mut command = Command::new(program);
    for arg in prefix_args {
        command.arg(arg);
    }
    command.arg("--version");

    match command.output() {
        Ok(output) => {
            let stdout = String::from_utf8_lossy(&output.stdout).trim().to_string();
            let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
            if !stdout.is_empty() {
                stdout
            } else if !stderr.is_empty() {
                stderr
            } else {
                "unknown".to_string()
            }
        }
        Err(_) => "unknown".to_string(),
    }
}

fn is_http_url(value: &str) -> bool {
    value.starts_with("http://") || value.starts_with("https://")
}

fn app_gateway_http_url() -> String {
    format!("http://127.0.0.1:{}", APP_GATEWAY_PORT)
}

fn app_gateway_ws_url() -> String {
    format!("ws://127.0.0.1:{}", APP_GATEWAY_PORT)
}

fn gateway_runtime_fingerprint_path(app: &AppHandle) -> Result<PathBuf, String> {
    let dir = app_config_dir(app)?;
    Ok(dir.join(GATEWAY_RUNTIME_FINGERPRINT_FILE_NAME))
}

fn gateway_runtime_fingerprint(cfg: &StoredConfig) -> String {
    serde_json::to_string(cfg).unwrap_or_else(|_| {
        format!(
            "{}|{}|{}|{}",
            cfg.provider,
            cfg.model,
            cfg.base_url.clone().unwrap_or_default(),
            cfg.custom_api_mode
        )
    })
}

fn should_force_restart_gateway(app: &AppHandle, cfg: &StoredConfig) -> bool {
    let path = match gateway_runtime_fingerprint_path(app) {
        Ok(v) => v,
        Err(_) => return true,
    };
    let expected = gateway_runtime_fingerprint(cfg);
    let current = fs::read_to_string(path).unwrap_or_default();
    current.trim() != expected.trim()
}

fn persist_gateway_runtime_fingerprint(app: &AppHandle, cfg: &StoredConfig) {
    if let Ok(path) = gateway_runtime_fingerprint_path(app) {
        let _ = fs::write(path, gateway_runtime_fingerprint(cfg));
    }
}

fn build_openclaw_command(resolved: &ResolvedOpenClawCommand) -> Command {
    let mut command = Command::new(&resolved.program);
    for arg in &resolved.prefix_args {
        command.arg(arg);
    }
    command
}

fn apply_openclaw_runtime_env(cmd: &mut Command, cfg: &StoredConfig, app: &AppHandle) {
    if let Ok(home_dir) = openclaw_runtime_home_dir(app) {
        let home = home_dir.to_string_lossy().to_string();
        cmd.env("HOME", &home)
            .env("USERPROFILE", &home)
            .env("OPENCLAW_HOME", &home);
    }

    if let Ok(workspace_dir) = openclaw_runtime_workspace_dir(app) {
        let workspace = workspace_dir.to_string_lossy().to_string();
        cmd.current_dir(&workspace_dir)
            .env("PWD", &workspace)
            .env("OPENCLAW_WORKSPACE", &workspace);
    }

    cmd.env("OPENCLAW_PROVIDER", cfg.provider.clone())
        .env("OPENCLAW_MODEL", cfg.model.clone())
        .env("OPENCLAW_API_KEY", cfg.api_key.clone());

    if !cfg.skills_dirs.is_empty() {
        cmd.env(
            "OPENCLAW_SKILLS_DIRS",
            cfg.skills_dirs.join(path_delimiter()),
        );
    }

    apply_provider_env(
        cmd,
        cfg.provider.trim(),
        cfg.api_key.trim(),
        cfg.base_url.as_deref().map(str::trim),
    );

    if let Some(bin_dir) = resolve_bundled_bin_dir(app) {
        let existing = env::var("PATH").unwrap_or_default();
        let merged_path = if existing.trim().is_empty() {
            bin_dir.to_string_lossy().to_string()
        } else {
            format!(
                "{}{}{}",
                bin_dir.to_string_lossy(),
                path_delimiter(),
                existing
            )
        };
        cmd.env("PATH", merged_path);
    }
}

fn merge_command_output(output: &std::process::Output) -> String {
    let stdout = String::from_utf8_lossy(&output.stdout).trim().to_string();
    let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();

    if stderr.is_empty() {
        stdout
    } else if stdout.is_empty() {
        stderr
    } else {
        format!("{}\n{}", stdout, stderr)
    }
}

fn run_openclaw_capture(
    app: &AppHandle,
    cfg: &StoredConfig,
    resolved: &ResolvedOpenClawCommand,
    args: &[&str],
) -> Result<(bool, String), String> {
    let mut cmd = build_openclaw_command(resolved);
    for arg in args {
        cmd.arg(arg);
    }
    apply_openclaw_runtime_env(&mut cmd, cfg, app);

    let output = cmd.output().map_err(|e| e.to_string())?;
    let merged = merge_command_output(&output);
    Ok((output.status.success(), merged))
}

fn normalize_cli_value(raw: &str) -> String {
    let trimmed = raw.trim();
    let without_double = trimmed
        .strip_prefix('"')
        .and_then(|v| v.strip_suffix('"'))
        .unwrap_or(trimmed);
    let without_single = without_double
        .strip_prefix('\'')
        .and_then(|v| v.strip_suffix('\''))
        .unwrap_or(without_double);
    without_single.trim().to_string()
}

fn expand_runtime_path_tokens(raw: &str, app: &AppHandle) -> PathBuf {
    let mut value = normalize_cli_value(raw);
    if value.is_empty() {
        return PathBuf::new();
    }

    let runtime_home = openclaw_runtime_home_dir(app)
        .ok()
        .or_else(|| env::var("HOME").ok().map(PathBuf::from))
        .unwrap_or_else(|| PathBuf::from("."));
    let runtime_home_str = runtime_home.to_string_lossy().to_string();

    for token in ["${OPENCLAW_HOME}", "$OPENCLAW_HOME", "${HOME}", "$HOME"] {
        if value.contains(token) {
            value = value.replace(token, &runtime_home_str);
        }
    }

    if value == "~" {
        value = runtime_home_str.clone();
    } else if let Some(rest) = value.strip_prefix("~/") {
        value = format!("{}/{}", runtime_home_str, rest);
    }

    PathBuf::from(value)
}

fn read_openclaw_config_value(
    app: &AppHandle,
    cfg: &StoredConfig,
    resolved: &ResolvedOpenClawCommand,
    path: &str,
) -> Option<String> {
    let args = ["config", "get", path];
    match run_openclaw_capture(app, cfg, resolved, &args) {
        Ok((true, output)) => output
            .lines()
            .map(str::trim)
            .find(|line| !line.is_empty())
            .map(normalize_cli_value),
        _ => None,
    }
}

fn ensure_json_object_mut(
    value: &mut serde_json::Value,
) -> &mut serde_json::Map<String, serde_json::Value> {
    if !value.is_object() {
        *value = serde_json::json!({});
    }
    // safe: ensured object above
    value.as_object_mut().expect("value must be object")
}

fn upsert_custom_model(
    provider: &mut serde_json::Map<String, serde_json::Value>,
    model: &str,
    custom_api_mode: &str,
) -> Result<(), String> {
    let model_stub = serde_json::json!({
        "id": model,
        "name": format!("{} (Custom Provider)", model),
        "api": custom_api_mode,
        "reasoning": false,
        "input": ["text"],
        "cost": {
            "input": 0,
            "output": 0,
            "cacheRead": 0,
            "cacheWrite": 0
        },
        "contextWindow": 16000,
        "maxTokens": 4096
    });

    if let Some(existing_models) = provider.get_mut("models").and_then(|v| v.as_array_mut()) {
        if let Some(existing) = existing_models.iter_mut().find(|entry| {
            entry
                .get("id")
                .and_then(|v| v.as_str())
                .map(|id| id.eq_ignore_ascii_case(model))
                .unwrap_or(false)
        }) {
            if let Some(obj) = existing.as_object_mut() {
                obj.insert("id".to_string(), serde_json::json!(model));
                obj.insert(
                    "name".to_string(),
                    serde_json::json!(format!("{} (Custom Provider)", model)),
                );
                obj.insert("api".to_string(), serde_json::json!(custom_api_mode));
                if !obj.contains_key("input") {
                    obj.insert("input".to_string(), serde_json::json!(["text"]));
                }
                if !obj.contains_key("cost") {
                    obj.insert(
                        "cost".to_string(),
                        serde_json::json!({
                            "input": 0,
                            "output": 0,
                            "cacheRead": 0,
                            "cacheWrite": 0
                        }),
                    );
                }
                if !obj.contains_key("contextWindow") {
                    obj.insert("contextWindow".to_string(), serde_json::json!(16000));
                }
                if !obj.contains_key("maxTokens") {
                    obj.insert("maxTokens".to_string(), serde_json::json!(4096));
                }
            } else {
                *existing = model_stub;
            }
            return Ok(());
        }

        existing_models.push(model_stub);
        return Ok(());
    }

    provider.insert("models".to_string(), serde_json::json!([model_stub]));
    Ok(())
}

fn resolve_openclaw_config_file(
    app: &AppHandle,
    cfg: &StoredConfig,
    resolved: &ResolvedOpenClawCommand,
) -> Result<PathBuf, String> {
    if let Ok((true, output)) = run_openclaw_capture(app, cfg, resolved, &["config", "file"]) {
        if let Some(path) = output.lines().map(str::trim).find(|line| !line.is_empty()) {
            return Ok(expand_runtime_path_tokens(path, app));
        }
    }

    let fallback_home = openclaw_runtime_home_dir(app)
        .or_else(|_| {
            env::var("HOME")
                .map(PathBuf::from)
                .map_err(|e| e.to_string())
        })
        .unwrap_or_else(|_| PathBuf::from("."));
    Ok(fallback_home.join(".openclaw").join("openclaw.json"))
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

fn sync_custom_api_mode_from_runtime_if_newer(
    app: &AppHandle,
    cfg: &mut StoredConfig,
    resolved: &ResolvedOpenClawCommand,
) -> Result<(), String> {
    // Do not sync custom API mode from runtime back to app config.
    // The app config is the source of truth and user selection must remain stable.
    let _ = (app, cfg, resolved);
    Ok(())
}

fn read_config_with_runtime_custom_api_mode_sync(app: &AppHandle) -> Result<Option<StoredConfig>, String> {
    let Some(mut cfg) = read_config(app)? else {
        return Ok(None);
    };

    if maybe_migrate_legacy_custom_api_mode(&mut cfg) {
        write_config(app, &cfg)?;
    }

    let resolved = resolve_openclaw_command(&cfg, app);
    sync_custom_api_mode_from_runtime_if_newer(app, &mut cfg, &resolved)?;
    let normalized = normalize_custom_api_mode_for_base_url(cfg.base_url.as_deref(), &cfg.custom_api_mode);
    if normalized != cfg.custom_api_mode {
        cfg.custom_api_mode = normalized;
        cfg.updated_at = Utc::now().to_rfc3339();
        write_config(app, &cfg)?;
    }
    Ok(Some(cfg))
}

fn apply_custom_provider_overrides(
    app: &AppHandle,
    cfg: &StoredConfig,
    resolved: &ResolvedOpenClawCommand,
    custom_api_mode: &str,
) -> Result<(), String> {
    let config_file = resolve_openclaw_config_file(app, cfg, resolved)?;
    if !config_file.exists() {
        return Ok(());
    }

    let base_url = cfg
        .base_url
        .as_deref()
        .map(str::trim)
        .filter(|v| !v.is_empty())
        .ok_or_else(|| "Provider 为 custom 时必须配置 Base URL。".to_string())?;
    let model = cfg.model.trim();
    if model.is_empty() {
        return Err("Provider 为 custom 时必须配置 Model。".to_string());
    }

    let raw = fs::read_to_string(&config_file)
        .map_err(|e| format!("读取 OpenClaw 配置失败 ({}): {}", config_file.display(), e))?;
    let mut root: serde_json::Value = serde_json::from_str(trim_utf8_bom(&raw))
        .map_err(|e| format!("解析 OpenClaw 配置失败: {}", e))?;

    {
        let root_obj = ensure_json_object_mut(&mut root);
        let models_value = root_obj
            .entry("models".to_string())
            .or_insert_with(|| serde_json::json!({}));
        let models_obj = ensure_json_object_mut(models_value);
        models_obj
            .entry("mode".to_string())
            .or_insert_with(|| serde_json::json!("merge"));

        let providers_value = models_obj
            .entry("providers".to_string())
            .or_insert_with(|| serde_json::json!({}));
        let providers_obj = ensure_json_object_mut(providers_value);
        let custom_value = providers_obj
            .entry("custom".to_string())
            .or_insert_with(|| serde_json::json!({}));
        let custom_obj = ensure_json_object_mut(custom_value);

        custom_obj.insert("baseUrl".to_string(), serde_json::json!(base_url));
        custom_obj.insert("api".to_string(), serde_json::json!(custom_api_mode));
        custom_obj.insert("apiKey".to_string(), serde_json::json!(cfg.api_key.trim()));
        if cfg.custom_headers.is_empty() {
            custom_obj.remove("headers");
        } else {
            custom_obj.insert("headers".to_string(), serde_json::json!(cfg.custom_headers));
        }

        upsert_custom_model(custom_obj, model, custom_api_mode)?;
    }

    {
        let model_ref = normalize_model_ref("custom", model);
        let root_obj = ensure_json_object_mut(&mut root);
        let agents_value = root_obj
            .entry("agents".to_string())
            .or_insert_with(|| serde_json::json!({}));
        let agents_obj = ensure_json_object_mut(agents_value);
        let defaults_value = agents_obj
            .entry("defaults".to_string())
            .or_insert_with(|| serde_json::json!({}));
        let defaults_obj = ensure_json_object_mut(defaults_value);
        let model_value = defaults_obj
            .entry("model".to_string())
            .or_insert_with(|| serde_json::json!({}));
        let model_obj = ensure_json_object_mut(model_value);
        model_obj.insert("primary".to_string(), serde_json::json!(model_ref.clone()));

        let defaults_models_value = defaults_obj
            .entry("models".to_string())
            .or_insert_with(|| serde_json::json!({}));
        let defaults_models_obj = ensure_json_object_mut(defaults_models_value);
        defaults_models_obj
            .entry(model_ref)
            .or_insert_with(|| serde_json::json!({}));
    }

    let data =
        serde_json::to_string_pretty(&root).map_err(|e| format!("序列化 OpenClaw 配置失败: {}", e))?;
    fs::write(&config_file, data)
        .map_err(|e| format!("写入 OpenClaw 配置失败 ({}): {}", config_file.display(), e))?;
    Ok(())
}

fn apply_runtime_default_model_overrides(
    app: &AppHandle,
    cfg: &StoredConfig,
    resolved: &ResolvedOpenClawCommand,
) -> Result<(), String> {
    let provider = cfg.provider.trim();
    if provider.is_empty() {
        return Err("Provider 不能为空。".to_string());
    }

    let model = cfg.model.trim();
    if model.is_empty() {
        return Err("Model 不能为空。".to_string());
    }

    let config_file = resolve_openclaw_config_file(app, cfg, resolved)?;
    if let Some(parent) = config_file.parent() {
        fs::create_dir_all(parent)
            .map_err(|e| format!("创建 OpenClaw 配置目录失败 ({}): {}", parent.display(), e))?;
    }

    let raw = if config_file.exists() {
        fs::read_to_string(&config_file)
            .map_err(|e| format!("读取 OpenClaw 配置失败 ({}): {}", config_file.display(), e))?
    } else {
        "{}".to_string()
    };
    let mut root: serde_json::Value = serde_json::from_str(trim_utf8_bom(&raw))
        .map_err(|e| format!("解析 OpenClaw 配置失败: {}", e))?;

    let model_ref = normalize_model_ref(provider, model);
    {
        let root_obj = ensure_json_object_mut(&mut root);
        let agents_value = root_obj
            .entry("agents".to_string())
            .or_insert_with(|| serde_json::json!({}));
        let agents_obj = ensure_json_object_mut(agents_value);
        let defaults_value = agents_obj
            .entry("defaults".to_string())
            .or_insert_with(|| serde_json::json!({}));
        let defaults_obj = ensure_json_object_mut(defaults_value);
        let model_value = defaults_obj
            .entry("model".to_string())
            .or_insert_with(|| serde_json::json!({}));
        let model_obj = ensure_json_object_mut(model_value);
        model_obj.insert("primary".to_string(), serde_json::json!(model_ref.clone()));

        let defaults_models_value = defaults_obj
            .entry("models".to_string())
            .or_insert_with(|| serde_json::json!({}));
        let defaults_models_obj = ensure_json_object_mut(defaults_models_value);
        defaults_models_obj
            .entry(model_ref)
            .or_insert_with(|| serde_json::json!({}));
    }

    let data =
        serde_json::to_string_pretty(&root).map_err(|e| format!("序列化 OpenClaw 配置失败: {}", e))?;
    fs::write(&config_file, data)
        .map_err(|e| format!("写入 OpenClaw 配置失败 ({}): {}", config_file.display(), e))?;
    Ok(())
}

fn apply_openclaw_mobile_channel_overrides(
    app: &AppHandle,
    cfg: &StoredConfig,
    resolved: &ResolvedOpenClawCommand,
) -> Result<(), String> {
    let config_file = resolve_openclaw_config_file(app, cfg, resolved)?;
    if !config_file.exists() {
        return Ok(());
    }

    let raw = fs::read_to_string(&config_file)
        .map_err(|e| format!("读取 OpenClaw 配置失败 ({}): {}", config_file.display(), e))?;
    let mut root: serde_json::Value =
        serde_json::from_str(&raw).map_err(|e| format!("解析 OpenClaw 配置失败: {}", e))?;

    let base_url = cfg
        .channel_server_base_url
        .as_deref()
        .map(str::trim)
        .filter(|v| !v.is_empty())
        .map(str::to_string);
    let device_id = cfg
        .channel_device_id
        .as_deref()
        .map(str::trim)
        .filter(|v| !v.is_empty())
        .map(str::to_string);

    let should_enable = base_url.is_some() && device_id.is_some();
    if should_enable {
        let root_obj = ensure_json_object_mut(&mut root);
        let plugins_value = root_obj
            .entry("plugins".to_string())
            .or_insert_with(|| serde_json::json!({}));
        let plugins_obj = ensure_json_object_mut(plugins_value);
        let plugin_entries_value = plugins_obj
            .entry("entries".to_string())
            .or_insert_with(|| serde_json::json!({}));
        let plugin_entries_obj = ensure_json_object_mut(plugin_entries_value);
        let plugin_entry_value = plugin_entries_obj
            .entry("openclaw-mobile".to_string())
            .or_insert_with(|| serde_json::json!({}));
        let plugin_entry_obj = ensure_json_object_mut(plugin_entry_value);
        plugin_entry_obj.insert("enabled".to_string(), serde_json::json!(true));
    } else {
        let root_obj = ensure_json_object_mut(&mut root);
        let mut drop_plugins_root = false;
        if let Some(plugins_value) = root_obj.get_mut("plugins") {
            let plugins_is_empty;
            if let Some(plugins_obj) = plugins_value.as_object_mut() {
                let mut drop_entries = false;
                if let Some(entries_value) = plugins_obj.get_mut("entries") {
                    let entries_is_empty;
                    if let Some(entries_obj) = entries_value.as_object_mut() {
                        entries_obj.remove("openclaw-mobile");
                        entries_is_empty = entries_obj.is_empty();
                    } else {
                        entries_is_empty = true;
                    }
                    if entries_is_empty {
                        drop_entries = true;
                    }
                }
                if drop_entries {
                    plugins_obj.remove("entries");
                }
                plugins_is_empty = plugins_obj.is_empty();
            } else {
                plugins_is_empty = true;
            }
            if plugins_is_empty {
                drop_plugins_root = true;
            }
        }
        if drop_plugins_root {
            root_obj.remove("plugins");
        }
    }

    if should_enable {
        let root_obj = ensure_json_object_mut(&mut root);
        let channels_value = root_obj
            .entry("channels".to_string())
            .or_insert_with(|| serde_json::json!({}));
        let channels_obj = ensure_json_object_mut(channels_value);
        let channel_value = channels_obj
            .entry("openclaw-mobile".to_string())
            .or_insert_with(|| serde_json::json!({}));
        let channel_obj = ensure_json_object_mut(channel_value);
        if let (Some(url), Some(device)) = (base_url.as_ref(), device_id.as_ref()) {
            channel_obj.insert("enabled".to_string(), serde_json::json!(true));
            channel_obj.insert("serverBaseUrl".to_string(), serde_json::json!(url));
            channel_obj.insert("desktopDeviceId".to_string(), serde_json::json!(device));
        }
    } else {
        let root_obj = ensure_json_object_mut(&mut root);
        let mut drop_channels_root = false;
        if let Some(channels_value) = root_obj.get_mut("channels") {
            let channels_is_empty;
            if let Some(channels_obj) = channels_value.as_object_mut() {
                channels_obj.remove("openclaw-mobile");
                channels_is_empty = channels_obj.is_empty();
            } else {
                channels_is_empty = true;
            }
            if channels_is_empty {
                drop_channels_root = true;
            }
        }
        if drop_channels_root {
            root_obj.remove("channels");
        }
    }

    let data =
        serde_json::to_string_pretty(&root).map_err(|e| format!("序列化 OpenClaw 配置失败: {}", e))?;
    fs::write(&config_file, data)
        .map_err(|e| format!("写入 OpenClaw 配置失败 ({}): {}", config_file.display(), e))?;
    Ok(())
}

fn normalize_model_ref(provider: &str, model: &str) -> String {
    let model_trimmed = model.trim();
    if model_trimmed.contains('/') {
        model_trimmed.to_string()
    } else {
        format!("{}/{}", provider.trim(), model_trimmed)
    }
}

fn is_custom_model_synced(
    app: &AppHandle,
    cfg: &StoredConfig,
    resolved: &ResolvedOpenClawCommand,
) -> bool {
    let expected = normalize_model_ref("custom", &cfg.model);
    let model_ok = match run_openclaw_capture(app, cfg, resolved, &["models", "status", "--plain"]) {
        Ok((true, output)) => output
            .lines()
            .next()
            .map(|line| line.trim().eq_ignore_ascii_case(&expected))
            .unwrap_or(false),
        _ => false,
    };

    if !model_ok {
        return false;
    }

    let expected_api =
        normalize_custom_api_mode(Some(cfg.custom_api_mode.as_str())).unwrap_or_else(|_| default_custom_api_mode());
    read_openclaw_config_value(app, cfg, resolved, "models.providers.custom.api")
        .map(|value| value.eq_ignore_ascii_case(&expected_api))
        .unwrap_or(false)
}

fn sync_custom_provider_if_needed(
    app: &AppHandle,
    cfg: &StoredConfig,
    resolved: &ResolvedOpenClawCommand,
) -> Result<(), String> {
    if !cfg.provider.trim().eq_ignore_ascii_case("custom") {
        return Ok(());
    }

    let base_url = cfg
        .base_url
        .as_deref()
        .map(str::trim)
        .filter(|v| !v.is_empty())
        .ok_or_else(|| "Provider 为 custom 时必须配置 Base URL。".to_string())?;
    let model = cfg.model.trim();
    if model.is_empty() {
        return Err("Provider 为 custom 时必须配置 Model。".to_string());
    }
    let custom_api_mode =
        normalize_custom_api_mode(Some(cfg.custom_api_mode.as_str())).unwrap_or_else(|_| default_custom_api_mode());
    let compatibility = if custom_api_mode.eq_ignore_ascii_case("anthropic-messages") {
        "anthropic"
    } else {
        "openai"
    };

    if !is_custom_model_synced(app, cfg, resolved) {
        let mut cmd = build_openclaw_command(resolved);
        cmd.arg("onboard")
            .arg("--non-interactive")
            .arg("--accept-risk")
            .arg("--skip-health")
            .arg("--skip-channels")
            .arg("--skip-ui")
            .arg("--skip-search")
            .arg("--skip-skills")
            .arg("--skip-daemon")
            .arg("--mode")
            .arg("local")
            .arg("--auth-choice")
            .arg("custom-api-key")
            .arg("--custom-base-url")
            .arg(base_url)
            .arg("--custom-model-id")
            .arg(model)
            .arg("--custom-provider-id")
            .arg("custom")
            .arg("--custom-compatibility")
            .arg(compatibility)
            .arg("--gateway-port")
            .arg("18789")
            .arg("--gateway-bind")
            .arg("loopback")
            .env("CUSTOM_API_KEY", cfg.api_key.trim());

        apply_openclaw_runtime_env(&mut cmd, cfg, app);

        let output = cmd.output().map_err(|e| e.to_string())?;
        let merged = merge_command_output(&output);
        if !output.status.success() {
            return Err(if merged.is_empty() {
                "onboard 执行失败。".to_string()
            } else {
                merged
            });
        }
    }

    apply_custom_provider_overrides(app, cfg, resolved, &custom_api_mode)?;

    if !is_custom_model_synced(app, cfg, resolved) {
        return Err("onboard 已执行，但 custom 模型仍未生效。".to_string());
    }

    Ok(())
}

fn is_dashboard_url_reachable(url: &str) -> bool {
    if !is_http_url(url) {
        return false;
    }

    let mut parsed = match url::Url::parse(url) {
        Ok(v) => v,
        Err(_) => return false,
    };
    parsed.set_fragment(None);
    let host = match parsed.host_str() {
        Some(v) => v,
        None => return false,
    };
    let port = match parsed.port_or_known_default() {
        Some(v) => v,
        None => return false,
    };

    let address = format!("{}:{}", host, port);
    let addrs = match address.to_socket_addrs() {
        Ok(v) => v,
        Err(_) => return false,
    };

    for addr in addrs {
        if TcpStream::connect_timeout(&addr, Duration::from_millis(350)).is_ok() {
            let client = match reqwest::blocking::Client::builder()
                .timeout(Duration::from_millis(800))
                .build()
            {
                Ok(v) => v,
                Err(_) => return true,
            };
            return client
                .get(parsed.as_str())
                .send()
                .map(|response| response.status().is_success())
                .unwrap_or(false);
        }
    }
    false
}

fn is_gateway_healthy(
    app: &AppHandle,
    cfg: &StoredConfig,
    resolved: &ResolvedOpenClawCommand,
) -> bool {
    let ws_url = app_gateway_ws_url();
    let mut cmd = build_openclaw_command(resolved);
    cmd.arg("gateway")
        .arg("health")
        .arg("--url")
        .arg(&ws_url)
        .arg("--token")
        .arg(APP_GATEWAY_TOKEN);
    apply_openclaw_runtime_env(&mut cmd, cfg, app);

    match cmd.output() {
        Ok(output) => output.status.success(),
        Err(_) => false,
    }
}

fn start_gateway_background(
    app: &AppHandle,
    cfg: &StoredConfig,
    resolved: &ResolvedOpenClawCommand,
) -> Result<(), String> {
    let mut cmd = build_openclaw_command(resolved);
    cmd.arg("gateway")
        .arg("run")
        .arg("--allow-unconfigured")
        .arg("--bind")
        .arg("loopback")
        .arg("--port")
        .arg(APP_GATEWAY_PORT.to_string())
        .arg("--auth")
        .arg("token")
        .arg("--token")
        .arg(APP_GATEWAY_TOKEN)
        .arg("--force")
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null());
    apply_openclaw_runtime_env(&mut cmd, cfg, app);
    cmd.spawn().map(|_| ()).map_err(|e| e.to_string())
}

fn ensure_gateway_running(
    app: &AppHandle,
    cfg: &StoredConfig,
    resolved: &ResolvedOpenClawCommand,
    force_restart: bool,
) -> Result<bool, String> {
    let dashboard_url = app_gateway_http_url();
    if !force_restart
        && is_gateway_healthy(app, cfg, resolved)
        && is_dashboard_url_reachable(&dashboard_url)
    {
        return Ok(false);
    }

    start_gateway_background(app, cfg, resolved)?;

    let deadline = Instant::now() + Duration::from_secs(APP_GATEWAY_READY_TIMEOUT_SECS);
    while Instant::now() < deadline {
        if is_gateway_healthy(app, cfg, resolved) && is_dashboard_url_reachable(&dashboard_url) {
            return Ok(true);
        }
        thread::sleep(Duration::from_millis(300));
    }

    Err(format!(
        "Gateway 启动超时：等待 {} 秒后 Dashboard 仍未就绪。",
        APP_GATEWAY_READY_TIMEOUT_SECS
    ))
}

fn resolve_openclaw_command(cfg: &StoredConfig, app: &AppHandle) -> ResolvedOpenClawCommand {
    let configured = cfg.openclaw_command.trim();
    if !configured.is_empty() && configured != "openclaw" {
        return ResolvedOpenClawCommand {
            program: configured.to_string(),
            prefix_args: Vec::new(),
            source: "custom".to_string(),
            display_path: configured.to_string(),
        };
    }

    if let Ok(managed_script) = managed_openclaw_script_path(app) {
        if managed_script.exists() {
            if let Some(node_command) = resolve_node_command(app) {
                return ResolvedOpenClawCommand {
                    program: node_command,
                    prefix_args: vec![managed_script.to_string_lossy().to_string()],
                    source: "managed-kernel".to_string(),
                    display_path: managed_script.to_string_lossy().to_string(),
                };
            }
        }
    }

    if let Some(bundled_script) = bundled_openclaw_script_path(app) {
        if bundled_script.exists() {
            if let Some(node_command) = resolve_node_command(app) {
                return ResolvedOpenClawCommand {
                    program: node_command,
                    prefix_args: vec![bundled_script.to_string_lossy().to_string()],
                    source: "bundled-kernel".to_string(),
                    display_path: bundled_script.to_string_lossy().to_string(),
                };
            }
        }
    }

    if let Some(bin_dir) = resolve_bundled_bin_dir(app) {
        let bundled = if cfg!(target_os = "windows") {
            bin_dir.join("openclaw.exe")
        } else {
            bin_dir.join("openclaw")
        };
        if bundled.exists() {
            return ResolvedOpenClawCommand {
                program: bundled.to_string_lossy().to_string(),
                prefix_args: Vec::new(),
                source: "bundled-bin".to_string(),
                display_path: bundled.to_string_lossy().to_string(),
            };
        }
    }

    ResolvedOpenClawCommand {
        program: "openclaw".to_string(),
        prefix_args: Vec::new(),
        source: "system-path".to_string(),
        display_path: "openclaw".to_string(),
    }
}

#[tauri::command]
fn get_state(app: AppHandle) -> Result<StateResponse, String> {
    let config = read_config_with_runtime_custom_api_mode_sync(&app)?;

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

#[tauri::command]
fn read_raw_config(app: AppHandle) -> Result<Option<StoredConfig>, String> {
    read_config_with_runtime_custom_api_mode_sync(&app)
}

#[tauri::command]
fn get_config_path(app: AppHandle) -> Result<String, String> {
    Ok(config_path(&app)?.to_string_lossy().to_string())
}

#[tauri::command]
fn get_kernel_status(app: AppHandle) -> Result<KernelStatusResponse, String> {
    let npm_available = is_command_available(npm_command_name());

    if let Ok(managed_script) = managed_openclaw_script_path(&app) {
        if managed_script.exists() {
            let version = if let Some(node_command) = resolve_node_command(&app) {
                let args = vec![managed_script.to_string_lossy().to_string()];
                command_version_with_args(&node_command, &args)
            } else {
                "unknown".to_string()
            };

            return Ok(KernelStatusResponse {
                installed: true,
                command_path: managed_script.to_string_lossy().to_string(),
                version,
                source: "managed-kernel".to_string(),
                npm_available,
            });
        }
    }

    if let Some(bundled_script) = bundled_openclaw_script_path(&app) {
        if bundled_script.exists() {
            let version = if let Some(node_command) = resolve_node_command(&app) {
                let args = vec![bundled_script.to_string_lossy().to_string()];
                command_version_with_args(&node_command, &args)
            } else {
                "unknown".to_string()
            };

            return Ok(KernelStatusResponse {
                installed: true,
                command_path: bundled_script.to_string_lossy().to_string(),
                version,
                source: "bundled-kernel".to_string(),
                npm_available,
            });
        }
    }

    if let Some(bin_dir) = resolve_bundled_bin_dir(&app) {
        let bundled = if cfg!(target_os = "windows") {
            bin_dir.join("openclaw.exe")
        } else {
            bin_dir.join("openclaw")
        };

        if bundled.exists() {
            let version = command_version_with_args(&bundled.to_string_lossy(), &[]);
            return Ok(KernelStatusResponse {
                installed: true,
                command_path: bundled.to_string_lossy().to_string(),
                version,
                source: "bundled-bin".to_string(),
                npm_available,
            });
        }
    }

    Ok(KernelStatusResponse {
        installed: false,
        command_path: String::new(),
        version: String::new(),
        source: "none".to_string(),
        npm_available,
    })
}

#[tauri::command]
fn get_kernel_version_meta(app: AppHandle) -> Result<KernelVersionMetaResponse, String> {
    let status = get_kernel_status(app)?;
    let current = status.version.trim();
    let current_version = if current.is_empty() {
        "unknown".to_string()
    } else {
        current.to_string()
    };

    match latest_openclaw_version_from_npm() {
        Ok(latest) => Ok(KernelVersionMetaResponse {
            current_version,
            latest_version: Some(latest),
            latest_error: None,
        }),
        Err(error) => Ok(KernelVersionMetaResponse {
            current_version,
            latest_version: None,
            latest_error: Some(error),
        }),
    }
}

#[tauri::command]
fn install_or_update_kernel(app: AppHandle) -> Result<ActionResponse, String> {
    let npm = npm_command_name();
    if !is_command_available(npm) {
        if let Some(bundled_script) = bundled_openclaw_script_path(&app) {
            if bundled_script.exists() {
                return Ok(ActionResponse {
                    ok: true,
                    message: "当前安装包已内置 OpenClaw 内核，无需再安装。".to_string(),
                    detail: Some(format!(
                        "内置内核路径: {}",
                        bundled_script.to_string_lossy()
                    )),
                    copied_from: None,
                    copied_to: None,
                });
            }
        }

        return Ok(ActionResponse {
            ok: false,
            message:
                "未检测到 npm。请先安装 Node.js/npm，或在“OpenClaw 命令”里指定已有的 openclaw。"
                    .to_string(),
            detail: None,
            copied_from: None,
            copied_to: None,
        });
    }

    let kernel_root = managed_kernel_root(&app)?;
    let mut install = Command::new(npm);
    install
        .arg("install")
        .arg("--no-audit")
        .arg("--no-fund")
        .arg("--prefix")
        .arg(&kernel_root)
        .arg("openclaw@latest");

    let install_output = match install.output() {
        Ok(value) => value,
        Err(e) => {
            return Ok(ActionResponse {
                ok: false,
                message: "执行 npm 安装失败。".to_string(),
                detail: Some(e.to_string()),
                copied_from: None,
                copied_to: None,
            });
        }
    };

    let install_stdout = String::from_utf8_lossy(&install_output.stdout)
        .trim()
        .to_string();
    let install_stderr = String::from_utf8_lossy(&install_output.stderr)
        .trim()
        .to_string();

    if !install_output.status.success() {
        let detail = if install_stderr.is_empty() {
            install_stdout
        } else {
            install_stderr
        };
        return Ok(ActionResponse {
            ok: false,
            message: "npm 安装 openclaw 失败。".to_string(),
            detail: if detail.is_empty() {
                None
            } else {
                Some(detail)
            },
            copied_from: None,
            copied_to: None,
        });
    }

    let command_path = managed_openclaw_script_path(&app)?;
    if !command_path.exists() {
        return Ok(ActionResponse {
            ok: false,
            message: "安装完成，但未找到 openclaw 可执行文件。".to_string(),
            detail: Some(command_path.to_string_lossy().to_string()),
            copied_from: None,
            copied_to: None,
        });
    }

    let version = if let Some(node_command) = resolve_node_command(&app) {
        let args = vec![command_path.to_string_lossy().to_string()];
        command_version_with_args(&node_command, &args)
    } else {
        "unknown".to_string()
    };

    Ok(ActionResponse {
        ok: true,
        message: format!("OpenClaw 内核已就绪：{}", version),
        detail: Some(format!("内核路径: {}", command_path.to_string_lossy())),
        copied_from: None,
        copied_to: None,
    })
}

#[tauri::command]
fn get_dashboard_url(app: AppHandle) -> Result<ActionResponse, String> {
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
    if let Err(e) = apply_openclaw_mobile_channel_overrides(&app, &cfg, &resolved) {
        return Ok(ActionResponse {
            ok: false,
            message: "同步通信渠道配置失败。".to_string(),
            detail: Some(e),
            copied_from: None,
            copied_to: None,
        });
    }
    let force_restart = should_force_restart_gateway(&app, &cfg);
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
fn save_config(payload: SavePayload, app: AppHandle) -> Result<ActionResponse, String> {
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

    let channel_server_base_url = payload
        .channel_server_base_url
        .as_ref()
        .map(|v| v.trim().to_string())
        .filter(|v| !v.is_empty())
        .or_else(|| existing.as_ref().and_then(|cfg| cfg.channel_server_base_url.clone()));
    let channel_device_id = payload
        .channel_device_id
        .as_ref()
        .map(|v| v.trim().to_string())
        .filter(|v| !v.is_empty())
        .or_else(|| existing.as_ref().and_then(|cfg| cfg.channel_device_id.clone()));

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

    Ok(ActionResponse {
        ok: true,
        message: "配置已保存。".to_string(),
        detail: None,
        copied_from: None,
        copied_to: None,
    })
}

#[tauri::command]
fn fetch_models(payload: FetchModelsPayload) -> Result<FetchModelsResponse, String> {
    let _provider = payload
        .provider
        .unwrap_or_else(|| "custom".to_string())
        .trim()
        .to_lowercase();
    let base_url_raw = payload.base_url.trim().to_string();
    if base_url_raw.is_empty() {
        return Ok(FetchModelsResponse {
            ok: false,
            message: "Base URL 不能为空。".to_string(),
            detail: None,
            models: Vec::new(),
        });
    }

    if url::Url::parse(&base_url_raw).is_err() {
        return Ok(FetchModelsResponse {
            ok: false,
            message: "Base URL 格式无效。".to_string(),
            detail: Some(base_url_raw),
            models: Vec::new(),
        });
    }

    let custom_api_mode = match normalize_custom_api_mode(payload.custom_api_mode.as_deref()) {
        Ok(mode) => mode,
        Err(message) => {
            return Ok(FetchModelsResponse {
                ok: false,
                message,
                detail: None,
                models: Vec::new(),
            })
        }
    };
    let custom_api_mode = normalize_custom_api_mode_for_base_url(
        Some(base_url_raw.as_str()),
        &custom_api_mode,
    );

    let mut custom_headers = match parse_custom_headers_json(payload.custom_headers_json.as_deref()) {
        Ok(headers) => headers,
        Err(message) => {
            return Ok(FetchModelsResponse {
                ok: false,
                message,
                detail: None,
                models: Vec::new(),
            })
        }
    };
    maybe_apply_mdlbus_header_defaults(
        Some(base_url_raw.as_str()),
        &custom_api_mode,
        &mut custom_headers,
    );

    let mut header_map = reqwest::header::HeaderMap::new();
    let mut has_authorization = false;
    let mut has_x_api_key = false;
    let mut has_accept = false;

    for (name, value) in &custom_headers {
        let header_name = reqwest::header::HeaderName::from_bytes(name.as_bytes()).map_err(|e| {
            format!("Custom Headers 中包含非法 Header 名称 `{}`: {}", name, e)
        })?;
        let header_value = reqwest::header::HeaderValue::from_str(value).map_err(|e| {
            format!("Custom Headers 中 Header `{}` 的值非法: {}", name, e)
        })?;

        if name.eq_ignore_ascii_case("authorization") {
            has_authorization = true;
        }
        if name.eq_ignore_ascii_case("x-api-key") {
            has_x_api_key = true;
        }
        if name.eq_ignore_ascii_case("accept") {
            has_accept = true;
        }

        header_map.insert(header_name, header_value);
    }

    let api_key = payload.api_key.unwrap_or_default().trim().to_string();
    if !api_key.is_empty() && !has_authorization && !has_x_api_key {
        if custom_api_mode.eq_ignore_ascii_case("anthropic-messages") {
            if let Ok(value) = reqwest::header::HeaderValue::from_str(&api_key) {
                header_map.insert("x-api-key", value);
            }
        } else if let Ok(value) = reqwest::header::HeaderValue::from_str(&format!("Bearer {}", api_key)) {
            header_map.insert(reqwest::header::AUTHORIZATION, value);
        }
    }

    if !has_accept {
        header_map.insert(
            reqwest::header::ACCEPT,
            reqwest::header::HeaderValue::from_static("application/json"),
        );
    }

    let client = reqwest::blocking::Client::builder()
        .timeout(Duration::from_secs(12))
        .default_headers(header_map)
        .build()
        .map_err(|e| format!("创建网络客户端失败: {}", e))?;

    let candidates = model_endpoint_candidates(&base_url_raw);
    let mut last_error = String::new();
    for endpoint in &candidates {
        let response = match client.get(endpoint).send() {
            Ok(resp) => resp,
            Err(e) => {
                last_error = format!("请求失败: {} ({})", endpoint, e);
                continue;
            }
        };

        let status = response.status();
        let body = response.text().unwrap_or_default();
        if status.is_success() {
            let models = extract_model_ids(&body);
            if !models.is_empty() {
                return Ok(FetchModelsResponse {
                    ok: true,
                    message: format!("已拉取 {} 个模型。", models.len()),
                    detail: Some(format!("来源: {}", endpoint)),
                    models,
                });
            }

            last_error = format!(
                "接口返回成功但未解析出模型: {} (status: {})",
                endpoint,
                status
            );
        } else {
            let snippet: String = body.chars().take(220).collect();
            last_error = format!(
                "接口返回失败: {} (status: {}) {}",
                endpoint, status, snippet
            );
        }
    }

    Ok(FetchModelsResponse {
        ok: false,
        message: "拉取模型失败，请检查 Base URL / API Key / Header 配置。".to_string(),
        detail: if last_error.is_empty() {
            Some(format!("尝试接口: {}", candidates.join(", ")))
        } else {
            Some(last_error)
        },
        models: Vec::new(),
    })
}

#[tauri::command]
fn install_default_skills(target_dir: String, app: AppHandle) -> Result<ActionResponse, String> {
    let target_dir = target_dir.trim().to_string();
    if target_dir.is_empty() {
        return Ok(ActionResponse {
            ok: false,
            message: "目标 skills 目录不能为空。".to_string(),
            detail: None,
            copied_from: None,
            copied_to: None,
        });
    }

    let source_dir = resolve_bundled_skills_dir(&app)
        .ok_or_else(|| "未找到内置 skills 目录，请确认 bundle.resources 配置。".to_string())?;

    let target = PathBuf::from(&target_dir);
    copy_dir_recursive(&source_dir, &target)?;

    Ok(ActionResponse {
        ok: true,
        message: "内置 skills 导入成功。".to_string(),
        detail: None,
        copied_from: Some(source_dir.to_string_lossy().to_string()),
        copied_to: Some(target.to_string_lossy().to_string()),
    })
}

#[tauri::command]
fn run_doctor(app: AppHandle) -> Result<ActionResponse, String> {
    let cfg = match read_config(&app)? {
        Some(cfg) => cfg,
        None => {
            return Ok(ActionResponse {
                ok: false,
                message: "请先完成 API Key 配置。".to_string(),
                detail: None,
                copied_from: None,
                copied_to: None,
            })
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

    let mut cmd = build_openclaw_command(&resolved);
    cmd.arg("--version")
        .env("OPENCLAW_PROVIDER", cfg.provider.clone())
        .env("OPENCLAW_MODEL", cfg.model.clone())
        .env("OPENCLAW_API_KEY", cfg.api_key.clone());

    if !cfg.skills_dirs.is_empty() {
        cmd.env(
            "OPENCLAW_SKILLS_DIRS",
            cfg.skills_dirs.join(path_delimiter()),
        );
    }

    apply_provider_env(
        &mut cmd,
        cfg.provider.trim(),
        cfg.api_key.trim(),
        cfg.base_url.as_deref().map(str::trim),
    );

    if let Some(bin_dir) = resolve_bundled_bin_dir(&app) {
        let existing = env::var("PATH").unwrap_or_default();
        let merged_path = if existing.trim().is_empty() {
            bin_dir.to_string_lossy().to_string()
        } else {
            format!(
                "{}{}{}",
                bin_dir.to_string_lossy(),
                path_delimiter(),
                existing
            )
        };
        cmd.env("PATH", merged_path);
    }

    let output = match cmd.output() {
        Ok(value) => value,
        Err(e) => {
            return Ok(ActionResponse {
                ok: false,
                message: format!(
                    "OpenClaw 命令检查失败（来源: {}）。请先安装/更新内核，或在“OpenClaw 命令”中指定可执行路径。",
                    resolved.source
                ),
                detail: Some(format!("{}\n命令: {}", e, resolved.display_path)),
                copied_from: None,
                copied_to: None,
            })
        }
    };

    let stdout = String::from_utf8_lossy(&output.stdout).trim().to_string();
    let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();

    if output.status.success() {
        let detail = if stdout.is_empty() { stderr } else { stdout };
        return Ok(ActionResponse {
            ok: true,
            message: format!("OpenClaw 命令检查成功（来源: {}）。", resolved.source),
            detail: if detail.is_empty() {
                None
            } else {
                Some(detail)
            },
            copied_from: None,
            copied_to: None,
        });
    }

    let detail = if stderr.is_empty() { stdout } else { stderr };
    Ok(ActionResponse {
        ok: false,
        message: format!("OpenClaw 命令检查失败（来源: {}）。", resolved.source),
        detail: if detail.is_empty() {
            None
        } else {
            Some(detail)
        },
        copied_from: None,
        copied_to: None,
    })
}

fn is_managed_auth_provider(provider: &str) -> bool {
    matches!(
        provider,
        "openai-codex" | "qwen-portal" | "opencode" | "opencode-go" | "minimax-portal"
    )
}

fn managed_auth_plugin_id(provider: &str) -> Option<&'static str> {
    match provider {
        "qwen-portal" => Some("qwen-portal-auth"),
        "minimax-portal" => Some("minimax-portal-auth"),
        "google-gemini-cli" => Some("google-gemini-cli-auth"),
        "google-antigravity" => Some("google-antigravity-auth"),
        "copilot-proxy" => Some("copilot-proxy"),
        _ => None,
    }
}

fn ensure_managed_auth_plugin_enabled(
    app: &AppHandle,
    cfg: &StoredConfig,
    resolved: &ResolvedOpenClawCommand,
    provider: &str,
) -> Result<Option<String>, String> {
    let Some(plugin_id) = managed_auth_plugin_id(provider) else {
        return Ok(None);
    };

    let args = ["plugins", "enable", plugin_id];
    let (ok, output) = run_openclaw_capture(app, cfg, resolved, &args)?;
    if ok {
        return Ok(Some(plugin_id.to_string()));
    }

    if output.to_ascii_lowercase().contains("already enabled") {
        return Ok(None);
    }

    if output.trim().is_empty() {
        return Err(format!("自动启用插件 `{}` 失败。", plugin_id));
    }

    Err(format!(
        "自动启用插件 `{}` 失败：{}",
        plugin_id,
        output.trim()
    ))
}

fn auth_profiles_path_candidates(app: &AppHandle) -> Vec<PathBuf> {
    let mut candidates = Vec::new();
    if let Ok(home_dir) = openclaw_runtime_home_dir(app) {
        let home = home_dir.to_string_lossy().to_string();
        candidates.push(
            PathBuf::from(format!("{}.openclaw", home))
                .join("agents")
                .join("main")
                .join("agent")
                .join("auth-profiles.json"),
        );
        candidates.push(
            home_dir
                .join("agents")
                .join("main")
                .join("agent")
                .join("auth-profiles.json"),
        );
        candidates.push(
            home_dir
                .join(".openclaw")
                .join("agents")
                .join("main")
                .join("agent")
                .join("auth-profiles.json"),
        );
    }
    candidates
}

fn runtime_stub_config() -> StoredConfig {
    StoredConfig {
        provider: "openai".to_string(),
        model: "gpt-4.1".to_string(),
        api_key: "stub".to_string(),
        base_url: None,
        custom_api_mode: default_custom_api_mode(),
        custom_headers: BTreeMap::new(),
        skills_dirs: Vec::new(),
        openclaw_command: "openclaw".to_string(),
        channel_server_base_url: None,
        channel_device_id: None,
        updated_at: Utc::now().to_rfc3339(),
    }
}

fn looks_like_semverish(version: &str) -> bool {
    let trimmed = version.trim().trim_start_matches('v');
    if trimmed.is_empty() {
        return false;
    }
    let mut dot_count = 0usize;
    for ch in trimmed.chars() {
        if ch == '.' {
            dot_count += 1;
            continue;
        }
        if !ch.is_ascii_digit() {
            return false;
        }
    }
    dot_count >= 2
}

fn parse_latest_openclaw_version(raw: &str) -> Option<String> {
    let text = raw.trim();
    if text.is_empty() {
        return None;
    }

    if let Ok(json) = serde_json::from_str::<serde_json::Value>(text) {
        if let Some(value) = json.as_str() {
            let normalized = value.trim().trim_start_matches('v').to_string();
            if looks_like_semverish(&normalized) {
                return Some(normalized);
            }
        }
    }

    for token in text.split(|ch: char| ch.is_whitespace() || matches!(ch, '"' | '\'' | ',')) {
        let normalized = token.trim().trim_start_matches('v').to_string();
        if looks_like_semverish(&normalized) {
            return Some(normalized);
        }
    }

    None
}

fn latest_openclaw_version_from_npm() -> Result<String, String> {
    let npm = npm_command_name();
    if !is_command_available(npm) {
        return Err("npm 不可用".to_string());
    }

    let output = Command::new(npm)
        .arg("view")
        .arg("openclaw")
        .arg("version")
        .arg("--json")
        .arg("--fetch-retries")
        .arg("0")
        .arg("--fetch-timeout")
        .arg("5000")
        .output()
        .map_err(|e| format!("执行 npm view 失败: {}", e))?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
        let stdout = String::from_utf8_lossy(&output.stdout).trim().to_string();
        let detail = if !stderr.is_empty() { stderr } else { stdout };
        let message = if detail.is_empty() {
            format!("npm view openclaw version 失败 (exit code: {:?})", output.status.code())
        } else {
            detail
        };
        return Err(message);
    }

    let stdout = String::from_utf8_lossy(&output.stdout).trim().to_string();
    parse_latest_openclaw_version(&stdout)
        .ok_or_else(|| format!("无法从 npm 输出中解析版本: {}", stdout))
}

#[cfg(target_os = "windows")]
fn quote_windows_cmd_arg(arg: &str) -> String {
    if arg.is_empty()
        || arg.chars().any(|ch| {
            ch.is_whitespace() || matches!(ch, '"' | '&' | '|' | '<' | '>' | '^' | '(' | ')')
        })
    {
        format!("\"{}\"", arg.replace('"', "\"\""))
    } else {
        arg.to_string()
    }
}

#[cfg(target_os = "windows")]
fn normalize_windows_program_path(program: &str) -> String {
    let trimmed = program.trim();
    let unquoted = if trimmed.len() >= 2 && trimmed.starts_with('"') && trimmed.ends_with('"') {
        trimmed[1..trimmed.len() - 1].trim().to_string()
    } else {
        trimmed.to_string()
    };

    // Tauri/Windows may return verbatim paths (e.g. \\?\C:\...),
    // but cmd.exe cannot always execute them directly.
    if let Some(rest) = unquoted.strip_prefix(r"\\?\UNC\") {
        format!(r"\\{}", rest)
    } else if let Some(rest) = unquoted.strip_prefix(r"\\?\") {
        rest.to_string()
    } else {
        unquoted
    }
}

#[cfg(target_os = "windows")]
fn spawn_provider_auth_login_terminal(
    app: &AppHandle,
    resolved: &ResolvedOpenClawCommand,
    provider_id: &str,
) -> Result<(), String> {
    const CREATE_NEW_CONSOLE: u32 = 0x0000_0010;

    let mut command_parts: Vec<String> = Vec::new();
    let normalized_program = normalize_windows_program_path(&resolved.program);
    if normalized_program.trim().is_empty() {
        return Err("登录命令路径为空".to_string());
    }
    command_parts.push(quote_windows_cmd_arg(&normalized_program));
    for arg in &resolved.prefix_args {
        let normalized_arg = normalize_windows_program_path(arg);
        if !normalized_arg.trim().is_empty() {
            command_parts.push(quote_windows_cmd_arg(&normalized_arg));
        }
    }
    for arg in ["models", "auth", "login", "--provider", provider_id] {
        command_parts.push(quote_windows_cmd_arg(arg));
    }

    let script_content = format!(
        "@echo off\r\nsetlocal\r\n{}\r\nset \"OPENCLAW_LOGIN_EXIT=%ERRORLEVEL%\"\r\necho.\r\nif \"%OPENCLAW_LOGIN_EXIT%\"==\"0\" (\r\n  echo [OpenClaw] Login command finished. You can close this window.\r\n) else (\r\n  echo [OpenClaw] Login command failed with exit code %OPENCLAW_LOGIN_EXIT%.\r\n)\r\n",
        command_parts.join(" ")
    );
    let script_path = env::temp_dir().join(format!(
        "openclaw-auth-login-{}-{}.cmd",
        provider_id.replace(|ch: char| !ch.is_ascii_alphanumeric(), "_"),
        Utc::now().timestamp_millis()
    ));
    fs::write(&script_path, script_content)
        .map_err(|e| format!("写入登录脚本失败: {}", e))?;

    let mut cmd = Command::new("cmd.exe");
    cmd.arg("/k")
        .arg(script_path.to_string_lossy().to_string());

    if let Ok(home_dir) = openclaw_runtime_home_dir(app) {
        let home = home_dir.to_string_lossy().to_string();
        cmd.env("HOME", &home)
            .env("USERPROFILE", &home)
            .env("OPENCLAW_HOME", &home);
    }

    if let Ok(workspace_dir) = openclaw_runtime_workspace_dir(app) {
        let workspace = workspace_dir.to_string_lossy().to_string();
        cmd.current_dir(&workspace_dir)
            .env("PWD", &workspace)
            .env("OPENCLAW_WORKSPACE", &workspace);
    }

    if let Some(bin_dir) = resolve_bundled_bin_dir(app) {
        let existing = env::var("PATH").unwrap_or_default();
        let merged_path = if existing.trim().is_empty() {
            bin_dir.to_string_lossy().to_string()
        } else {
            format!(
                "{}{}{}",
                bin_dir.to_string_lossy(),
                path_delimiter(),
                existing
            )
        };
        cmd.env("PATH", merged_path);
    }

    cmd.creation_flags(CREATE_NEW_CONSOLE);
    cmd.spawn()
        .map(|_| ())
        .map_err(|e| format!("启动登录终端失败: {}", e))
}

#[cfg(not(target_os = "windows"))]
fn spawn_provider_auth_login_terminal(
    _app: &AppHandle,
    _resolved: &ResolvedOpenClawCommand,
    _provider_id: &str,
) -> Result<(), String> {
    Err("当前平台暂不支持应用内打开交互式登录终端，请手动执行登录命令。".to_string())
}

fn provider_has_auth_profile(auth_store_path: &Path, provider: &str) -> Result<bool, String> {
    let raw = fs::read_to_string(auth_store_path)
        .map_err(|e| format!("读取 auth-profiles.json 失败: {}", e))?;
    let json: serde_json::Value = serde_json::from_str(trim_utf8_bom(&raw))
        .map_err(|e| format!("auth-profiles.json 解析失败: {}", e))?;
    let Some(profiles) = json.get("profiles").and_then(|v| v.as_object()) else {
        return Ok(false);
    };

    let key_fields = [
        "key",
        "token",
        "accessToken",
        "access_token",
        "apiKey",
        "api_key",
        "refreshToken",
        "refresh_token",
    ];

    for profile in profiles.values() {
        let Some(obj) = profile.as_object() else {
            continue;
        };
        let Some(profile_provider) = obj.get("provider").and_then(|v| v.as_str()) else {
            continue;
        };
        if !profile_provider.eq_ignore_ascii_case(provider) {
            continue;
        }

        let is_oauth_profile = obj
            .get("type")
            .and_then(|v| v.as_str())
            .map(|v| v.eq_ignore_ascii_case("oauth"))
            .unwrap_or(false);
        if is_oauth_profile {
            return Ok(true);
        }

        let has_credentials = key_fields.iter().any(|field| {
            obj.get(*field)
                .and_then(|v| v.as_str())
                .map(|v| !v.trim().is_empty())
                .unwrap_or(false)
        });
        if has_credentials {
            return Ok(true);
        }
    }

    Ok(false)
}

#[tauri::command]
fn check_provider_auth(provider: String, app: AppHandle) -> Result<ActionResponse, String> {
    let provider_id = provider.trim().to_lowercase();
    if provider_id.is_empty() {
        return Ok(ActionResponse {
            ok: false,
            message: "Provider 不能为空。".to_string(),
            detail: None,
            copied_from: None,
            copied_to: None,
        });
    }

    if !is_managed_auth_provider(provider_id.as_str()) {
        return Ok(ActionResponse {
            ok: true,
            message: "当前 Provider 无需 OAuth/CLI 登录校验。".to_string(),
            detail: None,
            copied_from: None,
            copied_to: None,
        });
    }

    let login_command = format!("openclaw models auth login --provider {}", provider_id);
    let candidates = auth_profiles_path_candidates(&app);
    let existing_stores: Vec<PathBuf> = candidates
        .iter()
        .filter(|path| path.exists())
        .cloned()
        .collect();

    if existing_stores.is_empty() {
        let default_path = candidates
            .first()
            .map(|p| p.to_string_lossy().to_string())
            .unwrap_or_else(|| "<unknown>".to_string());
        return Ok(ActionResponse {
            ok: false,
            message: format!("Provider `{}` 尚未登录。", provider_id),
            detail: Some(format!(
                "请先执行：{}\nAuth store: {}",
                login_command, default_path
            )),
            copied_from: None,
            copied_to: None,
        });

    }

    let mut matched_auth_store: Option<PathBuf> = None;
    let mut check_errors: Vec<String> = Vec::new();
    for auth_store_path in &existing_stores {
        match provider_has_auth_profile(auth_store_path, provider_id.as_str()) {
            Ok(true) => {
                matched_auth_store = Some(auth_store_path.clone());
                break;
            }
            Ok(false) => {}
            Err(e) => check_errors.push(format!("{} => {}", auth_store_path.to_string_lossy(), e)),
        }
    }

    if let Some(auth_store_path) = matched_auth_store {
        return Ok(ActionResponse {
            ok: true,
            message: format!("Provider `{}` 已检测到登录凭据。", provider_id),
            detail: Some(auth_store_path.to_string_lossy().to_string()),
            copied_from: None,
            copied_to: None,
        });
    }

    let checked_paths = existing_stores
        .iter()
        .map(|path| path.to_string_lossy().to_string())
        .collect::<Vec<String>>()
        .join("\n- ");
    let mut detail = format!(
        "请先执行：{}\nChecked auth stores:\n- {}",
        login_command, checked_paths
    );
    if !check_errors.is_empty() {
        detail.push_str(&format!(
            "\n读取异常:\n- {}",
            check_errors.join("\n- ")
        ));
    }
    Ok(ActionResponse {
        ok: false,
        message: format!("Provider `{}` 尚未登录。", provider_id),
        detail: Some(detail),
        copied_from: None,
        copied_to: None,
    })
}

#[tauri::command]
fn start_provider_auth_login(provider: String, app: AppHandle) -> Result<ActionResponse, String> {
    let provider_id = provider.trim().to_lowercase();
    if provider_id.is_empty() {
        return Ok(ActionResponse {
            ok: false,
            message: "Provider 不能为空。".to_string(),
            detail: None,
            copied_from: None,
            copied_to: None,
        });
    }

    if !is_managed_auth_provider(provider_id.as_str()) {
        return Ok(ActionResponse {
            ok: false,
            message: format!("Provider `{}` 不需要 OAuth/CLI 登录。", provider_id),
            detail: None,
            copied_from: None,
            copied_to: None,
        });
    }

    let cfg = read_config(&app)?.unwrap_or_else(runtime_stub_config);
    let resolved = resolve_openclaw_command(&cfg, &app);
    let auto_enabled_plugin =
        match ensure_managed_auth_plugin_enabled(&app, &cfg, &resolved, provider_id.as_str()) {
            Ok(value) => value,
            Err(e) => {
                return Ok(ActionResponse {
                    ok: false,
                    message: "启用 Provider 登录插件失败。".to_string(),
                    detail: Some(e),
                    copied_from: None,
                    copied_to: None,
                });
            }
        };
    let login_command = format!("openclaw models auth login --provider {}", provider_id);
    match spawn_provider_auth_login_terminal(&app, &resolved, provider_id.as_str()) {
        Ok(()) => Ok(ActionResponse {
            ok: true,
            message: "已在新终端打开提供商登录流程，请在终端完成登录后返回应用继续。".to_string(),
            detail: Some({
                let mut detail = format!(
                    "命令来源: {}\n执行路径: {}\n登录命令: {}",
                    resolved.source, resolved.display_path, login_command
                );
                if let Some(plugin_id) = auto_enabled_plugin {
                    detail.push_str(&format!("\n已自动启用插件: {}", plugin_id));
                }
                detail
            }),
            copied_from: None,
            copied_to: None,
        }),
        Err(e) => Ok(ActionResponse {
            ok: false,
            message: "启动提供商登录流程失败。".to_string(),
            detail: Some(format!("{}\n请手动执行: {}", e, login_command)),
            copied_from: None,
            copied_to: None,
        }),
    }
}

fn path_delimiter() -> &'static str {
    if cfg!(target_os = "windows") {
        ";"
    } else {
        ":"
    }
}

fn is_private_ipv4(ip: Ipv4Addr) -> bool {
    let octets = ip.octets();
    matches!(octets, [10, _, _, _] | [192, 168, _, _])
        || (octets[0] == 172 && (16..=31).contains(&octets[1]))
        || (octets[0] == 100 && (64..=127).contains(&octets[1]))
}

fn detect_primary_lan_ipv4() -> Option<Ipv4Addr> {
    let socket = UdpSocket::bind("0.0.0.0:0").ok()?;
    socket.connect("1.1.1.1:80").ok()?;
    let local = socket.local_addr().ok()?;

    match local.ip() {
        IpAddr::V4(ip) if !ip.is_loopback() && !ip.is_unspecified() => Some(ip),
        _ => None,
    }
}

#[tauri::command]
fn get_primary_lan_ipv4() -> Result<String, String> {
    let detected = detect_primary_lan_ipv4();
    if let Some(ip) = detected {
        if is_private_ipv4(ip) {
            return Ok(ip.to_string());
        }
        return Ok(ip.to_string());
    }

    Ok(String::new())
}

fn provider_api_key_env_var(provider: &str) -> Option<&'static str> {
    match provider {
        "openai" => Some("OPENAI_API_KEY"),
        "anthropic" => Some("ANTHROPIC_API_KEY"),
        "google" => Some("GEMINI_API_KEY"),
        "zai" => Some("ZAI_API_KEY"),
        "openrouter" => Some("OPENROUTER_API_KEY"),
        "xai" => Some("XAI_API_KEY"),
        "mistral" => Some("MISTRAL_API_KEY"),
        "groq" => Some("GROQ_API_KEY"),
        "cerebras" => Some("CEREBRAS_API_KEY"),
        "huggingface" => Some("HUGGINGFACE_HUB_TOKEN"),
        "github-copilot" => Some("COPILOT_GITHUB_TOKEN"),
        "vercel-ai-gateway" => Some("AI_GATEWAY_API_KEY"),
        "kilocode" => Some("KILOCODE_API_KEY"),
        "moonshot" => Some("MOONSHOT_API_KEY"),
        "kimi-coding" | "kimi-code" => Some("KIMI_API_KEY"),
        "together" => Some("TOGETHER_API_KEY"),
        "nvidia" => Some("NVIDIA_API_KEY"),
        "qianfan" => Some("QIANFAN_API_KEY"),
        "modelstudio" => Some("MODELSTUDIO_API_KEY"),
        "minimax" | "minimax-cn" => Some("MINIMAX_API_KEY"),
        "xiaomi" => Some("XIAOMI_API_KEY"),
        "synthetic" => Some("SYNTHETIC_API_KEY"),
        "venice" => Some("VENICE_API_KEY"),
        "volcengine" | "volcengine-plan" => Some("VOLCANO_ENGINE_API_KEY"),
        "byteplus" | "byteplus-plan" => Some("BYTEPLUS_API_KEY"),
        "litellm" => Some("LITELLM_API_KEY"),
        "cloudflare-ai-gateway" => Some("CLOUDFLARE_AI_GATEWAY_API_KEY"),
        "ollama" => Some("OLLAMA_API_KEY"),
        "vllm" => Some("VLLM_API_KEY"),
        _ => None,
    }
}

fn is_anthropic_compatible_provider(provider: &str) -> bool {
    matches!(
        provider,
        "anthropic"
            | "minimax"
            | "minimax-cn"
            | "xiaomi"
            | "synthetic"
            | "kimi-coding"
            | "cloudflare-ai-gateway"
    )
}

fn apply_provider_env(
    cmd: &mut Command,
    provider_raw: &str,
    api_key: &str,
    base_url: Option<&str>,
) {
    let provider = provider_raw.trim().to_lowercase();

    if !api_key.is_empty() {
        if let Some(env_var) = provider_api_key_env_var(provider.as_str()) {
            cmd.env(env_var, api_key);
        } else if provider == "custom" {
            // Custom provider defaults to OpenAI-compatible auth semantics.
            cmd.env("OPENAI_API_KEY", api_key);
        }
    }

    if let Some(url) = base_url.filter(|v| !v.is_empty()) {
        cmd.env("OPENCLAW_BASE_URL", url);
        if provider == "custom" || is_anthropic_compatible_provider(provider.as_str()) {
            cmd.env("ANTHROPIC_BASE_URL", url);
        }
        if provider == "custom" || !is_anthropic_compatible_provider(provider.as_str()) {
            cmd.env("OPENAI_BASE_URL", url);
        }
    }
}

fn main() {
    tauri::Builder::default()
        .setup(|app| {
            if let Err(e) = migrate_legacy_app_data_if_needed(&app.handle()) {
                eprintln!("legacy app data migration skipped: {}", e);
            }
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            get_state,
            read_raw_config,
            get_config_path,
            get_kernel_status,
            get_kernel_version_meta,
            install_or_update_kernel,
            get_dashboard_url,
            save_config,
            fetch_models,
            install_default_skills,
            run_doctor,
            check_provider_auth,
            start_provider_auth_login,
            get_primary_lan_ipv4
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
