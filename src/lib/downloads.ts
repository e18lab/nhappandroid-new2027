/**
 * Скачанные книги — перенос `hooks/book/useDownload.ts`, `lib/downloadProgressStore.ts`,
 * `api/nhappApi/localBook.ts` и чтения папки из `app/downloaded.tsx`.
 *
 * Файлы пишет и читает Rust (`src-tauri/src/downloads.rs`), раскладка как в 1.3.1:
 * `NHAppAndroid/<id>_<название>/<язык>/Image001.jpg … + metadata.json`. Поэтому загрузки старого
 * приложения на телефоне видны сразу. `metadata.json` пишется в формате 1.3.1 (`media`, страницы
 * с `url`/`urlThumb`), читается и старый, и этот.
 *
 * Одновременно качается одна книга, как в старом. Состояние общее (баннер, кнопка на книге, список).
 */
import { useSyncExternalStore } from "react";
import type { Book, BookPage } from "../api/book";
import { imageUrl, pageSources, thumbUrl } from "../api/media";
import type { Tag } from "../api/types";
import "../shell/systemUi";
import { KEYS, getItem } from "./storage";

export const inTauri = () => typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;

async function core() {
  return import("@tauri-apps/api/core");
}

/** Папка из настроек (только ПК; на Android всегда папка приложения). */
function customRoot(): string | null {
  if (window.NHAppNative) return null;
  return getItem(KEYS.savePath) || null;
}

async function toLocalUrl(path: string): Promise<string> {
  return (await core()).convertFileSrc(path);
}

// ─── Состояние загрузки ───────────────────────────────────────────────────────

export type DownloadResult = "saved" | "failed" | "canceled";

export interface DownloadState {
  active: boolean;
  bookId: number | null;
  title: string | null;
  cover: string | null;
  /** 0..1 */
  progress: number;
  lastFinishedAt: number;
  lastFinishedBookId: number | null;
  /** Последний итог — для уведомления (показывает баннер, он смонтирован всегда). */
  lastResult: { result: DownloadResult; at: number; message?: string } | null;
}

let state: DownloadState = {
  active: false,
  bookId: null,
  title: null,
  cover: null,
  progress: 0,
  lastFinishedAt: 0,
  lastFinishedBookId: null,
  lastResult: null,
};
const listeners = new Set<() => void>();

function patch(next: Partial<DownloadState>) {
  state = { ...state, ...next };
  for (const fn of listeners) fn();
}

export function useDownloadState(): DownloadState {
  return useSyncExternalStore(
    (cb) => {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
    () => state,
  );
}

let progressListening = false;
async function listenProgress() {
  if (progressListening) return;
  progressListening = true;
  const { listen } = await import("@tauri-apps/api/event");
  await listen<{ id: number; done: number; total: number }>("nh-download", ({ payload }) => {
    if (state.active && payload.id === state.bookId && payload.total > 0) patch({ progress: payload.done / payload.total });
  });
}

// ─── metadata.json ↔ Book ─────────────────────────────────────────────────────

type LegacyPage = { page?: number; url?: string; urlThumb?: string; width?: number; height?: number };

/** Книга → metadata.json в формате 1.3.1 (`Book` из api/nhappApi/types.ts). */
function toLegacyMeta(book: Book): string {
  const pages: LegacyPage[] = book.pages.map((p) => ({
    page: p.page,
    url: imageUrl(p.path),
    urlThumb: thumbUrl(p.thumb || p.path),
    width: p.width ?? 0,
    height: p.height ?? 0,
  }));
  return JSON.stringify({
    id: book.id,
    title: book.title,
    uploaded: book.uploaded,
    media: book.mediaId,
    favorites: book.favorites,
    pagesCount: book.pagesCount || book.pages.length,
    scanlator: book.scanlator,
    tags: book.tags,
    cover: thumbUrl(book.cover),
    coverW: book.coverW,
    coverH: book.coverH,
    thumbnail: thumbUrl(book.thumbnail),
    pages,
    artists: book.artists,
    characters: book.characters,
    parodies: book.parodies,
    groups: book.groups,
    categories: book.categories,
    languages: book.languages,
    tagIds: book.tagIds,
  });
}

const tags = (v: unknown): Tag[] => (Array.isArray(v) ? (v as Tag[]) : []);

/** metadata.json (1.3.1 или этого приложения) + локальные адреса страниц → книга. */
function fromMeta(raw: string, localPages: string[]): Book | null {
  let m: Record<string, unknown>;
  try {
    m = JSON.parse(raw);
  } catch {
    return null;
  }
  const id = Number(m.id);
  if (!Number.isFinite(id) || id <= 0) return null;
  const t = (m.title ?? {}) as Partial<Book["title"]>;
  const metaPages = Array.isArray(m.pages) ? (m.pages as LegacyPage[]) : [];
  const pages: BookPage[] = localPages.map((url, i) => ({
    page: i + 1,
    path: url,
    thumb: url,
    width: metaPages[i]?.width || undefined,
    height: metaPages[i]?.height || undefined,
  }));
  const cover = localPages[0] ?? "";
  return {
    id,
    title: { english: t.english ?? "", japanese: t.japanese ?? "", pretty: t.pretty || t.english || "" },
    uploaded: typeof m.uploaded === "string" ? m.uploaded : "",
    mediaId: String(m.mediaId ?? m.media ?? ""),
    favorites: Number(m.favorites) || 0,
    pagesCount: Number(m.pagesCount) || localPages.length,
    scanlator: typeof m.scanlator === "string" ? m.scanlator : "",
    tags: tags(m.tags),
    artists: tags(m.artists),
    characters: tags(m.characters),
    parodies: tags(m.parodies),
    groups: tags(m.groups),
    categories: tags(m.categories),
    languages: tags(m.languages),
    tagIds: Array.isArray(m.tagIds) ? (m.tagIds as number[]) : [],
    cover,
    coverW: metaPages[0]?.width || (Number(m.coverW) || undefined),
    coverH: metaPages[0]?.height || (Number(m.coverH) || undefined),
    thumbnail: cover,
    pages,
    full: true,
  };
}

interface RawLocal {
  id: number;
  dir: string;
  meta: string;
  images: string[];
  downloadedAt: number;
}

async function toBook(raw: RawLocal): Promise<Book | null> {
  const urls = await Promise.all(raw.images.map(toLocalUrl));
  return fromMeta(raw.meta, urls);
}

// ─── Команды ──────────────────────────────────────────────────────────────────

export interface DownloadedBook extends Book {
  downloadedAt: number;
}

/** Скачанные книги (только обложка, без страниц). */
export async function listDownloads(): Promise<DownloadedBook[]> {
  if (!inTauri()) return [];
  const raw = await (await core()).invoke<RawLocal[]>("list_downloads", { custom: customRoot() });
  const books = await Promise.all(
    raw.map(async (r) => {
      const b = await toBook(r);
      return b ? ({ ...b, pages: [], downloadedAt: r.downloadedAt } as DownloadedBook) : null;
    }),
  );
  return books.filter((b): b is DownloadedBook => !!b);
}

/** Скачанная книга целиком (страницы — локальные файлы) или null. */
export async function loadLocalBook(id: number): Promise<Book | null> {
  if (!inTauri()) return null;
  try {
    const raw = await (await core()).invoke<RawLocal | null>("read_download", { custom: customRoot(), id });
    return raw ? await toBook(raw) : null;
  } catch {
    return null;
  }
}

export async function deleteDownload(id: number): Promise<boolean> {
  if (!inTauri()) return false;
  const ok = await (await core()).invoke<boolean>("delete_download", { custom: customRoot(), id });
  if (ok) patch({ lastFinishedAt: Date.now(), lastFinishedBookId: id });
  return ok;
}

export async function cancelDownload(id: number): Promise<void> {
  if (!inTauri()) return;
  await (await core()).invoke("cancel_download", { id });
}

/**
 * Скачать книгу (нужны страницы — полная книга). Итог виден в `lastResult`;
 * "busy" — уже качается другая.
 */
export async function downloadBook(book: Book): Promise<DownloadResult | "busy"> {
  if (!inTauri() || !book.pages.length) return "failed";
  if (state.active) return "busy";
  void listenProgress();
  patch({ active: true, bookId: book.id, title: book.title.pretty, cover: book.cover, progress: 0 });
  let result: DownloadResult = "saved";
  let message: string | undefined;
  try {
    await (await core()).invoke<string>("download_book", {
      custom: customRoot(),
      id: book.id,
      title: book.title.pretty,
      // Как в 1.3.1: первый тег языка как есть (бывает и "translated") — пути совпадают со старыми
      lang: book.languages[0]?.name ?? "Unknown",
      pages: book.pages.map((p) => pageSources(p.path)),
      meta: toLegacyMeta(book),
    });
  } catch (e) {
    message = String(e);
    result = message.includes("cancelled") ? "canceled" : "failed";
  }
  patch({
    active: false,
    bookId: null,
    title: null,
    cover: null,
    progress: 0,
    lastResult: { result, at: Date.now(), message },
    ...(result === "saved" ? { lastFinishedAt: Date.now(), lastFinishedBookId: book.id } : {}),
  });
  return result;
}

/** Папка загрузок (для настроек). */
export async function downloadsDir(): Promise<string> {
  if (!inTauri()) return "";
  return (await core()).invoke<string>("downloads_dir", { custom: customRoot() });
}
