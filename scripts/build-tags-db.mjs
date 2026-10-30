/**
 * Справочник тегов для экрана тегов: из `api/nhentai-tags.json` старого приложения (12,7 МБ)
 * в компактный `src/data/nhentai-tags.json`: по типам массивы [id, name, count], от популярных к редким.
 * Ссылка на тег не хранится — она строится из типа и имени.
 *
 *   node scripts/build-tags-db.mjs [путь к nhentai-tags.json]
 */
import { readFileSync, writeFileSync } from "node:fs";

const src = process.argv[2] ?? "D:/nhappandroid/api/nhentai-tags.json";
const raw = JSON.parse(readFileSync(src, "utf8"));
const out = { updated: raw.updated };
for (const kind of ["tags", "artists", "characters", "parodies", "groups"]) {
  out[kind] = (raw[kind] ?? [])
    .map((t) => [Number(t.id), String(t.name), Number(t.count) || 0])
    .filter(([id, name]) => Number.isFinite(id) && name)
    .sort((a, b) => b[2] - a[2]);
}
writeFileSync("src/data/nhentai-tags.json", JSON.stringify(out));
console.log(Object.fromEntries(Object.entries(out).map(([k, v]) => [k, Array.isArray(v) ? v.length : v])));
