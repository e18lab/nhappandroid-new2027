/**
 * Избранные теги и коллекции тегов — перенос `components/tags/useFavs.ts` и `context/TagLibraryContext.tsx`.
 * Ключи как в старом: `tag.favs.v1` — { "tags:name": true }, `tagCollections.v1` — список коллекций.
 */
import { useEffect, useState } from "react";
import { getJSON, setJSON, subscribe } from "./storage";
import { toPlural, type TagKind, type TagMode } from "./tagsDb";

const FAV_KEY = "tag.favs.v1";
const COLLECTIONS_KEY = "tagCollections.v1";

export interface CollectionItem {
  type: string;
  name: string;
  mode: TagMode;
}

export interface TagCollection {
  id: string;
  name: string;
  items: CollectionItem[];
  createdAt: number;
  updatedAt: number;
}

const favKeyOf = (t: { type: string; name: string }) => `${toPlural(String(t.type))}:${t.name}`;

/** Старые записи бывали с типом в единственном числе — приводим к `tags:…`. */
function loadFavs(): Record<string, true> {
  const raw = getJSON<Record<string, unknown> | null>(FAV_KEY, null);
  const out: Record<string, true> = {};
  if (!raw || typeof raw !== "object") return out;
  for (const k of Object.keys(raw)) {
    const [type, ...rest] = k.split(":");
    out[`${toPlural(type)}:${rest.join(":")}`] = true;
  }
  return out;
}

function useStored<T>(key: string, read: () => T): T {
  const [value, setValue] = useState(read);
  useEffect(() => subscribe((k) => k === key && setValue(read())), [key, read]);
  return value;
}

export function useTagFavs() {
  const favs = useStored(FAV_KEY, loadFavs);
  return {
    favs,
    isFav: (t: { type: string; name: string }) => !!favs[favKeyOf(t)],
    toggleFav: (t: { type: string; name: string }) => {
      const next = { ...loadFavs() };
      const k = favKeyOf(t);
      if (next[k]) delete next[k];
      else next[k] = true;
      setJSON(FAV_KEY, next);
    },
  };
}

function loadCollections(): TagCollection[] {
  const raw = getJSON<unknown>(COLLECTIONS_KEY, []);
  return Array.isArray(raw) ? (raw as TagCollection[]).filter((c) => c && Array.isArray(c.items)) : [];
}

export function useTagCollections(): TagCollection[] {
  return useStored(COLLECTIONS_KEY, loadCollections);
}

export function saveCollection(id: string | null, name: string, items: CollectionItem[]): void {
  const now = Date.now();
  const list = loadCollections();
  if (id) {
    setJSON(
      COLLECTIONS_KEY,
      list.map((c) => (c.id === id ? { ...c, name, items: items.slice(), updatedAt: now } : c)),
    );
  } else {
    const newId = `col_${now.toString(36)}_${Math.random().toString(36).slice(2, 7)}`;
    setJSON(COLLECTIONS_KEY, [...list, { id: newId, name, items, createdAt: now, updatedAt: now }]);
  }
}

export function deleteCollection(id: string): void {
  setJSON(
    COLLECTIONS_KEY,
    loadCollections().filter((c) => c.id !== id),
  );
}

export type { TagKind };
