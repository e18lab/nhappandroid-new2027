/**
 * Пакет обновления интерфейса из `dist/` (сначала `vite build`): `update/ota/manifest.json` — версия
 * (package.json), `nativeApi` (из src-tauri/src/ota.rs), sha256 и размер каждого файла; `manifest.sig` —
 * подпись ed25519 (`npm run ota:keygen`); `files/<sha256>` — файлы. Старые файлы не удаляются: имя — хеш,
 * у разных версий общие файлы одни и те же. Папку `update/ota` раздаёт `npm run ota:serve`
 * (или её содержимое выкладывается в релиз).
 */
import { createHash, createPrivateKey, sign } from "node:crypto";
import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { join, relative, sep } from "node:path";

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

const manifest = Buffer.from(JSON.stringify({ version, nativeApi, files }, null, 2));
writeFileSync(join(OUT, "manifest.json"), manifest);
writeFileSync(join(OUT, "manifest.sig"), sign(null, manifest, createPrivateKey(readFileSync(KEY))).toString("base64") + "\n");
console.log(`${version} (nativeApi ${nativeApi}): ${Object.keys(files).length} файлов, новых — ${added} → ${OUT}`);
