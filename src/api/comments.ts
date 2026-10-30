/**
 * Комментарии — перенос `api/v2/comments.ts`.
 *
 * GET    /galleries/{id}/comments        Все комментарии книги
 * GET    /galleries/{id}/comments/count  Число комментариев
 * POST   /galleries/{id}/comments        Написать (вход + PoW `comment` + капча)
 * DELETE /comments/{id}                  Удалить (автор или staff)
 * POST   /comments/{id}/flag             Пожаловаться
 */
import { apiGet, nhApi } from "./client";
import { asPage } from "./galleries";
import type { Comment, Paginated, SuccessResponse } from "./types";

/** Одна страница (по 50, `per_page` API не принимает). */
export async function getGalleryCommentsPage(galleryId: number, page = 1): Promise<Paginated<Comment>> {
  return asPage(
    await apiGet<Comment[] | Paginated<Comment>>(`/galleries/${galleryId}/comments${page > 1 ? `?page=${page}` : ""}`, {
      public: true,
    }),
  );
}

/** Все комментарии книги: страницы подряд (старое приложение брало только первые 50). */
export async function getGalleryComments(galleryId: number, maxPages = 20): Promise<Comment[]> {
  const first = await getGalleryCommentsPage(galleryId, 1);
  const all = [...first.result];
  for (let page = 2; page <= Math.min(first.num_pages, maxPages); page++) {
    all.push(...(await getGalleryCommentsPage(galleryId, page)).result);
  }
  return all;
}

export async function getCommentsCount(galleryId: number): Promise<number> {
  const res = await apiGet<{ count?: number }>(`/galleries/${galleryId}/comments/count`, { public: true });
  return Number(res.count) || 0;
}

export interface PostCommentParams {
  body: string;
  /** Задача из `getPowChallenge("comment")` и решение `solvePoW`. */
  pow_challenge: string;
  pow_nonce: string;
  captcha_response?: string;
}

export function postComment(galleryId: number, params: PostCommentParams): Promise<Comment> {
  return nhApi.post(`/galleries/${galleryId}/comments`, params);
}

export function deleteComment(commentId: number): Promise<SuccessResponse> {
  return nhApi.delete(`/comments/${commentId}`);
}

export function flagComment(commentId: number, reason: string): Promise<SuccessResponse> {
  return nhApi.post(`/comments/${commentId}/flag`, { reason });
}
