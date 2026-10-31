#[cfg(desktop)]
mod captcha;
mod downloads;
mod ota;
#[cfg(desktop)]
mod window_controls;

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
        window_controls::window_control,
        ota::ota_status,
        ota::ota_check,
        ota::ota_download,
        ota::ota_apply,
        ota::ota_reset,
        ota::ota_native_download,
        ota::ota_native_run,
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
        ota::ota_status,
        ota::ota_check,
        ota::ota_download,
        ota::ota_apply,
        ota::ota_reset,
        ota::ota_native_download,
    ]);
    // Интерфейс — вшитый или скачанный обновлением (ota.rs). Главное окно создаётся здесь, а не из
    // конфига: конфиговые окна открываются раньше, чем OtaAssets узнаёт папку скачанной версии.
    let mut context = tauri::generate_context!();
    let embedded = context.set_assets(Box::new(ota::NoAssets));
    context.set_assets(Box::new(ota::OtaAssets { embedded }));
    let builder = builder.setup(|app| {
        if let Some(cfg) = app.config().app.windows.iter().find(|w| w.label == "main").cloned() {
            tauri::WebviewWindowBuilder::from_config(app.handle(), &cfg)?.build()?;
        }
        Ok(())
    });
    builder
        .run(context)
        .expect("error while running tauri application");
}
