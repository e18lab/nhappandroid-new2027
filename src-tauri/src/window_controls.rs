//! Кнопки окна без системной рамки (заголовок окна ПК-версии): свернуть, развернуть/восстановить, закрыть.
//! Своей командой, а не через JS API окна — не зависит от разрешений `core:window:*` в capabilities.

#[tauri::command]
pub fn window_control(window: tauri::WebviewWindow, action: String) -> Result<(), String> {
    let result = match action.as_str() {
        "minimize" => window.minimize(),
        "toggleMaximize" => {
            if window.is_maximized().unwrap_or(false) {
                window.unmaximize()
            } else {
                window.maximize()
            }
        }
        "close" => window.close(),
        other => return Err(format!("unknown action: {other}")),
    };
    result.map_err(|e| e.to_string())
}
