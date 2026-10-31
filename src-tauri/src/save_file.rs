//! Сохранение текстового файла (выгрузки CSV из «Сообщества») по пути из системного диалога «Сохранить как».
//! Окно WebView молча игнорирует скачивание через ссылку, поэтому путь спрашивает `plugin-dialog`, а пишет
//! эта команда. Только текстовые форматы — чтобы командой нельзя было подменить исполняемый файл.

const ALLOWED: [&str; 4] = ["csv", "json", "txt", "tsv"];

#[tauri::command]
pub fn save_text_file(path: String, text: String) -> Result<(), String> {
    let ext = std::path::Path::new(&path)
        .extension()
        .and_then(|e| e.to_str())
        .map(|e| e.to_ascii_lowercase())
        .unwrap_or_default();
    if !ALLOWED.contains(&ext.as_str()) {
        return Err(format!("unsupported file type: .{ext}"));
    }
    std::fs::write(&path, text).map_err(|e| e.to_string())
}
