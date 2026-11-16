/**
 * Адрес открытой страницы на сайте ресурса — для адресной строки (ПК) и меню телефона.
 */
import { NH_HOST } from "../api/client";
import { buildV2Query } from "../api/search";
import { getPagesQuery, getSort, getTagFilters, getUploaded } from "./browseFilters";

/**
 * Поиск на сайте с тем же запросом, что уходит в API: текст, страницы, включённые и исключённые теги
 * (`tag:x -artist:"y z"`), дата загрузки, плюс сортировка. Без запроса и по дате — главная сайта.
 * Пробелы — `+`, двоеточия не кодируются (как в адресах сайта); кавычки, `<`, `>` и прочее — кодируются.
 */
function webSearchUrl(text: string): string {
  // Тот же запрос, что собирает лента (CatalogFeed → galleryBrowse): текст + страницы, включения, исключения, дата
  const tags = getTagFilters();
  const q = buildV2Query(
    [text.trim(), getPagesQuery()].filter(Boolean).join(" "),
    tags.filter((f) => f.mode !== "exclude"),
    tags.filter((f) => f.mode === "exclude"),
    getUploaded(),
  ).trim();
  const sort = getSort();
  if (!q && sort === "date") return `${NH_HOST}/`;
  const enc = encodeURIComponent(q || "*").replace(/%20/g, "+").replace(/%3A/gi, ":");
  return `${NH_HOST}/search/?q=${enc}${sort !== "date" ? `&sort=${sort}` : ""}`;
}

/** Ссылка на ту же страницу на сайте; `null` — у экрана нет страницы на сайте (загруженное, история…). */
export function webUrl(pathname: string, search: string, homeTab: string): string | null {
  const params = new URLSearchParams(search);
  const query = params.get("query")?.trim();
  let m: RegExpMatchArray | null;
  if ((pathname === "/" || pathname === "/explore") && query) return webSearchUrl(query);
  if ((m = pathname.match(/^\/(?:book|read)\/(\d+)/))) return `${NH_HOST}/g/${m[1]}/`;
  if ((m = pathname.match(/^\/profile\/(\d+)\/([^/]+)/))) return `${NH_HOST}/users/${m[1]}/${m[2]}/`;
  if (pathname === "/tags") return `${NH_HOST}/tags/`;
  if (pathname === "/favorites-online") return `${NH_HOST}/favorites/`;
  if (pathname === "/search") return `${NH_HOST}/search/`;
  if (pathname === "/") {
    if (homeTab === "latest") return webSearchUrl("");
    if (homeTab === "online") return `${NH_HOST}/favorites/`;
    if (homeTab === "tags") return `${NH_HOST}/tags/`;
  }
  return null;
}

