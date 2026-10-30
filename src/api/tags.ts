/**
 * Теги — перенос `api/v2/tags.ts`.
 *
 * GET  /tags/{type}            Список тегов типа (name | popular)
 * GET  /tags/{type}/{slug}     Один тег
 * POST /tags/autocomplete      Поиск тегов для подсказок
 */
import { apiGet, buildQuery, nhApi } from "./client";
import { asPage } from "./galleries";
import type { Paginated, Tag, TagType } from "./types";

export interface GetTagsParams {
  sort?: "name" | "popular";
  page?: number;
  per_page?: number;
}

export async function getTagsByType(tagType: TagType, params: GetTagsParams = {}): Promise<Paginated<Tag>> {
  return asPage(await apiGet(`/tags/${tagType}${buildQuery({ ...params })}`, { public: true }));
}

export function getTagBySlug(tagType: TagType, slug: string): Promise<Tag> {
  return apiGet(`/tags/${tagType}/${encodeURIComponent(slug)}`, { public: true });
}

export interface AutocompleteParams {
  query: string;
  type?: TagType;
  limit?: number;
}

export async function autocompleteTags(params: AutocompleteParams): Promise<Tag[]> {
  const raw = await nhApi.post<Tag[] | Paginated<Tag>>(
    "/tags/autocomplete",
    { query: params.query, type: params.type, limit: params.limit ?? 15 },
    { public: true },
  );
  return asPage(raw).result;
}
