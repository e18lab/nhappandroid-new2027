/**
 * Аккаунт nhentai — перенос `api/v2/favorites.ts`, `blacklist.ts`, `user.ts`, `users.ts`.
 * Всё, кроме публичного профиля, требует входа (токен) или ключа API.
 */
import { buildQuery, nhApi } from "./client";
import { asPage } from "./galleries";
import type { ApiKey, Blacklist, GalleryCard, Me, Paginated, SuccessResponse, UserProfile } from "./types";

// ─── Онлайн-избранное: GET /favorites, /favorites/random ──────────────────────

export interface FavoritesParams {
  /** Поиск внутри избранного. */
  q?: string;
  page?: number;
  per_page?: number;
}

export async function getFavorites(params: FavoritesParams = {}): Promise<Paginated<GalleryCard>> {
  return asPage(await nhApi.get(`/favorites${buildQuery({ ...params })}`));
}

export async function getRandomFavoriteId(): Promise<number> {
  const res = await nhApi.get<{ id: number }>("/favorites/random");
  return Number(res.id);
}

// ─── Чёрный список: GET /blacklist, /blacklist/ids, POST /blacklist ───────────

export function getBlacklist(): Promise<Blacklist> {
  return nhApi.get("/blacklist");
}

/** Только id тегов — дешевле полного списка. */
export async function getBlacklistIds(): Promise<number[]> {
  const res = await nhApi.get<{ ids: number[] }>("/blacklist/ids");
  return res.ids ?? [];
}

export function updateBlacklist(params: { added?: number[]; removed?: number[] }): Promise<SuccessResponse & { count: number }> {
  return nhApi.post("/blacklist", { added: params.added ?? [], removed: params.removed ?? [] });
}

// ─── Свой профиль: /user, /user/avatar, /user/keys ────────────────────────────

let getMeInflight: Promise<Me> | null = null;

/** GET /user — параллельные вызовы (старт, меню, хуки) делят один запрос. */
export function getMe(): Promise<Me> {
  if (!getMeInflight) {
    getMeInflight = nhApi.get<Me>("/user").finally(() => {
      getMeInflight = null;
    });
  }
  return getMeInflight;
}

export interface UpdateProfileParams {
  username?: string;
  email?: string;
  about?: string;
  favorite_tags?: string;
  current_password?: string;
  new_password?: string;
  remove_avatar?: boolean;
}

export function updateProfile(
  params: UpdateProfileParams,
): Promise<SuccessResponse & { username: string; email: string; avatar_url: string }> {
  return nhApi.put("/user", params);
}

export function deleteAccount(): Promise<SuccessResponse> {
  return nhApi.delete("/user");
}

/** Новый аватар: файл уходит multipart-полем `avatar`. */
export function uploadAvatar(file: Blob, filename = "avatar.jpg"): Promise<SuccessResponse & { avatar_url: string }> {
  const form = new FormData();
  form.append("avatar", file, filename);
  return nhApi.post("/user/avatar", form);
}

export function listApiKeys(): Promise<ApiKey[]> {
  return nhApi.get("/user/keys");
}

export function createApiKey(name: string): Promise<ApiKey & { key: string }> {
  return nhApi.post("/user/keys", { name });
}

export function revokeApiKey(keyId: string): Promise<SuccessResponse> {
  return nhApi.delete(`/user/keys/${keyId}`);
}

// ─── Публичный профиль: GET /users/{id}/{slug} ────────────────────────────────

export function getUserProfile(userId: number, slug: string): Promise<UserProfile> {
  return nhApi.get(`/users/${userId}/${encodeURIComponent(slug)}`, {
    headers: { "Cache-Control": "no-cache", Pragma: "no-cache" },
  });
}
