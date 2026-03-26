use super::*;

pub(crate) fn runtime_resources_dir() -> Option<PathBuf> {
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

pub(crate) fn app_config_dir(app: &AppHandle) -> Result<PathBuf, String> {
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

pub(crate) fn migrate_legacy_app_data_if_needed(app: &AppHandle) -> Result<(), String> {
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

pub(crate) fn managed_kernel_root(app: &AppHandle) -> Result<PathBuf, String> {
    let root = app_config_dir(app)?.join(MANAGED_KERNEL_DIR_NAME);
    fs::create_dir_all(&root).map_err(|e| format!("创建内核目录失败: {}", e))?;
    Ok(root)
}

pub(crate) fn openclaw_runtime_home_dir(app: &AppHandle) -> Result<PathBuf, String> {
    let dir = app_config_dir(app)?.join(OPENCLAW_RUNTIME_HOME_DIR_NAME);
    fs::create_dir_all(&dir).map_err(|e| format!("创建 OpenClaw 运行时目录失败: {}", e))?;
    Ok(dir)
}

pub(crate) fn openclaw_runtime_workspace_dir(app: &AppHandle) -> Result<PathBuf, String> {
    let dir = app_config_dir(app)?.join(OPENCLAW_RUNTIME_WORKSPACE_DIR_NAME);
    fs::create_dir_all(&dir).map_err(|e| format!("创建 OpenClaw 工作区目录失败: {}", e))?;
    Ok(dir)
}

pub(crate) fn openclaw_runtime_extensions_dir(app: &AppHandle) -> Result<PathBuf, String> {
    let dir = openclaw_runtime_home_dir(app)?
        .join(".openclaw")
        .join("extensions");
    fs::create_dir_all(&dir).map_err(|e| format!("创建 OpenClaw 扩展目录失败: {}", e))?;
    Ok(dir)
}

pub(crate) fn gateway_runtime_fingerprint_path(app: &AppHandle) -> Result<PathBuf, String> {
    Ok(app_config_dir(app)?.join(GATEWAY_RUNTIME_FINGERPRINT_FILE_NAME))
}

pub(crate) fn dashboard_prep_fingerprint_path(app: &AppHandle) -> Result<PathBuf, String> {
    Ok(app_config_dir(app)?.join(DASHBOARD_PREP_FINGERPRINT_FILE_NAME))
}
