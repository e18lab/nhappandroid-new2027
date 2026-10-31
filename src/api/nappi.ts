/**
 * REST своего бэкенда (nappi) — перенос `api/nhappApi/users.ts` и части `cloudStorage.ts`.
 * Сервер открыт для CORS, поэтому хватает обычного fetch (адрес разрешён в CSP).
 * Ошибки здесь не критичны: вызывающие глушат их, как старое приложение.
 */
import { version } from "../../package.json";
import { API_BASE_URL, API_TIMEOUT_MS } from "../config/api";

export const APP_VERSION: string = version;

async function request(path: string, init: RequestInit & { userId?: number } = {}): Promise<Response> {
  const { userId, headers, ...rest } = init;
  const res = await fetch(`${API_BASE_URL}${path}`, {
    ...rest,
    headers: {
      "Content-Type": "application/json",
      ...(userId != null ? { "x-user-id": String(userId) } : {}),
      ...(headers as Record<string, string> | undefined),
    },
    signal: AbortSignal.timeout(API_TIMEOUT_MS),
  });
  if (!res.ok) throw new Error(`${path}: HTTP ${res.status}`);
  return res;
}

/** Регистрация пользователя и устройства на сервере (`useOnlineMe` в старом). */
export async function syncUser(params: {
  id: number;
  username: string;
  deviceId: string;
  deviceName: string;
}): Promise<void> {
  await request("/api/users/sync", { method: "POST", body: JSON.stringify({ ...params, appVersion: APP_VERSION }) });
}

/** Отметить пользователя онлайн (last_online_at + last_seen устройства). */
export async function touchOnline(userId: number, deviceId: string): Promise<void> {
  await request("/api/users/me/online", { method: "PATCH", userId, body: JSON.stringify({ deviceId }) });
}

/** Книга из библиотеки сервера (`/api/recommendation-lib/books/batch`): метаданные и имена тегов без nhentai. */
export interface NappiBook {
  book_id: string | number;
  media_id: string | null;
  title_english: string | null;
  title_japanese: string | null;
  title_pretty: string | null;
  parodies: string[] | null;
  characters: string[] | null;
  artists: string[] | null;
  groups: string[] | null;
  languages: string[] | null;
  categories: string[] | null;
  pages: number | null;
  uploaded_at: string | null;
  tag_ids: number[] | null;
  tags: string[] | null;
  /** Машинный перевод названия — только при запросе с `titleLocale`. */
  title_translated?: string | null;
}

/** До 500 книг одним запросом (как `fetchBooksFromRecommendationLib` в старом); `missing` — каких на сервере нет. */
export async function getBooksBatch(ids: number[], titleLocale?: string): Promise<{ books: NappiBook[]; missing: number[] }> {
  const res = await request(`/api/recommendation-lib/books/batch?q=${ids.join(",")}${titleLocale ? `&title_locale=${titleLocale}` : ""}`);
  const data = (await res.json()) as { books?: NappiBook[]; missing?: number[] };
  return { books: data.books ?? [], missing: data.missing ?? [] };
}

export type FullPassState = "idle" | "running" | "paused" | "done" | "error";

/** Прогресс полного прохода каталога на сервере (`/api/recommendation-lib/full-pass`, только чтение). */
export interface FullPassInfo {
  status: {
    state: FullPassState;
    startedAt: string | null;
    finishedAt: string | null;
    updatedAt: string | null;
    fromPage: number;
    toPage: number;
    nextPage: number;
    totalPages: number;
    pagesDone: number;
    cardsSeen: number;
    inserted: number;
    updated: number;
    unchanged: number;
    tagsResolved: number;
    fullQueued: number;
    fullFetched: number;
    fullMissing: number;
    errors: number;
    lastError: string | null;
    lastErrorAt: string | null;
    pagesPerMin: number | null;
    etaMinutes: number | null;
    fullQueueSize: number;
  };
  limiter: {
    apiKey: boolean;
    buckets: Record<string, { rpm: number; sent: number; limited: number; waiting: number; pausedForMs: number }>;
  };
  booksInLib: number;
  maxBookId: number;
}

export type TitleTrState = "disabled" | "idle" | "running" | "live" | "paused" | "error";

/** Машинный перевод названий книг на сервере (`/api/recommendation-lib/title-translate`, только чтение). */
export interface TitleTrStatus {
  state: TitleTrState;
  locale: string;
  model: string;
  batch: number;
  concurrency: number;
  startedAt: string | null;
  caughtUpAt: string | null;
  updatedAt: string | null;
  translated: number;
  reused: number;
  liveTranslated: number;
  failed: number;
  requests: number;
  retries: number;
  promptTokens: number;
  completionTokens: number;
  credit: number;
  errors: number;
  lastError: string | null;
  lastErrorAt: string | null;
  totalBooks: number;
  doneBooks: number;
  perMin: number | null;
  etaMinutes: number | null;
  inFlight: number;
  skipped: number;
  recent: { id: number; source: string; title: string }[];
}

/** null — сервер ещё без перевода названий (старый nappi). */
export async function getTitleTranslate(): Promise<TitleTrStatus | null> {
  try {
    const res = await request("/api/recommendation-lib/title-translate");
    return ((await res.json()) as { status: TitleTrStatus }).status;
  } catch (e) {
    if (e instanceof Error && e.message.endsWith("HTTP 404")) return null;
    throw e;
  }
}

export async function getFullPass(): Promise<FullPassInfo> {
  const res = await request("/api/recommendation-lib/full-pass");
  return (await res.json()) as FullPassInfo;
}
