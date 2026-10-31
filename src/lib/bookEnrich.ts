/**
 * Догрузка полных данных (теги, дата) для карточек списка.
 * Карточки каталога приходят с `tag_ids` — теги для них берутся из локального справочника тегов
 * (`lib/tagsDb.ts`) без запросов к сети. Книги без `tag_ids` (закладки, история) догружаются так:
 *   1. пачкой до 100 id с сервера nappi (`/recommendation-lib/books/batch`, как в старом приложении) —
 *      сотни карточек за один-два запроса;
 *   2. чего там нет — GET /galleries/:id у nhentai: по 3 запроса сразу, видимые карточки первыми,
 *      на 429 вся очередь ждёт (Retry-After или нарастающая пауза), запрос не теряется.
 * Данные карточек хранятся между запусками (`@nh.bookCards.v1`, в облако не синхронизируется).
 */
import { useEffect, useMemo, useState, type RefObject } from "react";
import { galleryToBook, mergeBook, type Book } from "../api/book";
import { ApiError } from "../api/client";
import { getGallery } from "../api/galleries";
import { getBooksBatch, type NappiBook } from "../api/nappi";
import type { Tag } from "../api/types";
import { tagById, toSingular, useTagsDbReady } from "./tagsDb";

const BATCH_SIZE = 100;
const BATCH_DELAY_MS = 30;
const NH_CONCURRENCY = 3;
const NH_GAP_MS = 200;
/** Пауза всей очереди после 429, удваивается до максимума, сбрасывается после успеха. */
const BACKOFF_MS = 3000;
const BACKOFF_MAX_MS = 30000;
const PERSIST_KEY = "@nh.bookCards.v1";
const PERSIST_MAX = 1200;
const PERSIST_DELAY_MS = 1500;

/** Полные книги с nhentai (со страницами) — их же открывают экраны книги и читалки. */
const cache = new Map<number, Book>();
/** Данные для карточки (без страниц): с nappi, из сохранённого или урезанные полные. */
const cards = new Map<number, Book>();
const listeners = new Set<() => void>();
let version = 0;

/** Сколько списков сейчас ждут книгу: кого никто не ждёт, из очереди выкидываем. */
const wanted = new Map<number, number>();
const visible = new Set<number>();

const has = (id: number) => cache.has(id) || cards.has(id);

export function rememberFullBook(book: Book): void {
  if (!book.full) return;
  cache.set(book.id, book);
  putCard(book);
}

export function cachedFullBook(id: number): Book | undefined {
  return cache.get(id);
}

// ─── Уведомления и хранение ───────────────────────────────────────────────────

let notifyTimer = 0;
function notify() {
  if (notifyTimer) return;
  notifyTimer = window.setTimeout(() => {
    notifyTimer = 0;
    version++;
    for (const l of listeners) l();
  }, 50);
}

function putCard(book: Book) {
  cards.delete(book.id);
  cards.set(book.id, { ...book, pages: [] });
  schedulePersist();
}

type StoredTag = [type: string, name: string, id: number];
interface StoredCard {
  i: number;
  t: [string, string, string];
  u: string;
  m: string;
  p: number;
  c: string;
  g: StoredTag[];
  d: number[];
}

function pack(b: Book): StoredCard {
  const seen = new Set<string>();
  const g: StoredTag[] = [];
  for (const t of [...b.tags, ...b.artists, ...b.characters, ...b.parodies, ...b.groups, ...b.categories, ...b.languages]) {
    const k = `${t.type}:${t.name}`;
    if (seen.has(k)) continue;
    seen.add(k);
    g.push([t.type, t.name, t.id]);
  }
  return { i: b.id, t: [b.title.english, b.title.japanese, b.title.pretty], u: b.uploaded, m: b.mediaId, p: b.pagesCount, c: b.cover, g, d: b.tagIds };
}

function unpack(s: StoredCard): Book {
  return makeBook(
    s.i,
    { english: s.t[0], japanese: s.t[1], pretty: s.t[2] },
    s.g.map(([type, name, id]) => ({ id, type, name })),
    { uploaded: s.u, mediaId: s.m, pagesCount: s.p, cover: s.c, tagIds: s.d },
  );
}

let persistTimer = 0;
function schedulePersist() {
  if (persistTimer) return;
  persistTimer = window.setTimeout(() => {
    persistTimer = 0;
    const all = [...cards.values()].slice(-PERSIST_MAX).map(pack);
    for (let n = all.length; n > 0; n = Math.floor(n / 2)) {
      try {
        localStorage.setItem(PERSIST_KEY, JSON.stringify(all.slice(-n)));
        return;
      } catch {
        /* не влезло — сохраняем вдвое меньше свежих */
      }
    }
  }, PERSIST_DELAY_MS);
}

function restore() {
  try {
    const raw = localStorage.getItem(PERSIST_KEY);
    if (!raw) return;
    for (const s of JSON.parse(raw) as StoredCard[]) cards.set(s.i, unpack(s));
  } catch {
    /* битые данные — начнём заново */
  }
}
restore();

// ─── Модель ───────────────────────────────────────────────────────────────────

function makeBook(
  id: number,
  title: Book["title"],
  tags: Tag[],
  rest: Pick<Book, "uploaded" | "mediaId" | "pagesCount" | "cover" | "tagIds">,
): Book {
  const by = (type: string) => tags.filter((t) => t.type === type);
  return {
    id,
    title,
    favorites: 0,
    scanlator: "",
    tags,
    artists: by("artist"),
    characters: by("character"),
    parodies: by("parody"),
    groups: by("group"),
    categories: by("category"),
    languages: by("language"),
    thumbnail: rest.cover,
    pages: [],
    full: true,
    ...rest,
  };
}

function nappiToBook(r: NappiBook): Book {
  const named = (list: string[] | null, type: string): Tag[] =>
    (list ?? []).filter(Boolean).map((name) => ({ id: 0, type, name: String(name) }));
  const tags = [
    ...named(r.tags, "tag"),
    ...named(r.artists, "artist"),
    ...named(r.parodies, "parody"),
    ...named(r.characters, "character"),
    ...named(r.groups, "group"),
    ...named(r.categories, "category"),
    ...named(r.languages, "language"),
  ];
  const english = r.title_english ?? "";
  // Расширение обложки сервер не хранит: jpg у старых книг, остальное переберёт thumbSources
  const cover = r.media_id ? `/galleries/${r.media_id}/thumb.jpg` : "";
  return makeBook(Number(r.book_id), { english, japanese: r.title_japanese ?? "", pretty: r.title_pretty || english }, tags, {
    uploaded: r.uploaded_at ?? "",
    mediaId: r.media_id ?? "",
    pagesCount: r.pages ?? 0,
    cover,
    tagIds: r.tag_ids ?? [],
  });
}

// ─── Этап 1: пачкой с nappi ───────────────────────────────────────────────────

const batchPending = new Set<number>();
/** На nappi уже спрашивали (нет там или сервер недоступен) — дальше только nhentai. */
const nappiTried = new Set<number>();
let batchTimer = 0;
let batchRunning = false;

function scheduleBatch() {
  if (batchTimer || batchRunning) return;
  batchTimer = window.setTimeout(() => {
    batchTimer = 0;
    void runBatches();
  }, BATCH_DELAY_MS);
}

async function runBatches() {
  batchRunning = true;
  try {
    while (batchPending.size) {
      const ids = [...batchPending].filter((id) => wanted.has(id) && !has(id));
      batchPending.clear();
      ids.sort((a, b) => Number(visible.has(b)) - Number(visible.has(a)));
      for (let i = 0; i < ids.length; i += BATCH_SIZE) {
        const chunk = ids.slice(i, i + BATCH_SIZE);
        for (const id of chunk) nappiTried.add(id);
        try {
          const { books } = await getBooksBatch(chunk);
          for (const r of books) putCard(nappiToBook(r));
        } catch {
          /* сервер недоступен — всё уйдёт на nhentai */
        }
        notify();
        nhEnqueue(chunk.filter((id) => !has(id)));
      }
    }
  } finally {
    batchRunning = false;
  }
}

// ─── Этап 2: по одной с nhentai ───────────────────────────────────────────────

const nhQueue: number[] = [];
const nhQueued = new Set<number>();
/** Ошибка не 429 (книги нет, сеть) — в этой сессии больше не просим. */
const nhFailed = new Set<number>();
let nhRunning = 0;
let pausedUntil = 0;
let pauseTimer = 0;
let backoff = BACKOFF_MS;

function nhEnqueue(ids: number[]) {
  for (const id of ids) {
    if (has(id) || nhQueued.has(id) || nhFailed.has(id)) continue;
    nhQueued.add(id);
    nhQueue.push(id);
  }
  nhPump();
}

/** Следующая книга: сначала видимая, кого уже никто не ждёт — выкидываем. */
function nhTake(): number | undefined {
  for (let i = nhQueue.length - 1; i >= 0; i--) {
    const id = nhQueue[i];
    if (!wanted.has(id) || has(id)) {
      nhQueue.splice(i, 1);
      nhQueued.delete(id);
    }
  }
  let idx = nhQueue.findIndex((id) => visible.has(id));
  if (idx < 0) idx = 0;
  const id = nhQueue.splice(idx, 1)[0];
  if (id !== undefined) nhQueued.delete(id);
  return id;
}

function nhPump() {
  if (pauseTimer) return;
  const wait = pausedUntil - Date.now();
  if (wait > 0) {
    pauseTimer = window.setTimeout(() => {
      pauseTimer = 0;
      nhPump();
    }, wait);
    return;
  }
  while (nhRunning < NH_CONCURRENCY && Date.now() >= pausedUntil) {
    const id = nhTake();
    if (id === undefined) return;
    nhRunning++;
    getGallery(id, undefined, { noRetry: true })
      .then((g) => {
        rememberFullBook(galleryToBook(g));
        backoff = BACKOFF_MS;
        notify();
      })
      .catch((e) => {
        if (e instanceof ApiError && e.status === 429) {
          pausedUntil = Math.max(pausedUntil, Date.now() + (e.retryAfterMs ?? backoff));
          backoff = Math.min(backoff * 2, BACKOFF_MAX_MS);
          if (!nhQueued.has(id)) {
            nhQueued.add(id);
            nhQueue.unshift(id);
          }
        } else nhFailed.add(id);
      })
      .finally(() => {
        window.setTimeout(() => {
          nhRunning--;
          nhPump();
        }, NH_GAP_MS);
      });
  }
}

function request(ids: number[]) {
  for (const id of ids) {
    if (has(id)) continue;
    if (nappiTried.has(id)) nhEnqueue([id]);
    else batchPending.add(id);
  }
  if (batchPending.size) scheduleBatch();
}

// ─── Видимость ────────────────────────────────────────────────────────────────

let observer: IntersectionObserver | null = null;
const observed = new Map<Element, number>();

function getObserver(): IntersectionObserver | null {
  if (observer || typeof IntersectionObserver === "undefined") return observer;
  observer = new IntersectionObserver(
    (entries) => {
      for (const e of entries) {
        const id = observed.get(e.target);
        if (id === undefined) continue;
        if (e.isIntersecting) visible.add(id);
        else visible.delete(id);
      }
    },
    { rootMargin: "400px 0px" },
  );
  return observer;
}

/** Карточка на экране (или рядом) — её книгу догружать первой. */
export function useEnrichPriority(ref: RefObject<Element | null>, id: number, pending: boolean): void {
  useEffect(() => {
    const el = ref.current;
    const io = pending ? getObserver() : null;
    if (!el || !io) return;
    observed.set(el, id);
    io.observe(el);
    return () => {
      io.unobserve(el);
      observed.delete(el);
      visible.delete(id);
    };
  }, [ref, id, pending]);
}

// ─── Хук ──────────────────────────────────────────────────────────────────────

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

/** Список с подставленными полными данными; недостающие догружаются (см. шапку файла). */
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
    const ids = books.filter((b) => !b.full && !b.tagIds.length).map((b) => b.id);
    for (const id of ids) wanted.set(id, (wanted.get(id) ?? 0) + 1);
    request(ids);
    return () => {
      for (const id of ids) {
        const n = (wanted.get(id) ?? 1) - 1;
        if (n > 0) wanted.set(id, n);
        else wanted.delete(id);
      }
    };
  }, [books]);

  return useMemo(
    () =>
      books.map((b) => {
        if (b.full) return b;
        const full = cache.get(b.id) ?? cards.get(b.id);
        if (full) return mergeBook(b, full);
        return tagsReady && b.tagIds.length ? withLocalTags(b) : b;
      }),
    // version растёт при каждой догрузке (а bump перерисовывает компонент)
    [books, version, tagsReady],
  );
}
