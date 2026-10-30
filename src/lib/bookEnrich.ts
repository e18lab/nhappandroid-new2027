/**
 * Догрузка полных данных (теги, дата) для карточек списка.
 * Карточки каталога приходят с `tag_ids` — теги для них берутся из локального справочника тегов
 * (`lib/tagsDb.ts`) без запросов к сети. GET /galleries/:id (понемногу и с кешем) — только для книг
 * без `tag_ids` (например, из локальной библиотеки). Раньше запрос шёл на каждую карточку ленты —
 * сотни запросов при прокрутке.
 */
import { useEffect, useMemo, useState } from "react";
import { galleryToBook, mergeBook, type Book } from "../api/book";
import { ApiError } from "../api/client";
import { getGallery } from "../api/galleries";
import type { Tag } from "../api/types";
import { tagById, toSingular, useTagsDbReady } from "./tagsDb";

const CONCURRENCY = 1;
const GAP_MS = 350;
/** После отказа 429 очередь ждёт, чтобы не мешать основным запросам экрана. */
const BACKOFF_MS = 3000;

const cache = new Map<number, Book>();
const queue: number[] = [];
const queued = new Set<number>();
const listeners = new Set<() => void>();
let running = 0;

export function rememberFullBook(book: Book): void {
  if (book.full) cache.set(book.id, book);
}

export function cachedFullBook(id: number): Book | undefined {
  return cache.get(id);
}

function notify() {
  for (const l of listeners) l();
}

function pump() {
  while (running < CONCURRENCY && queue.length) {
    const id = queue.shift()!;
    running++;
    getGallery(id)
      .then((g) => {
        cache.set(id, galleryToBook(g));
        notify();
      })
      .then(() => GAP_MS)
      .catch((e) => (e instanceof ApiError && e.status === 429 ? BACKOFF_MS : GAP_MS))
      .then((pause) => {
        queued.delete(id);
        window.setTimeout(() => {
          running--;
          pump();
        }, pause);
      });
  }
}

function request(ids: number[]) {
  for (const id of ids) {
    if (cache.has(id) || queued.has(id)) continue;
    queued.add(id);
    queue.push(id);
  }
  pump();
}

const local = new Map<number, Book>();

/** Теги карточки по её `tag_ids` из справочника (язык и категория определяются по id отдельно). */
function withLocalTags(b: Book): Book {
  const hit = local.get(b.id);
  if (hit && hit.tagIds === b.tagIds) return hit;
  const tags: Tag[] = [];
  for (const id of b.tagIds) {
    const t = tagById(id);
    if (t) tags.push({ id, type: toSingular(t.type), name: t.name, count: t.count });
  }
  const by = (type: string) => tags.filter((t) => t.type === type);
  const next = { ...b, tags, artists: by("artist"), characters: by("character"), parodies: by("parody"), groups: by("group") };
  local.set(b.id, next);
  return next;
}

/** Список с подставленными полными данными; недостающие ставятся в очередь (новые — первыми в списке). */
export function useEnrichedBooks(books: Book[]): Book[] {
  const [, bump] = useState(0);
  const tagsReady = useTagsDbReady();

  useEffect(() => {
    const l = () => bump((n) => n + 1);
    listeners.add(l);
    return () => {
      listeners.delete(l);
    };
  }, []);

  useEffect(() => {
    // Новый список важнее старого — сбрасываем ещё не начатые запросы.
    queue.length = 0;
    queued.clear();
    request(books.filter((b) => !b.full && !b.tagIds.length).map((b) => b.id));
    return () => {
      queue.length = 0;
      queued.clear();
    };
  }, [books]);

  return useMemo(
    () =>
      books.map((b) => {
        if (b.full) return b;
        const full = cache.get(b.id);
        if (full) return mergeBook(b, full);
        return tagsReady && b.tagIds.length ? withLocalTags(b) : b;
      }),
    // cache.size растёт при каждой догрузке (а bump перерисовывает компонент)
    [books, cache.size, tagsReady],
  );
}
