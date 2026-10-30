/**
 * Галереи — перенос `api/v2/galleries.ts`.
 *
 * GET    /galleries                 Все (новые первыми)
 * GET    /galleries/popular         Популярное за сегодня (5 шт.)
 * GET    /galleries/random          Случайный id
 * GET    /galleries/tagged          По одному тегу (без ограничения ~1000 страниц у /search)
 * GET    /galleries/{id}            Книга целиком, страницы внутри (`/pages` у API нет — 404)
 * GET    /galleries/{id}/related    Похожие
 * GET    /galleries/{id}/favorite   В избранном ли (нужен вход)
 * POST   /galleries/{id}/favorite   Добавить в избранное
 * DELETE /galleries/{id}/favorite   Убрать из избранного
 * POST   /galleries/{id}/edit       Правка тегов (только staff)
 */
import { apiGet, buildQuery, nhApi } from "./client";
import type { Gallery, GalleryCard, GalleryRelated, Paginated, SortOrder, SuccessResponse } from "./types";

export const PER_PAGE = 25;

const BROWSE_ALL = "*";

/** Списки v2 приходят как `{ result }`, иногда как `{ results }` или голый массив. */
export function asPage<T>(data: (Partial<Paginated<T>> & { results?: T[] }) | T[]): Paginated<T> {
  if (Array.isArray(data)) return { result: data, num_pages: 1, per_page: data.length, total: data.length };
  const result = data.result ?? data.results ?? [];
  const num_pages = data.num_pages || 1;
  const per_page = data.per_page || result.length;
  // `/galleries/tagged` присылает total: null — считаем по числу страниц
  return { result, num_pages, per_page, total: data.total || (data.num_pages ? num_pages * per_page : result.length) };
}

// ─── Списки ───────────────────────────────────────────────────────────────────

export interface GalleryListParams {
  page?: number;
  per_page?: number;
}

export async function getGalleries(params: GalleryListParams = {}): Promise<Paginated<GalleryCard>> {
  return asPage(await apiGet(`/galleries${buildQuery({ ...params })}`, { public: true }));
}

/**
 * Каталог по строке запроса: без запроса и при сортировке по дате — `/galleries`,
 * иначе `/search` (пустой `query` он не принимает, поэтому `*`).
 */
export async function listGalleries(page: number, sort: SortOrder, query: string): Promise<Paginated<GalleryCard>> {
  const q = query.trim();
  if (!q && sort === "date") return getGalleries({ page, per_page: PER_PAGE });
  return asPage(await apiGet(`/search${buildQuery({ query: q || BROWSE_ALL, sort, page, per_page: PER_PAGE })}`));
}

/** Топ-5 за сегодня (на сервере кешируется 60 с). */
export async function getPopularGalleries(): Promise<GalleryCard[]> {
  return asPage(await apiGet<GalleryCard[] | Paginated<GalleryCard>>("/galleries/popular")).result;
}

export interface GalleryByTagParams {
  tag_id: number;
  sort?: SortOrder;
  page?: number;
  per_page?: number;
}

export async function getGalleriesByTag(params: GalleryByTagParams): Promise<Paginated<GalleryCard>> {
  return asPage(await apiGet(`/galleries/tagged${buildQuery({ ...params })}`));
}

export async function getRandomGalleryId(): Promise<number> {
  const res = await apiGet<Record<string, unknown> | number>("/galleries/random");
  if (typeof res === "number") return res;
  const id = Number(res.id ?? res.gallery_id);
  if (!Number.isFinite(id)) throw new Error("Random gallery id is missing in the response");
  return id;
}

// ─── Книга ────────────────────────────────────────────────────────────────────

export type GalleryInclude = "comments" | "related" | "favorite";

export async function getGallery(id: number, include?: GalleryInclude[]): Promise<Gallery> {
  return apiGet(`/galleries/${id}${buildQuery({ include: include?.join(",") })}`);
}

export function cardTitle(card: GalleryCard): string {
  return card.english_title || card.japanese_title || `#${card.id}`;
}

/** Похожие книги — `{ result: GalleryCard[] }` (или голый массив, как учитывал старый клиент). */
export async function getRelatedGalleries(id: number): Promise<GalleryRelated[]> {
  return asPage(await apiGet<Paginated<GalleryRelated> | GalleryRelated[]>(`/galleries/${id}/related`)).result;
}

/** Число комментариев к книге (для кнопки комментариев). */
export async function getCommentCount(id: number): Promise<number> {
  const raw = await apiGet<{ result?: unknown[]; total?: number } | unknown[]>(`/galleries/${id}/comments`, {
    public: true,
  });
  if (Array.isArray(raw)) return raw.length;
  return raw.total ?? raw.result?.length ?? 0;
}

// ─── Онлайн-избранное (нужен вход) ────────────────────────────────────────────

export async function isFavorited(id: number): Promise<boolean> {
  const res = await nhApi.get<{ is_favorited?: boolean; favorited?: boolean }>(`/galleries/${id}/favorite`);
  return !!(res.is_favorited ?? res.favorited);
}

export function addFavorite(id: number): Promise<SuccessResponse> {
  return nhApi.post(`/galleries/${id}/favorite`);
}

export function removeFavorite(id: number): Promise<SuccessResponse> {
  return nhApi.delete(`/galleries/${id}/favorite`);
}

// ─── Правка тегов (staff) ─────────────────────────────────────────────────────

export interface GalleryEditParams {
  /** Новые теги, которых ещё нет на сайте. */
  created_tags?: { type: string; name: string }[];
  added_tags?: number[];
  removed_tags?: number[];
}

export function submitGalleryEdit(
  id: number,
  params: GalleryEditParams,
): Promise<SuccessResponse & { edit_id: number; auto_applied: boolean }> {
  return nhApi.post(`/galleries/${id}/edit`, {
    created_tags: params.created_tags ?? [],
    added_tags: params.added_tags ?? [],
    removed_tags: params.removed_tags ?? [],
  });
}
