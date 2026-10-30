/**
 * Догрузка полных данных (теги, дата) для карточек списка.
 * В старом приложении это делал BookList через сервер nhapp пачками (recommendation-lib);
 * пока сервер не перенесён (этап 8), берём GET /galleries/:id — понемногу и с кешем.
 */
import { useEffect, useMemo, useState } from "react";
import { galleryToBook, mergeBook, type Book } from "../api/book";
import { ApiError } from "../api/client";
import { getGallery } from "../api/galleries";

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

/** Список с подставленными полными данными; недостающие ставятся в очередь (новые — первыми в списке). */
export function useEnrichedBooks(books: Book[]): Book[] {
  const [, bump] = useState(0);

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
    request(books.filter((b) => !b.full).map((b) => b.id));
    return () => {
      queue.length = 0;
      queued.clear();
    };
  }, [books]);

  return useMemo(
    () => books.map((b) => (b.full ? b : cache.has(b.id) ? mergeBook(b, cache.get(b.id)!) : b)),
    // cache.size растёт при каждой догрузке (а bump перерисовывает компонент)
    [books, cache.size],
  );
}
