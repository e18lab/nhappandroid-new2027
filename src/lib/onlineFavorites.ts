/**
 * Онлайн-избранное nhentai — перенос `lib/onlineFavoritesStorage.ts`, `onlineFavoritesStartupSync.ts`,
 * `onlineFavoritesBulk.ts` и `hooks/book/useOnlineFavorite.ts`.
 * id дублируются в `bookFavoritesOnline.v1` (по возрастанию) — из него nappi строит рекомендации.
 */
import { useEffect, useState } from "react";
import { getFavorites } from "../api/account";
import { hasSession } from "../api/client";
import { addFavorite, isFavorited, removeFavorite } from "../api/galleries";
import { getJSON, setJSON } from "./storage";

export const ONLINE_FAVORITES_KEY = "bookFavoritesOnline.v1";
const BULK_DELAY_MS = 120;

export function readOnlineFavoriteIds(): number[] {
  const raw = getJSON<unknown>(ONLINE_FAVORITES_KEY, []);
  return Array.isArray(raw) ? [...new Set(raw.filter((x): x is number => typeof x === "number" && Number.isFinite(x)))] : [];
}

function writeIds(ids: number[]): void {
  setJSON(ONLINE_FAVORITES_KEY, [...new Set(ids.filter(Number.isFinite))].sort((a, b) => a - b));
}

export function addOnlineFavoriteIds(ids: number[]): void {
  if (ids.length) writeIds([...readOnlineFavoriteIds(), ...ids]);
}

export function removeOnlineFavoriteIds(ids: number[]): void {
  if (!ids.length) return;
  const rm = new Set(ids);
  writeIds(readOnlineFavoriteIds().filter((id) => !rm.has(id)));
}

/** Добавить/убрать по одной с паузой, как bulkAddFavoritesV2 / onlineBulkUnfavorite. Возвращает неудачные id. */
export async function bulkSetFavorites(ids: number[], add: boolean, onProgress?: (done: number, total: number) => void) {
  const failed: number[] = [];
  for (let i = 0; i < ids.length; i++) {
    try {
      await (add ? addFavorite(ids[i]) : removeFavorite(ids[i]));
    } catch {
      failed.push(ids[i]);
    }
    onProgress?.(i + 1, ids.length);
    if (i + 1 < ids.length) await new Promise((r) => setTimeout(r, BULK_DELAY_MS));
  }
  const ok = ids.filter((id) => !failed.includes(id));
  if (add) addOnlineFavoriteIds(ok);
  else removeOnlineFavoriteIds(ok);
  return failed;
}

let syncRunning = false;

/** Полный обход GET /favorites (по 100) и замена снимка, если набор изменился — при запуске и после входа. */
export async function syncOnlineFavorites(): Promise<void> {
  if (syncRunning || !hasSession()) return;
  syncRunning = true;
  try {
    const collected = new Set<number>();
    for (let page = 1; ; page++) {
      const res = await getFavorites({ page, per_page: 100 });
      for (const c of res.result) if (Number.isFinite(c.id)) collected.add(c.id);
      if (collected.size >= (res.total || 0) || page >= Math.max(1, res.num_pages)) break;
      await new Promise((r) => setTimeout(r, 80));
    }
    const local = readOnlineFavoriteIds();
    if (local.length !== collected.size || local.some((id) => !collected.has(id))) writeIds([...collected]);
  } catch {
    /* попробуем при следующем запуске */
  } finally {
    syncRunning = false;
  }
}

/** Сердечко на странице книги: состояние с сервера, оптимистичное переключение с откатом. */
export function useOnlineFavorite(galleryId: number, loggedIn: boolean) {
  const [liked, setLiked] = useState(false);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!loggedIn || !galleryId) {
      setLiked(false);
      return;
    }
    setLiked(readOnlineFavoriteIds().includes(galleryId));
    let alive = true;
    isFavorited(galleryId)
      .then((v) => alive && setLiked(v))
      .catch(() => undefined);
    return () => {
      alive = false;
    };
  }, [galleryId, loggedIn]);

  const toggle = async () => {
    if (!loggedIn || loading) return;
    const was = liked;
    setLiked(!was);
    setLoading(true);
    try {
      if (was) {
        await removeFavorite(galleryId);
        removeOnlineFavoriteIds([galleryId]);
      } else {
        await addFavorite(galleryId);
        addOnlineFavoriteIds([galleryId]);
      }
    } catch {
      setLiked(was);
    } finally {
      setLoading(false);
    }
  };

  return { liked, loading, toggle };
}
