/**
 * Поиск — перенос `api/v2/search.ts`.
 *
 * GET /search?query=&sort=&page=&per_page=
 * Синтаксис запроса: `слово`, `"точная фраза"`, `-исключить`, `artist:имя`, `tag:"big breasts"`,
 * `pages:>10`, `favorites:>=100`, `uploaded:<7d`.
 */
import { apiGet, buildQuery } from "./client";
import { asPage, getGalleries, PER_PAGE } from "./galleries";
import type { GalleryCard, Paginated, SortOrder } from "./types";

export interface SearchParams {
  query: string;
  sort?: SortOrder;
  page?: number;
  per_page?: number;
}

/** `/search` не принимает пустой запрос — без слов при сортировке по дате берём `/galleries`, иначе `*`. */
const BROWSE_MATCH_ALL = "*";

export async function searchGalleries(params: SearchParams): Promise<Paginated<GalleryCard>> {
  const q = (params.query ?? "").trim();
  const sort = params.sort ?? "date";
  const page = params.page ?? 1;
  const per_page = params.per_page ?? PER_PAGE;
  if (!q && sort === "date") return getGalleries({ page, per_page });
  return asPage(await apiGet(`/search${buildQuery({ query: q || BROWSE_MATCH_ALL, sort, page, per_page })}`));
}

export interface TagFilter {
  type: string;
  name: string;
}

/** Слова + включённые/исключённые теги + фильтр даты → строка запроса v2 (`buildV2Query` из `compat.ts`). */
export function buildV2Query(
  base: string,
  include: TagFilter[] = [],
  exclude: TagFilter[] = [],
  uploaded?: string | null,
): string {
  const parts: string[] = [];
  if (base?.trim()) parts.push(base.trim());
  const quote = (name: string) => (name.includes(" ") ? `"${name}"` : name);
  for (const t of include) parts.push(`${t.type}:${quote(t.name)}`);
  for (const t of exclude) parts.push(`-${t.type}:${quote(t.name)}`);
  if (uploaded) parts.push(uploaded);
  return parts.join(" ");
}
