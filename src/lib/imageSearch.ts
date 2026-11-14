/**
 * Поиск по картинке — перенос `api/nhappApi/imsearchClient.ts` и `lib/imsearchPendingUpload.ts`.
 * Файл уходит на сервер nappi (`POST /api/imsearch/search`), тот спрашивает внешний поиск; совпадения — лучшими вперёд.
 *
 * Последний поиск живёт здесь, а не в экране: экран размонтируется при переходе в книгу,
 * и «назад» должно вернуть те же результаты без повторной загрузки файла.
 */
import type { Book } from "../api/book";
import { API_BASE_URL } from "../config/api";

interface Match {
  galleryId: string;
  title?: string;
  score: number;
  previewImageUrl?: string;
  page?: number;
}

export interface ImageSearchSession {
  token: string;
  file: File;
  books: Book[] | null;
}

const MAX_ATTEMPTS = 4;
/** Внешний поиск отвечает долго, а сервер может ещё и обновлять его сессию. */
const TIMEOUT_MS = 90_000;
const RETRY_STATUS = new Set([408, 429, 502, 503, 504]);

let session: ImageSearchSession | null = null;

export function startImageSearch(file: File): string {
  session = { token: String(Date.now()), file, books: null };
  return session.token;
}

/** Поиск с этим адресом; null — файл не сохранился (приложение перезапускали). */
export function getImageSearch(token: string | null): ImageSearchSession | null {
  return session && session.token === token ? session : null;
}

class SearchError extends Error {
  constructor(
    message: string,
    readonly status?: number,
  ) {
    super(message);
  }
}

async function postOnce(file: File, signal: AbortSignal): Promise<Match[]> {
  const body = new FormData();
  body.append("file", file);
  // Вручную, а не AbortSignal.any: его нет в WebView старых версий Android
  const abort = new AbortController();
  const stop = () => abort.abort();
  const timer = window.setTimeout(stop, TIMEOUT_MS);
  signal.addEventListener("abort", stop);
  try {
    // Заголовок Content-Type со своей границей multipart браузер ставит сам
    const res = await fetch(`${API_BASE_URL}/api/imsearch/search`, { method: "POST", body, signal: abort.signal });
    const data = (await res.json().catch(() => ({}))) as { matches?: Match[]; message?: string; error?: string };
    if (!res.ok) throw new SearchError(data.message || data.error || `HTTP ${res.status}`, res.status);
    return Array.isArray(data.matches) ? data.matches : [];
  } finally {
    window.clearTimeout(timer);
    signal.removeEventListener("abort", stop);
  }
}

function matchToBook(m: Match, id: number): Book {
  const pretty = String(m.title || `#${id}`).trim();
  const cover = String(m.previewImageUrl || "").trim();
  return {
    id,
    title: { english: pretty, japanese: pretty, pretty },
    uploaded: "",
    mediaId: "",
    favorites: 0,
    pagesCount: 0,
    scanlator: "",
    tags: [],
    artists: [],
    characters: [],
    parodies: [],
    groups: [],
    categories: [],
    languages: [],
    tagIds: [],
    cover,
    thumbnail: cover,
    pages: [],
    full: false,
  };
}

/** Выполнить поиск: временные ошибки сети и сервера повторяются, результат запоминается в сессии. */
export async function runImageSearch(current: ImageSearchSession, signal: AbortSignal): Promise<Book[]> {
  let matches: Match[] = [];
  for (let attempt = 1; ; attempt++) {
    try {
      matches = await postOnce(current.file, signal);
      break;
    } catch (e) {
      if (signal.aborted) throw e;
      // Ошибка без статуса — сбой сети или таймаут
      const status = e instanceof SearchError ? e.status : undefined;
      if (attempt >= MAX_ATTEMPTS || (status !== undefined && !RETRY_STATUS.has(status))) throw e;
      await new Promise((r) => setTimeout(r, 350 * attempt));
    }
  }
  const seen = new Set<number>();
  current.books = matches
    .filter((m) => /^\d+$/.test(String(m.galleryId ?? "").trim()))
    .sort((a, b) => (Number(b.score) || 0) - (Number(a.score) || 0))
    .flatMap((m) => {
      const id = Number(String(m.galleryId).trim());
      if (seen.has(id)) return [];
      seen.add(id);
      return [matchToBook(m, id)];
    });
  return current.books;
}
