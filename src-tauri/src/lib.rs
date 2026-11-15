#[cfg(desktop)]
mod captcha;
mod downloads;
mod ota;
#[cfg(desktop)]
mod save_file;
#[cfg(desktop)]
mod window_controls;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let builder = tauri::Builder::default();
    // ПК: одно окно приложения. Повторный запуск (в том числе браузером по ссылке moelibre://
    // после входа в MoeLibre ID) не открывает второе окно — ссылку получает уже открытое (deep-link)
    #[cfg(desktop)]
    let builder = builder.plugin(tauri_plugin_single_instance::init(|app, _argv, _cwd| {
        use tauri::Manager;
        if let Some(w) = app.get_webview_window("main") {
            let _ = w.unminimize();
            let _ = w.show();
            let _ = w.set_focus();
        }
    }));
    let builder = builder
        // Возврат в приложение по ссылке moelibre://auth/callback (вход в MoeLibre ID через браузер)
        .plugin(tauri_plugin_deep_link::init())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_http::init())
        // Выбор папки для загрузок на ПК (SavePathRow) и «Сохранить как» для выгрузок (save_file.rs)
        .plugin(tauri_plugin_dialog::init());
    // На Android капча — нативный диалог (CaptchaDialog.kt), на ПК — отдельное окно
    #[cfg(desktop)]
    let builder = builder.invoke_handler(tauri::generate_handler![
        captcha::open_captcha,
        window_controls::window_control,
        save_file::save_text_file,
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
        // Схема moelibre:// в системе: установщик прописывает её сам, здесь — для запуска без установки (dev)
        #[cfg(any(windows, target_os = "linux"))]
        {
            use tauri_plugin_deep_link::DeepLinkExt;
            let _ = app.deep_link().register_all();
        }
        if let Some(cfg) = app.config().app.windows.iter().find(|w| w.label == "main").cloned() {
            tauri::WebviewWindowBuilder::from_config(app.handle(), &cfg)?.build()?;
        }
        Ok(())
    });
    builder
        .run(context)
        .expect("error while running tauri application");
}
