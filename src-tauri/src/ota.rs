//! Обновления интерфейса «по воздуху» (без нового APK / установщика) — по образцу обновлятора maistep.
//!
//! Интерфейс (собранный `dist/`) приложение отдаёт не только из вшитых файлов, но и из папки
//! `<данные приложения>/ota/current/`: если там лежит проверенная версия новее вшитой, страница
//! грузится оттуда (`OtaAssets`), чего нет на диске — из вшитых.
//!
//! Сервер обновлений — любая статическая раздача без вложенных папок (по умолчанию — последний релиз
//! GitHub, `npm run ota:release`; для проверки — свой компьютер, `npm run ota:serve`): `manifest.json`
//! (версия, `nativeApi`, sha256 и размер каждого файла), `manifest.sig` (подпись ed25519 манифеста,
//! ключ — `ota-public.key`) и сами файлы рядом: `<sha256>` или, если в манифесте задано, `name`.
//! Скачиваются только файлы, которых у приложения нет (сверка по sha256), — правка интерфейса весит
//! килобайты. Всё складывается в `ota/staging/`, уже скачанное повторно не качается; применение —
//! перестановка папки и перезагрузка страницы (или следующий запуск).
//!
//! Нативная часть (Rust, Kotlin, плагины) так не обновляется: у манифеста `nativeApi` — какая
//! нативная часть нужна интерфейсу; если у приложения она старее (`NATIVE_API`), нужна полная установка.
//! Её приложение тоже ставит само: в манифесте `native` — версия и sha256 APK / установщика Windows;
//! `ota_native_download` качает файл своей системы в кэш и проверяет хеш, дальше Android открывает
//! системную установку APK (мост `NHAppNative.installApk`), Windows — `ota_native_run`: установщик
//! в тихом режиме с перезапуском приложения.

use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::{
    borrow::Cow,
    collections::BTreeMap,
    fs,
    path::{Path, PathBuf},
    sync::{OnceLock, RwLock},
    time::Duration,
};
use tauri::{App, AppHandle, Assets, Emitter, Manager, Runtime, utils::assets::{AssetKey, AssetsIter, CspHash}};
use tauri_plugin_http::reqwest;

/// Версия нативной части для интерфейса: поднимать, когда меняются команды Rust, плагины или Kotlin,
/// которыми пользуется интерфейс. `scripts/ota-pack.mjs` берёт число отсюда.
pub const NATIVE_API: u32 = 2;

/// Открытый ключ подписи манифеста (base64, 32 байта) — `npm run ota:keygen`.
const PUBLIC_KEY: &str = include_str!("../ota-public.key");

const CURRENT: &str = "current";
const STAGING: &str = "staging";
const READY: &str = ".ready";
const MANIFEST: &str = "manifest.json";

#[derive(Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
struct Manifest {
    version: String,
    native_api: u32,
    files: BTreeMap<String, FileEntry>,
    /// Полная сборка приложения (если выложена).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    native: Option<NativeRelease>,
}

#[derive(Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
struct NativeRelease {
    version: String,
    #[serde(default)]
    android: Option<FileEntry>,
    #[serde(default)]
    windows: Option<FileEntry>,
}

impl NativeRelease {
    /// Файл для этой системы.
    fn for_this_os(&self) -> Option<&FileEntry> {
        if cfg!(target_os = "android") {
            self.android.as_ref()
        } else if cfg!(target_os = "windows") {
            self.windows.as_ref()
        } else {
            None
        }
    }
}

#[derive(Serialize, Deserialize, Clone)]
struct FileEntry {
    sha256: String,
    size: u64,
    /// Имя файла на сервере (APK, установщик); без него — sha256.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    name: Option<String>,
}

impl FileEntry {
    fn url(&self, base: &str) -> String {
        join_url(base, self.name.as_deref().unwrap_or(&self.sha256))
    }
}

fn root() -> &'static OnceLock<PathBuf> {
    static ROOT: OnceLock<PathBuf> = OnceLock::new();
    &ROOT
}

/// Папка, из которой сейчас отдаётся интерфейс (None — вшитый).
fn active() -> &'static RwLock<Option<PathBuf>> {
    static ACTIVE: RwLock<Option<PathBuf>> = RwLock::new(None);
    &ACTIVE
}

/// «1.4.10» > «1.4.9».
fn version_newer(a: &str, b: &str) -> bool {
    let parse = |s: &str| s.split(['.', '-', '+']).map(|p| p.parse::<u64>().unwrap_or(0)).collect::<Vec<_>>();
    parse(a) > parse(b)
}

fn read_manifest(dir: &Path) -> Option<Manifest> {
    serde_json::from_slice(&fs::read(dir.join(MANIFEST)).ok()?).ok()
}

/// Скачанная версия годится: нативная часть подходит и она новее вшитой.
fn usable(m: &Manifest, embedded_version: &str) -> bool {
    m.native_api <= NATIVE_API && version_newer(&m.version, embedded_version)
}

/// Готовую скачанную версию — на место текущей.
fn promote_staging(root: &Path) -> Result<(), String> {
    let staging = root.join(STAGING);
    if !staging.join(READY).exists() {
        return Err("nothing to apply".into());
    }
    let current = root.join(CURRENT);
    let old = root.join("old");
    let _ = fs::remove_dir_all(&old);
    if current.exists() {
        fs::rename(&current, &old).map_err(|e| e.to_string())?;
    }
    fs::rename(&staging, &current).map_err(|e| e.to_string())?;
    let _ = fs::remove_file(current.join(READY));
    let _ = fs::remove_dir_all(&old);
    Ok(())
}

fn init<R: Runtime>(app: &App<R>) {
    let Ok(data) = app.path().app_data_dir() else { return };
    let root_dir = data.join("ota");
    let _ = root().set(root_dir.clone());
    let _ = promote_staging(&root_dir);
    let current = root_dir.join(CURRENT);
    let embedded = app.package_info().version.to_string();
    match read_manifest(&current) {
        Some(m) if usable(&m, &embedded) => *active().write().unwrap() = Some(current),
        // Установили APK / exe новее скачанного — скачанное больше не нужно
        Some(_) => {
            let _ = fs::remove_dir_all(&current);
        }
        None => {}
    }
}

/// Интерфейс: с диска (`ota/current`), если там есть файл, иначе вшитый.
pub struct OtaAssets<R: Runtime> {
    pub embedded: Box<dyn Assets<R>>,
}

impl<R: Runtime> Assets<R> for OtaAssets<R> {
    fn setup(&self, app: &App<R>) {
        self.embedded.setup(app);
        init(app);
    }

    fn get(&self, key: &AssetKey) -> Option<Cow<'_, [u8]>> {
        let rel = key.as_ref().trim_start_matches('/');
        if !rel.split('/').any(|p| p == "..") {
            if let Some(dir) = active().read().unwrap().as_ref() {
                if let Ok(bytes) = fs::read(dir.join(rel)) {
                    return Some(Cow::Owned(bytes));
                }
            }
        }
        self.embedded.get(key)
    }

    fn iter(&self) -> Box<AssetsIter<'_>> {
        self.embedded.iter()
    }

    fn csp_hashes(&self, html_path: &AssetKey) -> Box<dyn Iterator<Item = CspHash<'_>> + '_> {
        self.embedded.csp_hashes(html_path)
    }
}

/// Заглушка на время подмены вшитых файлов (`Context::set_assets` отдаёт прежние только в обмен).
pub struct NoAssets;

impl<R: Runtime> Assets<R> for NoAssets {
    fn get(&self, _key: &AssetKey) -> Option<Cow<'_, [u8]>> {
        None
    }
    fn iter(&self) -> Box<AssetsIter<'_>> {
        Box::new(std::iter::empty())
    }
    fn csp_hashes(&self, _html_path: &AssetKey) -> Box<dyn Iterator<Item = CspHash<'_>> + '_> {
        Box::new(std::iter::empty())
    }
}

// ─── Сеть и проверка ───────────────────────────────────────────────────────────

fn client() -> Result<reqwest::Client, String> {
    reqwest::Client::builder()
        .timeout(Duration::from_secs(60))
        .build()
        .map_err(|e| e.to_string())
}

fn join_url(base: &str, path: &str) -> String {
    format!("{}/{}", base.trim_end_matches('/'), path)
}

async fn get_bytes(client: &reqwest::Client, url: &str) -> Result<Vec<u8>, String> {
    let res = client.get(url).send().await.map_err(|e| e.to_string())?;
    if !res.status().is_success() {
        return Err(format!("HTTP {} — {url}", res.status()));
    }
    Ok(res.bytes().await.map_err(|e| e.to_string())?.to_vec())
}

fn sha256_hex(bytes: &[u8]) -> String {
    Sha256::digest(bytes).iter().map(|b| format!("{b:02x}")).collect()
}

/// Манифест с сервера — только с верной подписью.
async fn fetch_manifest(client: &reqwest::Client, base: &str) -> Result<Manifest, String> {
    use base64::Engine;
    use ed25519_dalek::{Signature, VerifyingKey};
    let b64 = base64::engine::general_purpose::STANDARD;

    let key: [u8; 32] = b64
        .decode(PUBLIC_KEY.trim())
        .ok()
        .and_then(|k| k.try_into().ok())
        .ok_or("no OTA public key in this build")?;
    let key = VerifyingKey::from_bytes(&key).map_err(|e| e.to_string())?;

    let body = get_bytes(client, &join_url(base, MANIFEST)).await?;
    let sig = get_bytes(client, &join_url(base, "manifest.sig")).await?;
    let sig: [u8; 64] = b64
        .decode(String::from_utf8_lossy(&sig).trim())
        .ok()
        .and_then(|s| s.try_into().ok())
        .ok_or("bad signature file")?;
    key.verify_strict(&body, &Signature::from_bytes(&sig)).map_err(|_| "manifest signature mismatch")?;
    serde_json::from_slice(&body).map_err(|e| e.to_string())
}

/// Байты, которые приложение отдаёт по этому пути сейчас (скачанные или вшитые).
fn served<R: Runtime>(app: &AppHandle<R>, path: &str) -> Option<Vec<u8>> {
    if let Some(dir) = active().read().unwrap().as_ref() {
        if let Ok(b) = fs::read(dir.join(path)) {
            return Some(b);
        }
    }
    app.asset_resolver().get(format!("/{path}")).map(|a| a.bytes)
}

fn ui_version<R: Runtime>(app: &AppHandle<R>) -> String {
    active()
        .read()
        .unwrap()
        .as_ref()
        .and_then(|d| read_manifest(d))
        .map(|m| m.version)
        .unwrap_or_else(|| app.package_info().version.to_string())
}

// ─── Команды ───────────────────────────────────────────────────────────────────

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct OtaStatus {
    native_version: String,
    native_api: u32,
    ui_version: String,
    /// Скачано и ждёт применения.
    pending: Option<String>,
}

#[tauri::command]
pub fn ota_status(app: AppHandle) -> OtaStatus {
    let pending = root()
        .get()
        .map(|r| r.join(STAGING))
        .filter(|s| s.join(READY).exists())
        .and_then(|s| read_manifest(&s))
        .map(|m| m.version);
    OtaStatus {
        native_version: app.package_info().version.to_string(),
        native_api: NATIVE_API,
        ui_version: ui_version(&app),
        pending,
    }
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct NativeCheck {
    version: String,
    size: u64,
}

/// Полная сборка новее установленной и есть файл для этой системы.
fn native_update<R: Runtime>(app: &AppHandle<R>, m: &Manifest) -> Option<NativeCheck> {
    let n = m.native.as_ref()?;
    let file = n.for_this_os()?;
    version_newer(&n.version, &app.package_info().version.to_string()).then(|| NativeCheck { version: n.version.clone(), size: file.size })
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct OtaCheck {
    /// Полное обновление приложения, если есть.
    native: Option<NativeCheck>,
    version: String,
    native_api: u32,
    /// Новее того, что сейчас работает.
    newer: bool,
    /// Подходит к этой нативной части (иначе нужна полная установка).
    compatible: bool,
    files: usize,
    bytes: u64,
}

#[tauri::command]
pub async fn ota_check(app: AppHandle, url: String) -> Result<OtaCheck, String> {
    let m = fetch_manifest(&client()?, &url).await?;
    let (mut files, mut bytes) = (0, 0);
    for (path, f) in &m.files {
        if served(&app, path).map(|b| sha256_hex(&b)) != Some(f.sha256.clone()) {
            files += 1;
            bytes += f.size;
        }
    }
    Ok(OtaCheck {
        native: native_update(&app, &m),
        newer: version_newer(&m.version, &ui_version(&app)),
        compatible: m.native_api <= NATIVE_API,
        version: m.version,
        native_api: m.native_api,
        files,
        bytes,
    })
}

#[derive(Serialize, Clone)]
struct Progress {
    done: usize,
    total: usize,
}

/// Собрать в `ota/staging` полную версию: своё (по sha256) — копией, остальное — с сервера.
#[tauri::command]
pub async fn ota_download(app: AppHandle, url: String) -> Result<String, String> {
    let client = client()?;
    let m = fetch_manifest(&client, &url).await?;
    if m.native_api > NATIVE_API {
        return Err("native update required".into());
    }
    let root_dir = root().get().ok_or("no data dir")?.clone();
    let staging = root_dir.join(STAGING);
    // Недокачанное от другой версии — заново
    if read_manifest(&staging).map(|s| s.version != m.version).unwrap_or(false) {
        let _ = fs::remove_dir_all(&staging);
    }
    let _ = fs::remove_file(staging.join(READY));

    let total = m.files.len();
    for (i, (path, f)) in m.files.iter().enumerate() {
        if path.split('/').any(|p| p == ".." || p.is_empty()) {
            return Err(format!("bad path in manifest: {path}"));
        }
        let target = staging.join(path);
        let have = fs::read(&target).ok().filter(|b| sha256_hex(b) == f.sha256);
        if have.is_none() {
            let bytes = match served(&app, path).filter(|b| sha256_hex(b) == f.sha256) {
                Some(b) => b,
                None => {
                    let b = get_bytes(&client, &f.url(&url)).await?;
                    if sha256_hex(&b) != f.sha256 {
                        return Err(format!("hash mismatch: {path}"));
                    }
                    b
                }
            };
            if let Some(dir) = target.parent() {
                fs::create_dir_all(dir).map_err(|e| e.to_string())?;
            }
            fs::write(&target, bytes).map_err(|e| e.to_string())?;
        }
        let _ = app.emit("ota-progress", Progress { done: i + 1, total });
    }
    fs::write(staging.join(MANIFEST), serde_json::to_vec_pretty(&m).map_err(|e| e.to_string())?).map_err(|e| e.to_string())?;
    fs::write(staging.join(READY), b"").map_err(|e| e.to_string())?;
    Ok(m.version)
}

/// Применить скачанное сейчас: страница после этого перезагружается.
#[tauri::command]
pub fn ota_apply() -> Result<(), String> {
    let root_dir = root().get().ok_or("no data dir")?;
    promote_staging(root_dir)?;
    *active().write().unwrap() = Some(root_dir.join(CURRENT));
    Ok(())
}

/// Вернуть вшитый интерфейс (удалить скачанное).
#[tauri::command]
pub fn ota_reset() -> Result<(), String> {
    let root_dir = root().get().ok_or("no data dir")?;
    *active().write().unwrap() = None;
    let _ = fs::remove_dir_all(root_dir.join(CURRENT));
    let _ = fs::remove_dir_all(root_dir.join(STAGING));
    Ok(())
}

// ─── Полное обновление ─────────────────────────────────────────────────────────

fn native_file() -> &'static RwLock<Option<PathBuf>> {
    static FILE: RwLock<Option<PathBuf>> = RwLock::new(None);
    &FILE
}

/// Скачать APK / установщик своей системы в кэш (с проверкой sha256). Прогресс — `ota-native-progress`
/// в байтах. Возвращает путь к файлу (Android отдаёт его системной установке).
#[tauri::command]
pub async fn ota_native_download(app: AppHandle, url: String) -> Result<String, String> {
    let client = reqwest::Client::builder().build().map_err(|e| e.to_string())?;
    let m = fetch_manifest(&client, &url).await?;
    let n = m.native.as_ref().ok_or("no native release")?;
    let entry = n.for_this_os().ok_or("no build for this system")?.clone();
    let dir = app.path().app_cache_dir().map_err(|e| e.to_string())?.join("update");
    fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    let name = if cfg!(target_os = "android") { format!("NHApp-{}.apk", n.version) } else { format!("NHApp-{}-setup.exe", n.version) };
    let target = dir.join(name);

    let ready = fs::read(&target).map(|b| sha256_hex(&b) == entry.sha256).unwrap_or(false);
    if !ready {
        // Старые скачанные сборки больше не нужны
        if let Ok(it) = fs::read_dir(&dir) {
            for f in it.flatten() {
                let _ = fs::remove_file(f.path());
            }
        }
        let file_url = entry.url(&url);
        let mut res = client.get(&file_url).send().await.map_err(|e| e.to_string())?;
        if !res.status().is_success() {
            return Err(format!("HTTP {} — {file_url}", res.status()));
        }
        let part = target.with_extension("part");
        let mut out = fs::File::create(&part).map_err(|e| e.to_string())?;
        let mut hasher = Sha256::new();
        let mut done: u64 = 0;
        let mut last_emit: u64 = 0;
        while let Some(chunk) = res.chunk().await.map_err(|e| e.to_string())? {
            use std::io::Write;
            out.write_all(&chunk).map_err(|e| e.to_string())?;
            hasher.update(&chunk);
            done += chunk.len() as u64;
            if done - last_emit > 256 * 1024 || done == entry.size {
                last_emit = done;
                let _ = app.emit("ota-native-progress", Progress { done: done as usize, total: entry.size as usize });
            }
        }
        drop(out);
        let hash: String = hasher.finalize().iter().map(|b| format!("{b:02x}")).collect();
        if hash != entry.sha256 {
            let _ = fs::remove_file(&part);
            return Err("hash mismatch".into());
        }
        fs::rename(&part, &target).map_err(|e| e.to_string())?;
    }
    *native_file().write().unwrap() = Some(target.clone());
    Ok(target.to_string_lossy().into_owned())
}

/// Windows: запустить скачанный установщик (`/P` — без вопросов, с полосой прогресса; `/R` — запустить
/// приложение после установки) и закрыться, чтобы он мог заменить файлы.
#[cfg(desktop)]
#[tauri::command]
pub fn ota_native_run(app: AppHandle) -> Result<(), String> {
    let path = native_file().read().unwrap().clone().ok_or("nothing downloaded")?;
    if !cfg!(target_os = "windows") {
        return Err("unsupported".into());
    }
    std::process::Command::new(&path).args(["/P", "/R", "/UPDATE"]).spawn().map_err(|e| e.to_string())?;
    app.exit(0);
    Ok(())
}
