/**
 * Пакет обновления интерфейса из `dist/` (сначала `vite build`): `update/ota/manifest.json` — версия
 * (package.json), `nativeApi` (из src-tauri/src/ota.rs), sha256 и размер каждого файла; `manifest.sig` —
 * подпись ed25519 (`npm run ota:keygen`); `files/<sha256>` — файлы. Старые файлы не удаляются: имя — хеш,
 * у разных версий общие файлы одни и те же. Папку `update/ota` раздаёт `npm run ota:serve`
 * (или её содержимое выкладывается в релиз).
 *
 * `--native` — добавить полную сборку приложения (версия из tauri.conf.json): последний APK из
 * `src-tauri/gen/android/.../apk` и установщик NSIS этой версии. Без флага полная сборка из прошлого
 * манифеста сохраняется — выпуск одного интерфейса её не убирает.
 */
import { createHash, createPrivateKey, sign } from "node:crypto";
import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { join, relative, sep } from "node:path";

const APK_DIR = "src-tauri/gen/android/app/build/outputs/apk";
const NSIS_DIR = "src-tauri/target/release/bundle/nsis";

const DIST = "dist";
const OUT = "update/ota";
const KEY = "update/keys/ota-private.pem";

if (!existsSync(KEY)) throw new Error(`нет ключа ${KEY} — npm run ota:keygen`);
if (!existsSync(join(DIST, "index.html"))) throw new Error("нет dist/ — сначала vite build");

const version = JSON.parse(readFileSync("package.json", "utf8")).version;
const nativeApi = Number(/pub const NATIVE_API: u32 = (\d+);/.exec(readFileSync("src-tauri/src/ota.rs", "utf8"))?.[1]);
if (!nativeApi) throw new Error("не найден NATIVE_API в src-tauri/src/ota.rs");

const walk = (dir) => readdirSync(dir).flatMap((n) => (statSync(join(dir, n)).isDirectory() ? walk(join(dir, n)) : [join(dir, n)]));

mkdirSync(join(OUT, "files"), { recursive: true });
const files = {};
let added = 0;
for (const path of walk(DIST).sort()) {
  const bytes = readFileSync(path);
  const sha256 = createHash("sha256").update(bytes).digest("hex");
  files[relative(DIST, path).split(sep).join("/")] = { sha256, size: bytes.length };
  const blob = join(OUT, "files", sha256);
  if (!existsSync(blob)) {
    copyFileSync(path, blob);
    added++;
  }
}

/** Файл в хранилище по хешу; в манифест — sha256 и размер. */
function store(path) {
  const bytes = readFileSync(path);
  const sha256 = createHash("sha256").update(bytes).digest("hex");
  const blob = join(OUT, "files", sha256);
  if (!existsSync(blob)) copyFileSync(path, blob);
  return { sha256, size: bytes.length };
}

let native;
if (process.argv.includes("--native")) {
  const nativeVersion = JSON.parse(readFileSync("src-tauri/tauri.conf.json", "utf8")).version;
  native = { version: nativeVersion };
  const apks = existsSync(APK_DIR) ? walk(APK_DIR).filter((f) => f.endsWith(".apk")) : [];
  const apk = apks.sort((a, b) => statSync(b).mtimeMs - statSync(a).mtimeMs)[0];
  if (apk) {
    native.android = store(apk);
    console.log(`Android: ${apk}`);
  }
  const setup = join(NSIS_DIR, `NHApp_${nativeVersion}_x64-setup.exe`);
  if (existsSync(setup)) {
    native.windows = store(setup);
    console.log(`Windows: ${setup}`);
  }
  if (!native.android && !native.windows) throw new Error("нет ни APK, ни установщика — сначала соберите приложение");
} else if (existsSync(join(OUT, "manifest.json"))) {
  native = JSON.parse(readFileSync(join(OUT, "manifest.json"), "utf8")).native;
}

const manifest = Buffer.from(JSON.stringify({ version, nativeApi, files, ...(native ? { native } : {}) }, null, 2));
writeFileSync(join(OUT, "manifest.json"), manifest);
writeFileSync(join(OUT, "manifest.sig"), sign(null, manifest, createPrivateKey(readFileSync(KEY))).toString("base64") + "\n");
console.log(`${version} (nativeApi ${nativeApi}): ${Object.keys(files).length} файлов, новых — ${added} → ${OUT}`);
if (native) console.log(`полная сборка: ${native.version}${native.android ? " · Android" : ""}${native.windows ? " · Windows" : ""}`);
