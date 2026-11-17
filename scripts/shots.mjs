/**
 * Скриншоты MoeLibre для сайта: `npm run shots`.
 *
 * Поднимает dev-сервер (vite, порт 1425), открывает приложение в безголовом Edge/Chrome в демо-режиме
 * (`?demo` — аккаунт-заглушка «Agnes» без настоящих данных, см. `src/dev/demo.ts`) и снимает по каждому языку:
 *   pc-{lang}.webp              — каталог, ПК-версия 1440×900
 *   pc-account-{lang}.webp      — экран MoeLibre account, ПК
 *   mobile-{lang}.webp          — каталог, телефон 390×844 (×2 → 780×1688)
 *   mobile-account-{lang}.webp  — экран MoeLibre account, телефон
 *
 * Куда: `--out <папка>`; по умолчанию — `public/shots` сайта (`../MoeLibre site` или `~/MoeLibre site`), иначе `./shots`.
 * Только часть: `--only pc-account` (подстрока имени), `--lang en,ja`. Ожидание загрузки: `--wait 9000` (мс).
 * Сортировка каталога: `--sort popular-month` (по умолчанию; ещё date, popular, popular-today, popular-week).
 * Браузер: Edge или Chrome из стандартных мест; свой — переменной BROWSER.
 */
import { spawn } from "node:child_process";
import { existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join, resolve } from "node:path";

const ROOT = resolve(import.meta.dirname, "..");
const VITE_PORT = 1425;
const CDP_PORT = 9334;
const BASE = `http://localhost:${VITE_PORT}/`;

function arg(name, fallback) {
  const i = process.argv.indexOf(`--${name}`);
  return i > 0 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
}

// Папка сайта: рядом с приложением или в домашней папке
const site = [resolve(ROOT, "../MoeLibre site"), join(homedir(), "MoeLibre site")].find((p) => existsSync(join(p, "public")));
const OUT = resolve(arg("out", site ? join(site, "public/shots") : join(ROOT, "shots")));
const ONLY = arg("only", "");
const LANGS = arg("lang", "ru,en,zh,ja").split(",").map((s) => s.trim()).filter(Boolean);
const WAIT = Number(arg("wait", "9000"));
// Каталог на снимках — популярное за месяц (обложки поприличнее, чем у свежих); `--sort date` и т. п.
const SORT = arg("sort", "popular-month");

const BROWSERS = [
  process.env.BROWSER,
  "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe",
  "C:/Program Files/Microsoft/Edge/Application/msedge.exe",
  "C:/Program Files/Google/Chrome/Application/chrome.exe",
  `${process.env.LOCALAPPDATA}/Google/Chrome/Application/chrome.exe`,
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  "/usr/bin/google-chrome",
  "/usr/bin/chromium",
].filter(Boolean);
const BROWSER = BROWSERS.find((p) => existsSync(p));
if (!BROWSER) {
  console.error("Не найден Edge или Chrome — укажите путь в переменной BROWSER");
  process.exit(1);
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const children = [];
const cleanup = () => children.forEach((c) => c.kill());
process.on("exit", cleanup);
process.on("SIGINT", () => process.exit(130));

async function waitFor(url, what, tries = 150) {
  for (let i = 0; i < tries; i++) {
    try {
      const r = await fetch(url);
      if (r.ok) return r;
    } catch {
      /* ещё не поднялся */
    }
    await sleep(200);
  }
  throw new Error(`${what} не отвечает: ${url}`);
}

// ─── Dev-сервер ───────────────────────────────────────────────────────────────
const viteUp = await fetch(BASE).then((r) => r.ok, () => false);
if (!viteUp) {
  console.log(`Запускаю vite на :${VITE_PORT}…`);
  const vite = spawn(process.execPath, [join(ROOT, "node_modules/vite/bin/vite.js"), "--port", String(VITE_PORT), "--strictPort"], { cwd: ROOT, stdio: "ignore" });
  children.push(vite);
  await waitFor(BASE, "vite");
}

// ─── Браузер ──────────────────────────────────────────────────────────────────
const profile = join(tmpdir(), `moelibre-shots-${process.pid}`);
rmSync(profile, { recursive: true, force: true });
const browser = spawn(BROWSER, ["--headless=new", "--disable-gpu", "--hide-scrollbars", "--no-first-run", "--no-default-browser-check", `--user-data-dir=${profile}`, `--remote-debugging-port=${CDP_PORT}`, "about:blank"], { stdio: "ignore" });
children.push(browser);
await waitFor(`http://127.0.0.1:${CDP_PORT}/json/version`, "браузер");

const page = (await (await fetch(`http://127.0.0.1:${CDP_PORT}/json/list`)).json()).find((t) => t.type === "page");
const ws = new WebSocket(page.webSocketDebuggerUrl);
await new Promise((r, j) => {
  ws.onopen = r;
  ws.onerror = j;
});
let seq = 0;
const pending = new Map();
ws.onmessage = (e) => {
  const m = JSON.parse(e.data);
  if (m.id && pending.has(m.id)) {
    pending.get(m.id)(m);
    pending.delete(m.id);
  }
};
const cdp = (method, params = {}) =>
  new Promise((res, rej) => {
    const id = ++seq;
    pending.set(id, (m) => (m.error ? rej(new Error(`${method}: ${m.error.message}`)) : res(m.result)));
    ws.send(JSON.stringify({ id, method, params }));
  });

await cdp("Page.enable");

const MOBILE_UA = "Mozilla/5.0 (Linux; Android 14; 23127PN0CG) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Mobile Safari/537.36";
const PC_UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";
const SHOTS = [
  { name: "pc", desktop: true },
  { name: "pc-account", desktop: true, open: "/mlid" },
  { name: "mobile", desktop: false },
  { name: "mobile-account", desktop: false, open: "/mlid" },
];

mkdirSync(OUT, { recursive: true });
let count = 0;
for (const lang of LANGS) {
  for (const s of SHOTS) {
    const file = `${s.name}-${lang}.webp`;
    if (ONLY && !file.includes(ONLY)) continue;
    // Чистое хранилище на каждый снимок: вход-заглушку и язык ставит демо-режим
    await cdp("Storage.clearDataForOrigin", { origin: BASE.replace(/\/$/, ""), storageTypes: "local_storage,indexeddb,cache_storage" });
    if (s.desktop) {
      await cdp("Emulation.setDeviceMetricsOverride", { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });
      await cdp("Emulation.setUserAgentOverride", { userAgent: PC_UA });
      await cdp("Emulation.setTouchEmulationEnabled", { enabled: false });
    } else {
      await cdp("Emulation.setDeviceMetricsOverride", { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });
      await cdp("Emulation.setUserAgentOverride", { userAgent: MOBILE_UA });
      await cdp("Emulation.setTouchEmulationEnabled", { enabled: true, maxTouchPoints: 5 });
    }
    // ПК: экран открывает демо-режим (`open=`); телефон — по адресу после #
    const q = new URLSearchParams({ demo: "1", lang, sort: SORT });
    if (s.open && s.desktop) q.set("open", s.open);
    const url = `${BASE}?${s.desktop ? "desktop&" : ""}${q}${s.open && !s.desktop ? `#${s.open}` : ""}`;
    // Сначала пустая страница: иначе переход на тот же адрес с другим #… не перезагрузит приложение
    await cdp("Page.navigate", { url: "about:blank" });
    await sleep(300);
    await cdp("Page.navigate", { url });
    await sleep(WAIT);
    const { data } = await cdp("Page.captureScreenshot", { format: "webp", quality: 80 });
    writeFileSync(join(OUT, file), Buffer.from(data, "base64"));
    count++;
    console.log(`✓ ${file}`);
  }
}

ws.close();
console.log(`Готово: ${count} снимков в ${OUT}`);
process.exit(0);
