/**
 * Чёрный список тегов с аккаунта nhentai — перенос `lib/blacklistFilter.ts`.
 * Кеш на минуту, общий для всех подписчиков. Без входа (и без ключа API) список пустой и не запрашивается.
 * Карточка скрытой книги размывается, в результатах поиска такие книги убираются совсем.
 */
import { useEffect, useMemo, useState } from "react";
import { getBlacklist, getBlacklistIds } from "../api/account";
import type { Book } from "../api/book";
import { hasSession } from "../api/client";

type BlacklistCache = { ids: number[]; names: string[] };
type TagLike = { id: number; name?: string };

const EMPTY: BlacklistCache = { ids: [], names: [] };
const CACHE_TTL_MS = 60_000;

let cache: BlacklistCache | null = null;
let cacheAt = 0;
let inFlight: Promise<BlacklistCache> | null = null;
const listeners = new Set<() => void>();

function store(next: BlacklistCache): BlacklistCache {
  cache = next;
  cacheAt = Date.now();
  for (const fn of listeners) fn();
  return next;
}

const normName = (t: { name?: string }) => String(t?.name || "").trim().toLowerCase();

/** Сразу подставить список (после правки на экране профиля). */
export function setBlacklistCache(tags: TagLike[]): void {
  const safe = Array.isArray(tags) ? tags : [];
  inFlight = null;
  store({ ids: safe.map((t) => t?.id).filter((id) => Number.isFinite(id)), names: safe.map(normName).filter(Boolean) });
}

function canLoad(): boolean {
  return hasSession() || !!import.meta.env.VITE_NHENTAI_API_KEY;
}

async function loadBlacklist(): Promise<BlacklistCache> {
  if (cache && Date.now() - cacheAt < CACHE_TTL_MS) return cache;
  if (!canLoad()) return store(EMPTY);
  if (!inFlight) {
    inFlight = (async () => {
      try {
        const ids = await getBlacklistIds();
        if (ids.length) return store({ ids, names: [] });
      } catch {
        /* попробуем полный список */
      }
      try {
        const tags = (await getBlacklist()).tags ?? [];
        return store({ ids: tags.map((t) => t.id).filter((id) => Number.isFinite(id)), names: tags.map(normName).filter(Boolean) });
      } catch {
        return store(EMPTY);
      } finally {
        inFlight = null;
      }
    })();
  }
  return inFlight;
}

export function refreshBlacklistCache(): Promise<BlacklistCache> {
  cacheAt = 0;
  return loadBlacklist();
}

function useBlacklistState(): BlacklistCache {
  const [state, setState] = useState<BlacklistCache>(cache ?? EMPTY);
  useEffect(() => {
    const sync = () => setState(cache ?? EMPTY);
    listeners.add(sync);
    if (cache == null || Date.now() - cacheAt >= CACHE_TTL_MS) void loadBlacklist();
    else sync();
    return () => {
      listeners.delete(sync);
    };
  }, []);
  return state;
}

export interface BlacklistSets {
  ids: Set<number>;
  names: Set<string>;
}

export function useBlacklistSets(): BlacklistSets {
  const state = useBlacklistState();
  return useMemo(() => ({ ids: new Set(state.ids), names: new Set(state.names) }), [state]);
}

export function isBookBlacklisted(book: Book, { ids, names }: BlacklistSets): boolean {
  if (!ids.size && !names.size) return false;
  const groups = [book.tags, book.artists, book.characters, book.parodies, book.groups, book.categories, book.languages];
  for (const id of book.tagIds) if (ids.has(id)) return true;
  for (const list of groups) {
    for (const tag of list) {
      if (ids.has(tag.id) || (names.size && names.has(normName(tag)))) return true;
    }
  }
  return false;
}
