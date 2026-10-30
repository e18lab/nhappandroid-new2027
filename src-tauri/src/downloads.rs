//! Скачанные книги — замена `expo-file-system` (Android) и IPC Electron (ПК) из старого приложения.
//!
//! Раскладка как в 1.3.1, чтобы старые загрузки открывались без переноса:
//! `<корень>/NHAppAndroid/<id>_<название>/<язык>/Image001.jpg …` + `metadata.json` (книга целиком).
//! Корень: Android — `files` внутри данных приложения (`FileSystem.documentDirectory` старого,
//! пакет и подпись те же, так что загрузки 1.3.1 уже там); ПК — выбранная папка или `Pictures/NHAppSaves`.
//!
//! Картинки качает Rust (без CORS и без передачи байтов через IPC), прогресс — событием `nh-download`.
//! Странице файлы отдаются через протокол asset: папка загрузок добавляется в его разрешения.

use serde::Serialize;
use std::{
    collections::HashSet,
    fs,
    path::{Path, PathBuf},
    sync::{Mutex, OnceLock},
    time::{Duration, UNIX_EPOCH},
};
use tauri::{AppHandle, Emitter, Manager};
use tauri_plugin_http::reqwest;

const DIR_NAME: &str = "NHAppAndroid";
const META: &str = "metadata.json";
const USER_AGENT: &str =
    "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Mobile Safari/537.36";

fn cancelled() -> &'static Mutex<HashSet<u64>> {
    static SET: OnceLock<Mutex<HashSet<u64>>> = OnceLock::new();
    SET.get_or_init(|| Mutex::new(HashSet::new()))
}

/// Папка `NHAppAndroid`; заодно открывает её для протокола asset.
fn library_dir(app: &AppHandle, custom: Option<&str>) -> Result<PathBuf, String> {
    let base = match custom.map(str::trim).filter(|s| !s.is_empty()) {
        Some(path) => PathBuf::from(path),
        None => default_base(app)?,
    };
    let dir = base.join(DIR_NAME);
    let _ = app.asset_protocol_scope().allow_directory(&dir, true);
    Ok(dir)
}

#[cfg(mobile)]
fn default_base(app: &AppHandle) -> Result<PathBuf, String> {
    Ok(app.path().data_dir().map_err(|e| e.to_string())?.join("files"))
}

#[cfg(desktop)]
fn default_base(app: &AppHandle) -> Result<PathBuf, String> {
    Ok(app.path().picture_dir().map_err(|e| e.to_string())?.join("NHAppSaves"))
}

/// Как `sanitize` в старом: всё, кроме латиницы, цифр, `_` и `-`, — в `_`.
fn sanitize(s: &str) -> String {
    let mut out = String::with_capacity(s.len());
    let mut prev_bad = false;
    for c in s.chars() {
        if c.is_ascii_alphanumeric() || c == '_' || c == '-' {
            out.push(c);
            prev_bad = false;
        } else if !prev_bad {
            out.push('_');
            prev_bad = true;
        }
    }
    out
}

fn image_number(name: &str) -> u32 {
    name.chars().filter(|c| c.is_ascii_digit()).collect::<String>().parse().unwrap_or(0)
}

fn is_image(name: &str) -> bool {
    name.starts_with("Image")
}

fn modified_ms(path: &Path) -> u64 {
    fs::metadata(path)
        .and_then(|m| m.modified())
        .ok()
        .and_then(|t| t.duration_since(UNIX_EPOCH).ok())
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0)
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LocalBook {
    id: u64,
    /// Папка языка (`…/<id>_<название>/<язык>`).
    dir: String,
    /// Сырой `metadata.json`.
    meta: String,
    /// Файлы страниц по порядку (полные пути).
    images: Vec<String>,
    /// Когда скачана (время изменения metadata.json), мс.
    downloaded_at: u64,
}

/// Все книги в папке; `with_images = false` — только первая страница (для списка).
fn scan(lib: &Path, only_id: Option<u64>, with_images: bool) -> Vec<LocalBook> {
    let mut out = Vec::new();
    let Ok(titles) = fs::read_dir(lib) else { return out };
    for title in titles.flatten() {
        let title_path = title.path();
        if !title_path.is_dir() {
            continue;
        }
        let name = title.file_name().to_string_lossy().into_owned();
        let title_id = name.split('_').next().and_then(|s| s.parse::<u64>().ok());
        if let (Some(want), Some(have)) = (only_id, title_id) {
            if want != have {
                continue;
            }
        }
        let Ok(langs) = fs::read_dir(&title_path) else { continue };
        for lang in langs.flatten() {
            let dir = lang.path();
            let meta_path = dir.join(META);
            let Ok(meta) = fs::read_to_string(&meta_path) else { continue };
            let Some(id) = serde_json::from_str::<serde_json::Value>(&meta)
                .ok()
                .and_then(|v| v.get("id").and_then(|x| x.as_u64()))
            else {
                continue;
            };
            if title_id.is_some_and(|t| t != id) || only_id.is_some_and(|w| w != id) {
                continue;
            }
            let mut images: Vec<String> = fs::read_dir(&dir)
                .map(|it| {
                    it.flatten()
                        .map(|f| f.file_name().to_string_lossy().into_owned())
                        .filter(|f| is_image(f))
                        .collect()
                })
                .unwrap_or_default();
            if images.is_empty() {
                continue;
            }
            images.sort_by_key(|f| image_number(f));
            if !with_images {
                images.truncate(1);
            }
            out.push(LocalBook {
                id,
                dir: dir.to_string_lossy().into_owned(),
                meta,
                images: images.iter().map(|f| dir.join(f).to_string_lossy().into_owned()).collect(),
                downloaded_at: modified_ms(&meta_path),
            });
        }
    }
    out
}

/// Путь папки загрузок (для настроек).
#[tauri::command]
pub fn downloads_dir(app: AppHandle, custom: Option<String>) -> Result<String, String> {
    Ok(library_dir(&app, custom.as_deref())?.to_string_lossy().into_owned())
}

/// Список скачанных книг (по одной на id, новые первыми).
#[tauri::command]
pub async fn list_downloads(app: AppHandle, custom: Option<String>) -> Result<Vec<LocalBook>, String> {
    let lib = library_dir(&app, custom.as_deref())?;
    let mut books = tauri::async_runtime::spawn_blocking(move || scan(&lib, None, false))
        .await
        .map_err(|e| e.to_string())?;
    books.sort_by(|a, b| b.downloaded_at.cmp(&a.downloaded_at));
    let mut seen = HashSet::new();
    books.retain(|b| seen.insert(b.id));
    Ok(books)
}

/// Одна скачанная книга со всеми страницами или null.
#[tauri::command]
pub async fn read_download(app: AppHandle, custom: Option<String>, id: u64) -> Result<Option<LocalBook>, String> {
    let lib = library_dir(&app, custom.as_deref())?;
    tauri::async_runtime::spawn_blocking(move || scan(&lib, Some(id), true).into_iter().next())
        .await
        .map_err(|e| e.to_string())
}

/// Удалить все папки книги (как старое: удаляется папка `<id>_<название>` целиком).
#[tauri::command]
pub async fn delete_download(app: AppHandle, custom: Option<String>, id: u64) -> Result<bool, String> {
    let lib = library_dir(&app, custom.as_deref())?;
    tauri::async_runtime::spawn_blocking(move || {
        let mut removed = false;
        for book in scan(&lib, Some(id), false) {
            if let Some(title_dir) = Path::new(&book.dir).parent() {
                removed |= fs::remove_dir_all(title_dir).is_ok();
            }
        }
        removed
    })
    .await
    .map_err(|e| e.to_string())
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct Progress {
    id: u64,
    done: usize,
    total: usize,
}

async fn fetch_page(client: &reqwest::Client, sources: &[String]) -> Result<(Vec<u8>, String), String> {
    let mut last = String::from("no sources");
    for url in sources {
        for attempt in 0..3 {
            match client.get(url).send().await {
                Ok(resp) if resp.status().is_success() => match resp.bytes().await {
                    Ok(bytes) if !bytes.is_empty() => return Ok((bytes.to_vec(), url.clone())),
                    Ok(_) => last = format!("{url}: empty"),
                    Err(e) => last = format!("{url}: {e}"),
                },
                // 404 — пробуем следующее зеркало/расширение сразу
                Ok(resp) if resp.status().as_u16() == 404 => {
                    last = format!("{url}: 404");
                    break;
                }
                Ok(resp) => last = format!("{url}: HTTP {}", resp.status()),
                Err(e) => last = format!("{url}: {e}"),
            }
            tokio_sleep(Duration::from_millis(400 * (attempt + 1))).await;
        }
    }
    Err(last)
}

async fn tokio_sleep(d: Duration) {
    let _ = tauri::async_runtime::spawn_blocking(move || std::thread::sleep(d)).await;
}

fn extension_of(url: &str) -> String {
    let path = url.split(['?', '#']).next().unwrap_or(url);
    let file = path.rsplit('/').next().unwrap_or(path);
    // `1.jpg.webp` → `webp`, `1.jpg` → `jpg`
    file.rsplit('.').next().filter(|e| !e.is_empty() && e.len() <= 5).unwrap_or("jpg").to_lowercase()
}

/// Скачать книгу: `pages` — для каждой страницы список адресов (зеркала / расширения) по порядку,
/// `meta` — готовый `metadata.json`. Уже скачанные страницы пропускаются (докачка).
/// Возвращает папку книги; отмена — ошибка "cancelled".
#[tauri::command]
pub async fn download_book(
    app: AppHandle,
    custom: Option<String>,
    id: u64,
    title: String,
    lang: String,
    pages: Vec<Vec<String>>,
    meta: String,
) -> Result<String, String> {
    let lib = library_dir(&app, custom.as_deref())?;
    let dir = lib.join(format!("{id}_{}", sanitize(&title))).join(sanitize(&lang));
    fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    cancelled().lock().unwrap().remove(&id);

    let client = reqwest::Client::builder()
        .user_agent(USER_AGENT)
        .timeout(Duration::from_secs(40))
        .build()
        .map_err(|e| e.to_string())?;

    let total = pages.len();
    let existing: Vec<String> = fs::read_dir(&dir)
        .map(|it| it.flatten().map(|f| f.file_name().to_string_lossy().into_owned()).collect())
        .unwrap_or_default();

    for (i, sources) in pages.iter().enumerate() {
        if cancelled().lock().unwrap().remove(&id) {
            return Err("cancelled".into());
        }
        let prefix = format!("Image{:03}.", i + 1);
        if !existing.iter().any(|f| f.starts_with(&prefix)) {
            let (bytes, url) = fetch_page(&client, sources).await?;
            let file = dir.join(format!("{prefix}{}", extension_of(&url)));
            // Временное имя не начинается с `Image`, чтобы недокачанная страница не считалась готовой
            let tmp = dir.join(format!("partial_{prefix}tmp"));
            fs::write(&tmp, &bytes).map_err(|e| e.to_string())?;
            fs::rename(&tmp, &file).map_err(|e| e.to_string())?;
        }
        let _ = app.emit("nh-download", Progress { id, done: i + 1, total });
    }

    fs::write(dir.join(META), meta).map_err(|e| e.to_string())?;
    Ok(dir.to_string_lossy().into_owned())
}

/// Остановить загрузку книги (после текущей страницы).
#[tauri::command]
pub fn cancel_download(id: u64) {
    cancelled().lock().unwrap().insert(id);
}
