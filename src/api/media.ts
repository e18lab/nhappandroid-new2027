/**
 * Адреса картинок nhentai CDN — перенос из старого приложения:
 * `api/v2/config.ts` (резолв путей), `components/buildImageFallbacks.ts` и `buildPageSources.ts` (запасные адреса).
 *
 * Превью и обложки лежат на thumb-CDN (t1–t4), страницы — на image-CDN (i1–i4).
 * Обложка с i* отдаёт ошибку. Referer CDN не проверяет — хватает обычного <img>.
 */
import { apiGet } from "./client";
import type { CdnConfig } from "./types";

const DEFAULT_THUMBS = [
  "https://t1.nhentai.net",
  "https://t2.nhentai.net",
  "https://t3.nhentai.net",
  "https://t4.nhentai.net",
];
const DEFAULT_IMAGES = [
  "https://i1.nhentai.net",
  "https://i2.nhentai.net",
  "https://i3.nhentai.net",
  "https://i4.nhentai.net",
];

let thumbs = [...DEFAULT_THUMBS];
let images = [...DEFAULT_IMAGES];
let ready: Promise<void> | null = null;

const trimSlash = (url: string) => url.replace(/\/$/, "");

/** Хосты с прошлого запуска — на устройстве, чтобы ленты не ждали /config. */
const CDN_CACHE_KEY = "@local.cdn.hosts";
/** Без сохранённых хостов ленты ждут /config не дольше этого — дальше t1–t4 / i1–i4, конфиг догонит. */
const CDN_WAIT_MS = 1_500;

try {
  const saved = JSON.parse(localStorage.getItem(CDN_CACHE_KEY) || "null") as { t?: string[]; i?: string[] } | null;
  if (saved?.t?.length) thumbs = saved.t;
  if (saved?.i?.length) images = saved.i;
} catch {
  /* нет сохранённых — значения по умолчанию */
}
const hadSaved = thumbs !== DEFAULT_THUMBS && images !== DEFAULT_IMAGES;

/**
 * Хосты CDN из GET /config, иначе /cdn, иначе t1–t4 / i1–i4. Параллельные вызовы ждут один запрос.
 * Ленты его почти не ждут: есть хосты с прошлого запуска — сразу, нет — не дольше `CDN_WAIT_MS`.
 * Не удалось — попробуем при следующем вызове.
 */
export async function initCdn(): Promise<void> {
  if (!ready) {
    const job = (async () => {
      const cfg = await loadCdnConfig();
      if (!cfg) {
        ready = null;
        return;
      }
      if (cfg.thumb_servers?.length) thumbs = cfg.thumb_servers.map(trimSlash);
      if (cfg.image_servers?.length) images = cfg.image_servers.map(trimSlash);
      try {
        localStorage.setItem(CDN_CACHE_KEY, JSON.stringify({ t: thumbs, i: images }));
      } catch {
        /* хранилище недоступно — не страшно */
      }
    })();
    ready = hadSaved ? Promise.resolve() : Promise.race([job, new Promise<void>((r) => setTimeout(r, CDN_WAIT_MS))]);
  }
  await ready;
}

async function loadCdnConfig(): Promise<CdnConfig | null> {
  try {
    const cfg = await apiGet<CdnConfig>("/config");
    if (cfg.image_servers?.length && cfg.thumb_servers?.length) return cfg;
  } catch {
    /* пробуем /cdn */
  }
  try {
    return await apiGet<CdnConfig>("/cdn");
  } catch {
    return null;
  }
}

/** API v2 иногда отдаёт `cover.webp.webp` / `3t.webp.webp`, а CDN хранит один `.webp`. */
export function normalizeMediaPath(path: string): string {
  let p = (path || "").trim();
  if (!p) return p;
  if (/^https?:\/\//i.test(p)) {
    try {
      const u = new URL(p);
      u.pathname = collapseWebp(u.pathname);
      return u.toString();
    } catch {
      return collapseWebp(p);
    }
  }
  return collapseWebp(p);
}

function collapseWebp(p: string): string {
  while (/\.webp\.webp$/i.test(p)) p = p.replace(/\.webp\.webp$/i, ".webp");
  return p;
}

function absolute(path: string, host: string): string {
  return host + (path.startsWith("/") ? path : `/${path}`);
}

/** Скачанные файлы отдаются протоколом asset (`convertFileSrc`): их не переписываем и зеркала не перебираем. */
export function isLocalMedia(path: string | undefined): boolean {
  return !!path && /^(asset:|https?:\/\/asset\.localhost\/)/i.test(path);
}

/** Полный адрес превью/обложки по пути из API. */
export function thumbUrl(path: string | undefined): string {
  if (!path) return "";
  if (isLocalMedia(path)) return path;
  const p = normalizeMediaPath(path);
  if (/^https?:\/\//i.test(p)) return p.replace(/^https?:\/\/t\.nhentai\.net(?=\/|$)/i, thumbs[0]);
  return absolute(p, thumbs[0]);
}

/** Полный адрес страницы по пути из API. */
export function imageUrl(path: string | undefined): string {
  if (!path) return "";
  if (isLocalMedia(path)) return path;
  const p = normalizeMediaPath(path);
  if (/^https?:\/\//i.test(p)) return p.replace(/^https?:\/\/i\.nhentai\.net(?=\/|$)/i, images[0]);
  return absolute(p, images[0]);
}

/** Исходное расширение первым, затем остальные варианты, которые встречаются на CDN. */
function extensionVariants(preferred: string): string[] {
  let e = collapseWebp(preferred.toLowerCase());
  if (e === "jpeg") e = "jpg";
  const rest = ["webp", "jpg", "png", "gif", "jpg.webp", "png.webp", "webp.webp", "gif.webp"];
  return [e, ...rest].filter((x, i, a) => a.indexOf(x) === i);
}

function pathnameOf(url: string): string {
  if (/^https?:\/\//i.test(url)) {
    try {
      return new URL(url).pathname;
    } catch {
      return "";
    }
  }
  return url.startsWith("/") ? url : `/${url}`;
}

function uniqueList() {
  const out: string[] = [];
  const seen = new Set<string>();
  return {
    out,
    add(u: string) {
      if (u && !seen.has(u)) {
        seen.add(u);
        out.push(u);
      }
    },
  };
}

/**
 * Адреса превью/обложки по порядку перебора:
 * исходный → то же на всех t-зеркалах → thumb↔cover и другие расширения на всех зеркалах.
 */
export function thumbSources(path: string | undefined): string[] {
  const first = thumbUrl(path);
  if (!first) return [];
  if (isLocalMedia(first)) return [first];
  const pathname = pathnameOf(first);
  const { out, add } = uniqueList();
  add(first);

  const gallery = pathname.match(/^\/galleries\/(\d+)\/(thumb|cover)\.(.+)$/i);
  if (!gallery) {
    if (/^https?:\/\/t\d?\.nhentai\.net/i.test(first)) {
      for (const host of thumbs) add(host + pathname);
    }
    return out;
  }

  const [, id, role, ext] = gallery;
  for (const host of thumbs) add(host + pathname);
  const names = role.toLowerCase() === "thumb" ? ["thumb", "cover"] : ["cover", "thumb"];
  for (const name of names) {
    for (const suffix of extensionVariants(ext)) {
      for (const host of thumbs) add(`${host}/galleries/${id}/${name}.${suffix}`);
    }
  }
  return out;
}

/** Адреса страницы: исходный → все i-зеркала × варианты расширения. */
export function pageSources(path: string | undefined): string[] {
  const first = imageUrl(path);
  if (!first) return [];
  if (isLocalMedia(first)) return [first];
  const pathname = pathnameOf(first);
  const { out, add } = uniqueList();
  add(first);

  const m = pathname.match(/^(.*\/[^/.]+)\.(.+)$/);
  if (!m) {
    for (const host of images) add(host + pathname);
    return out;
  }
  const [, base, ext] = m;
  for (const suffix of extensionVariants(ext)) {
    for (const host of images) add(`${host}${base}.${suffix}`);
  }
  return out;
}
