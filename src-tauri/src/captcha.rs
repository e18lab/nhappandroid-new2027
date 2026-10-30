//! Капча nhentai (Cloudflare Turnstile / hCaptcha) на ПК — замена окна капчи Electron из старого приложения.
//!
//! Ключ капчи привязан к домену nhentai.net, поэтому виджет должен жить на странице этого домена.
//! Окно открывает лёгкий адрес `https://nhentai.net/api/v2/captcha` (JSON), скрипт инициализации
//! заменяет содержимое страницы виджетом. Токен возвращается переходом на служебный адрес
//! `https://nhentai.net/__nhapp_captcha#<токен>`: переход перехватывается здесь, окно закрывается,
//! токен уходит в приложение событием `nh-captcha` ("" — окно закрыли или капча не прошла).

use std::sync::{
    atomic::{AtomicBool, Ordering},
    Arc,
};
use tauri::{AppHandle, Emitter, Manager, WebviewUrl, WebviewWindowBuilder, WindowEvent};

const LABEL: &str = "nh-captcha";
const LANDING: &str = "https://nhentai.net/api/v2/captcha";
const RESULT_PATH: &str = "/__nhapp_captcha";

fn js_string(s: &str) -> String {
    serde_json::to_string(s).unwrap_or_else(|_| "\"\"".into())
}

fn init_script(site_key: &str, provider: &str, error_text: &str, retry_text: &str) -> String {
    let hcaptcha = provider.to_lowercase().contains("hcaptcha");
    format!(
        r##"(function () {{
  if (location.hostname !== "nhentai.net" || location.pathname !== "/api/v2/captcha") return;
  var KEY = {key}, HC = {hc}, ERR = {err}, RETRY = {retry};
  var widget = null;
  function done(t) {{ location.replace("https://nhentai.net{result}#" + encodeURIComponent(t || "")); }}
  function fail() {{
    var m = document.getElementById("msg");
    m.innerHTML = "";
    var p = document.createElement("p"); p.textContent = ERR; m.appendChild(p);
    var b = document.createElement("button"); b.textContent = RETRY;
    b.onclick = function () {{ m.innerHTML = ""; reset(); }};
    m.appendChild(b);
  }}
  function reset() {{
    try {{ if (HC) hcaptcha.reset(widget); else turnstile.reset(widget); }} catch (e) {{ location.reload(); }}
  }}
  function start() {{
    var api = HC ? window.hcaptcha : window.turnstile;
    if (!api || !api.render) {{ setTimeout(start, 50); return; }}
    var opts = {{ sitekey: KEY, theme: "dark", callback: done, "error-callback": fail, "expired-callback": reset }};
    try {{ widget = api.render(HC ? document.getElementById("root") : "#root", opts); }} catch (e) {{ fail(); }}
  }}
  function build() {{
    document.documentElement.innerHTML =
      '<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">' +
      '<style>html,body{{margin:0;height:100%;background:#1e1e1e;color:#ccc;font:14px system-ui,sans-serif}}' +
      'body{{display:flex;flex-direction:column;align-items:center;justify-content:center;gap:12px;text-align:center}}' +
      '#msg button{{padding:8px 16px;border:0;border-radius:10px;background:#ed2553;color:#fff;font-weight:700;cursor:pointer}}' +
      '</style></head><body><div id="root"></div><div id="msg"></div></body>';
    var s = document.createElement("script");
    s.src = HC ? "https://js.hcaptcha.com/1/api.js" : "https://challenges.cloudflare.com/turnstile/v0/api.js";
    s.async = true;
    s.onload = start;
    s.onerror = fail;
    document.head.appendChild(s);
  }}
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", build);
  else build();
}})();"##,
        key = js_string(site_key),
        hc = hcaptcha,
        err = js_string(error_text),
        retry = js_string(retry_text),
        result = RESULT_PATH,
    )
}

/// Открывает окно капчи; результат придёт событием `nh-captcha`.
/// Команда асинхронная: синхронная выполняется в главном потоке, и на Windows создание окна
/// из неё вешает приложение (WebView2 ждёт тот же поток).
#[tauri::command]
pub async fn open_captcha(
    app: AppHandle,
    site_key: String,
    provider: String,
    title: String,
    error_text: String,
    retry_text: String,
) -> Result<(), String> {
    if let Some(old) = app.get_webview_window(LABEL) {
        let _ = old.destroy();
    }
    let delivered = Arc::new(AtomicBool::new(false));

    let nav_app = app.clone();
    let nav_delivered = delivered.clone();
    let window = WebviewWindowBuilder::new(
        &app,
        LABEL,
        WebviewUrl::External(LANDING.parse().map_err(|e| format!("{e}"))?),
    )
    .title(title)
    .inner_size(420.0, 320.0)
    .resizable(false)
    .center()
    .initialization_script(init_script(&site_key, &provider, &error_text, &retry_text))
    .on_navigation(move |url| {
        if url.host_str() != Some("nhentai.net") || url.path() != RESULT_PATH {
            return true;
        }
        let token = url
            .fragment()
            .map(|f| urlencoding_decode(f))
            .unwrap_or_default();
        if !nav_delivered.swap(true, Ordering::SeqCst) {
            let _ = nav_app.emit("nh-captcha", token);
        }
        // Закрывать окно изнутри обработчика перехода нельзя — откладываем
        let app = nav_app.clone();
        tauri::async_runtime::spawn(async move {
            if let Some(w) = app.get_webview_window(LABEL) {
                let _ = w.destroy();
            }
        });
        false
    })
    .build()
    .map_err(|e| e.to_string())?;

    let close_app = app.clone();
    window.on_window_event(move |event| {
        if matches!(event, WindowEvent::Destroyed) && !delivered.swap(true, Ordering::SeqCst) {
            let _ = close_app.emit("nh-captcha", String::new());
        }
    });
    Ok(())
}

/// Раскодировать `%XX` из фрагмента адреса (токен приходит через encodeURIComponent).
fn urlencoding_decode(s: &str) -> String {
    let bytes = s.as_bytes();
    let mut out = Vec::with_capacity(bytes.len());
    let mut i = 0;
    while i < bytes.len() {
        if bytes[i] == b'%' && i + 2 < bytes.len() {
            if let Ok(b) = u8::from_str_radix(&s[i + 1..i + 3], 16) {
                out.push(b);
                i += 3;
                continue;
            }
        }
        out.push(bytes[i]);
        i += 1;
    }
    String::from_utf8_lossy(&out).into_owned()
}
