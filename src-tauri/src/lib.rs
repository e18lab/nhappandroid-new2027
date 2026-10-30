#[cfg(desktop)]
mod captcha;
mod downloads;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let builder = tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_http::init())
        // Выбор папки для загрузок на ПК (SavePathRow)
        .plugin(tauri_plugin_dialog::init());
    // На Android капча — нативный диалог (CaptchaDialog.kt), на ПК — отдельное окно
    #[cfg(desktop)]
    let builder = builder.invoke_handler(tauri::generate_handler![
        captcha::open_captcha,
        downloads::downloads_dir,
        downloads::list_downloads,
        downloads::read_download,
        downloads::delete_download,
        downloads::download_book,
        downloads::cancel_download,
    ]);
    #[cfg(mobile)]
    let builder = builder.invoke_handler(tauri::generate_handler![
        downloads::downloads_dir,
        downloads::list_downloads,
        downloads::read_download,
        downloads::delete_download,
        downloads::download_book,
        downloads::cancel_download,
    ]);
    builder
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
