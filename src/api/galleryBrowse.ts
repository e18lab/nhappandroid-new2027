/**
 * Каталог для главной и «Обзора» — перенос `api/v2/galleryBrowse.ts`.
 * Если фильтр сводится к одному тегу (без слов, исключений и даты), идём в `/galleries/tagged`:
 * там число страниц как на сайте, а у `/search` оно обрезано примерно до 1000.
 */
import { getGalleriesByTag, PER_PAGE } from "./galleries";
import { buildV2Query, searchGalleries, type TagFilter } from "./search";
import { autocompleteTags } from "./tags";
import type { GalleryCard, Paginated, SortOrder, TagType } from "./types";

export interface GalleryBrowseFilter extends TagFilter {
  id?: string | number;
}

export interface FetchGalleryBrowseParams {
  query: string;
  includes: GalleryBrowseFilter[];
  excludes: GalleryBrowseFilter[];
  uploaded?: string | null;
  sort: SortOrder;
  page: number;
  per_page?: number;
}

const TAG_ID_CACHE = new Map<string, number>();

const TAG_TYPES: Record<string, TagType> = {
  tag: "tag",
  tags: "tag",
  artist: "artist",
  artists: "artist",
  character: "character",
  characters: "character",
  parody: "parody",
  parodies: "parody",
  group: "group",
  groups: "group",
  language: "language",
  languages: "language",
  category: "category",
  categories: "category",
};

/** id тега, если фильтр — ровно один включённый тег; иначе null. */
export async function tryResolveSingleTagBrowseId(
  includes: GalleryBrowseFilter[],
  excludes: GalleryBrowseFilter[],
  queryTrim: string,
  uploaded?: string | null,
): Promise<number | null> {
  if (queryTrim || uploaded || excludes.length > 0 || includes.length !== 1) return null;

  const inc = includes[0];
  const apiType = TAG_TYPES[String(inc.type).toLowerCase()];
  if (!apiType) return null;
  const key = `${apiType}:${inc.name.trim().toLowerCase()}`;

  const known = Number(inc.id);
  if (inc.id != null && inc.id !== "" && Number.isFinite(known) && known > 0) {
    TAG_ID_CACHE.set(key, known);
    return known;
  }
  const cached = TAG_ID_CACHE.get(key);
  if (cached != null) return cached;

  const candidates = await autocompleteTags({ query: inc.name.trim(), type: apiType, limit: 40 });
  const want = inc.name.trim().toLowerCase();
  const hit = candidates.find((t) => t.name.trim().toLowerCase() === want);
  if (hit && Number.isFinite(hit.id)) {
    TAG_ID_CACHE.set(key, hit.id);
    return hit.id;
  }
  return null;
}

export async function fetchGalleryBrowsePaginated(params: FetchGalleryBrowseParams): Promise<Paginated<GalleryCard>> {
  const q = (params.query ?? "").trim();
  const page = params.page ?? 1;
  const sort = params.sort ?? "date";
  const per_page = params.per_page ?? PER_PAGE;

  let tagId: number | null = null;
  try {
    tagId = await tryResolveSingleTagBrowseId(params.includes, params.excludes, q, params.uploaded);
  } catch {
    /* подсказки недоступны — обычный поиск */
  }
  if (tagId != null) return getGalleriesByTag({ tag_id: tagId, sort, page, per_page });

  const query = buildV2Query(q, params.includes, params.excludes, params.uploaded ?? null);
  return searchGalleries({ query, sort, page, per_page });
}

/** Всего результатов (как на сайте), для пагинации. */
export function totalFromPaginated(p: Paginated<GalleryCard>): number {
  if (Number.isFinite(p.total) && p.total > 0) return p.total;
  return Math.max(0, (p.num_pages ?? 1) * (p.per_page ?? PER_PAGE));
}
