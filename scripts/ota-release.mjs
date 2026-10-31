/**
 * Выложить пакет из `update/ota` (сначала `npm run ota:pack` или `ota:pack:native`) в релиз GitHub
 * `v<версия>` репозитория e18lab/nhappandroid-new2027 — приложение берёт обновления из последнего релиза
 * (`releases/latest/download/...`). В релиз идут `manifest.json`, `manifest.sig` и только файлы этого
 * манифеста (интерфейс по sha256, APK и установщик под своими именами). Релиз уже есть — файлы заменяются.
 * Нужен `gh` с входом в аккаунт, у которого есть доступ к репозиторию.
 */
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

const REPO = process.env.OTA_REPO || "e18lab/nhappandroid-new2027";
const OUT = "update/ota";

if (!existsSync(join(OUT, "manifest.json"))) throw new Error(`нет ${OUT}/manifest.json — сначала npm run ota:pack`);
const manifest = JSON.parse(readFileSync(join(OUT, "manifest.json"), "utf8"));

const names = new Set(["manifest.json", "manifest.sig"]);
for (const f of Object.values(manifest.files)) names.add(f.sha256);
for (const f of [manifest.native?.android, manifest.native?.windows]) if (f) names.add(f.name ?? f.sha256);
const assets = [...names].map((n) => join(OUT, n));
const missing = assets.filter((p) => !existsSync(p));
if (missing.length) throw new Error(`нет файлов: ${missing.join(", ")} — пересоберите пакет`);

const tag = `v${manifest.version}`;
const gh = (...args) => execFileSync("gh", args, { stdio: "inherit" });
let exists = true;
try {
  execFileSync("gh", ["release", "view", tag, "--repo", REPO], { stdio: "ignore" });
} catch {
  exists = false;
}
if (exists) gh("release", "upload", tag, "--repo", REPO, "--clobber", ...assets);
else gh("release", "create", tag, "--repo", REPO, "--title", `NHApp ${manifest.version}`, "--notes", "", "--latest", ...assets);
console.log(`${tag}: ${assets.length} файлов → https://github.com/${REPO}/releases/tag/${tag}`);
