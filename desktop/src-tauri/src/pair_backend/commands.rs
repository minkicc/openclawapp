use super::*;

#[tauri::command]
pub async fn pair_backend_get_state(
    app: AppHandle,
    backend: State<'_, PairBackendHandle>,
) -> Result<PairBackendSnapshot, String> {
    backend.set_app_handle(app).await;
    Ok(backend.snapshot().await)
}

#[tauri::command]
pub async fn pair_backend_reload_config(
    app: AppHandle,
    backend: State<'_, PairBackendHandle>,
) -> Result<PairBackendSnapshot, String> {
    backend.reload_from_app_config(app).await
}

#[tauri::command]
pub async fn pair_backend_toggle_channel(
    app: AppHandle,
    backend: State<'_, PairBackendHandle>,
    open: bool,
) -> Result<PairBackendSnapshot, String> {
    backend.set_app_handle(app.clone()).await;
    if open {
        backend.set_channel_open_state(true, true).await;
        backend.connect(app, false).await?;
    } else {
        backend.disconnect().await;
    }
    Ok(backend.snapshot().await)
}

#[tauri::command]
pub async fn pair_backend_create_channel(
    app: AppHandle,
    backend: State<'_, PairBackendHandle>,
) -> Result<PairBackendSnapshot, String> {
    backend.set_app_handle(app.clone()).await;
    backend.create_session(&app).await
}

#[tauri::command]
pub async fn pair_backend_approve_channel(
    app: AppHandle,
    backend: State<'_, PairBackendHandle>,
    channel_id: String,
) -> Result<PairBackendSnapshot, String> {
    backend.set_app_handle(app.clone()).await;
    backend.approve_channel(&app, &channel_id).await
}

#[tauri::command]
pub async fn pair_backend_delete_channel(
    app: AppHandle,
    backend: State<'_, PairBackendHandle>,
    channel_id: String,
) -> Result<PairBackendSnapshot, String> {
    backend.set_app_handle(app.clone()).await;
    backend.revoke_channel(&app, &channel_id).await
}

#[tauri::command]
pub async fn pair_backend_send_chat(
    app: AppHandle,
    backend: State<'_, PairBackendHandle>,
    channel_id: String,
    text: String,
) -> Result<PairBackendSnapshot, String> {
    backend.set_app_handle(app).await;
    backend.send_chat_to_peer(&channel_id, text.trim()).await
}
