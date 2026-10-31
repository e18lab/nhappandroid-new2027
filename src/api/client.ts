/**
 * HTTP-клиент nhentai API v2 — перенос `api/v2/client.ts`.
 *
 * Авторизация (по приоритету):
 *   1. `Authorization: User <access_token>` — после входа;
 *   2. `Authorization: Key <api_key>` — ключ из `VITE_NHENTAI_API_KEY` или переданный явно.
 * На 401 один раз обновляет токены через `/auth/refresh` и повторяет запрос.
 * На 429 — до трёх повторов с паузой 1/2/4 с или по Retry-After.
 *
 * В Tauri запросы идут через `@tauri-apps/plugin-http` (без CORS), в браузере при разработке —
 * через прокси Vite `/nh-api`.
 */
import { getItem, removeItem, setItem } from "../lib/storage";

export const NH_HOST = "https://nhentai.net";
export const API_V2_BASE = `${NH_HOST}/api/v2`;

const ANDROID_UA =
  "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Mobile Safari/537.36";

/** Ключ API для анонимных запросов (необязателен). */
const STATIC_API_KEY: string | undefined = import.meta.env.VITE_NHENTAI_API_KEY || undefined;

/** Без таймаута первый запрос висит вечно, если сеть поднялась позже старта приложения. */
const REQUEST_TIMEOUT_MS = 20_000;
const RATE_LIMIT_RETRIES = 3;

// Ключи с префиксом @auth. — как в старом приложении (исключаются из облачной синхронизации)
const STORAGE_KEY_ACCESS = "@auth.v2.access_token";
const STORAGE_KEY_REFRESH = "@auth.v2.refresh_token";

export class ApiError extends Error {
  /** Пауза перед повтором из заголовка Retry-After (для 429). */
  retryAfterMs?: number;
  /** Тело ответа с ошибкой (detail / message / поля формы). */
  body?: unknown;

  constructor(
    message: string,
    readonly status: number,
    /** Ключ перевода для показа пользователю (см. `errorText`). */
    readonly i18nKey?: string,
  ) {
    super(message);
    this.name = "ApiError";
  }

  /** Cloudflare / капча вместо JSON: нужен вход через окно браузера. */
  get isCloudflare(): boolean {
    return this.status === 403 && typeof this.body === "string" && /cloudflare|cf-chl|challenge/i.test(this.body);
  }
}

function inTauri(): boolean {
  return typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
}

export function resolveUrl(path: string): string {
  const full = path.startsWith("http") ? path : `${API_V2_BASE}${path}`;
  if (inTauri()) return full;
  return full.replace(API_V2_BASE, "/nh-api");
}

// ─── Токены ───────────────────────────────────────────────────────────────────

export function storeTokens(accessToken: string, refreshToken: string): void {
  setItem(STORAGE_KEY_ACCESS, accessToken);
  setItem(STORAGE_KEY_REFRESH, refreshToken);
  devPushTokens(accessToken, refreshToken);
}

export function loadAccessToken(): string | null {
  return getItem(STORAGE_KEY_ACCESS);
}

export function loadRefreshToken(): string | null {
  return getItem(STORAGE_KEY_REFRESH);
}

export function clearTokens(): void {
  removeItem(STORAGE_KEY_ACCESS);
  removeItem(STORAGE_KEY_REFRESH);
  devPushTokens(null, null);
}

export function hasSession(): boolean {
  return !!loadAccessToken();
}

// ─── Запрос ───────────────────────────────────────────────────────────────────

export interface RequestOptions {
  /** Не добавлять Authorization (публичные эндпоинты). */
  public?: boolean;
  /** Ключ API вместо сохранённого токена. */
  apiKey?: string;
  /** Дополнительные заголовки. */
  headers?: Record<string, string>;
  /** Не обновлять токены на 401. */
  skipRefresh?: boolean;
  /** На 429 не повторять, а сразу отдать ошибку (очередь сама решает, когда повторить). */
  noRetry?: boolean;
}

/** Тело запроса: объект уходит как JSON, FormData — как multipart. */
type Body = unknown;

function buildHeaders(opts: RequestOptions, body: Body): Record<string, string> {
  const headers: Record<string, string> = { Accept: "application/json", ...opts.headers };
  if (body !== undefined && !(body instanceof FormData)) headers["Content-Type"] = "application/json";
  if (inTauri()) headers["User-Agent"] = ANDROID_UA;

  if (!opts.public) {
    const token = opts.apiKey ? null : loadAccessToken();
    if (opts.apiKey) headers.Authorization = `Key ${opts.apiKey}`;
    else if (token) headers.Authorization = `User ${token}`;
    else if (STATIC_API_KEY) headers.Authorization = `Key ${STATIC_API_KEY}`;
  }
  return headers;
}

/**
 * Таймаут — свой AbortController, который снимается, как только тело прочитано. С AbortSignal.timeout
 * плагин HTTP через 20 с слал `fetch_cancel` по каждому уже завершённому запросу.
 */
async function send(method: string, url: string, headers: Record<string, string>, body: Body, signal: AbortSignal): Promise<Response> {
  const payload = body === undefined ? undefined : body instanceof FormData ? body : JSON.stringify(body);
  try {
    if (inTauri()) {
      const { fetch } = await import("@tauri-apps/plugin-http");
      return await fetch(url, { method, headers, body: payload, connectTimeout: REQUEST_TIMEOUT_MS, signal });
    }
    return await fetch(url, { method, headers, body: payload, signal });
  } catch {
    throw signal.aborted ? new ApiError("Request timed out", 0, "errors.timeout") : new ApiError("Network error", 0, "errors.network");
  }
}

async function requestOnce<T>(method: string, path: string, opts: RequestOptions, body: Body): Promise<T> {
  const url = resolveUrl(path);
  const ctl = new AbortController();
  const timer = window.setTimeout(() => ctl.abort(), REQUEST_TIMEOUT_MS);
  let text: string;
  let response: Response;
  try {
    response = await send(method, url, buildHeaders(opts, body), body, ctl.signal);

    // Токен истёк — обновляем один раз и повторяем
    if (response.status === 401 && !opts.skipRefresh && !opts.public && !opts.apiKey && loadRefreshToken()) {
      if (await tryRefreshTokens()) response = await send(method, url, buildHeaders(opts, body), body, ctl.signal);
    }

    text = await response.text().catch(() => {
      throw ctl.signal.aborted ? new ApiError("Request timed out", 0, "errors.timeout") : new ApiError("Network error", 0, "errors.network");
    });
  } finally {
    window.clearTimeout(timer);
  }

  let data: unknown = null;
  if (text) {
    try {
      data = JSON.parse(text);
    } catch {
      data = text;
    }
  }

  if (!response.ok) {
    const err = data as { detail?: unknown; message?: string; error?: string } | null;
    const detail = typeof err?.detail === "string" ? err.detail : undefined;
    const msg = detail || err?.message || err?.error || `HTTP ${response.status}`;
    const error = new ApiError(String(msg), response.status);
    error.body = data;
    const retryAfter = Number(response.headers.get("retry-after"));
    if (Number.isFinite(retryAfter) && retryAfter > 0) error.retryAfterMs = Math.min(retryAfter, 10) * 1000;
    throw error;
  }

  return data as T;
}

async function request<T>(method: string, path: string, opts: RequestOptions = {}, body?: Body): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    try {
      return await requestOnce<T>(method, path, opts, body);
    } catch (e) {
      if (!(e instanceof ApiError) || e.status !== 429 || opts.noRetry || attempt >= RATE_LIMIT_RETRIES) throw e;
      const wait = e.retryAfterMs ?? 1000 * 2 ** attempt;
      await new Promise((r) => setTimeout(r, wait));
    }
  }
}

// ─── Обновление токенов ───────────────────────────────────────────────────────

let refreshPromise: Promise<boolean> | null = null;

/** Параллельные 401 делят одно обновление. При неудаче сессия сбрасывается. */
async function tryRefreshTokens(): Promise<boolean> {
  if (refreshPromise) return refreshPromise;
  refreshPromise = (async () => {
    try {
      const refreshToken = loadRefreshToken();
      if (!refreshToken) return false;
      const { refresh } = await import("./auth");
      const result = await refresh(refreshToken);
      storeTokens(result.access_token, result.refresh_token);
      return true;
    } catch {
      // В разработке токен мог обновить `tauri dev` или браузер рядом — сначала берём их свежие
      if (await devPullTokens()) return true;
      clearTokens();
      return false;
    } finally {
      refreshPromise = null;
    }
  })();
  return refreshPromise;
}

// ─── Публичный интерфейс ──────────────────────────────────────────────────────

/** Одинаковые GET, отправленные одновременно (два экрана, StrictMode), делят один запрос. */
const inflight = new Map<string, Promise<unknown>>();

export const nhApi = {
  get<T>(path: string, opts?: RequestOptions): Promise<T> {
    const key = `${path}|${opts?.public ? 1 : 0}|${opts?.apiKey ?? ""}|${JSON.stringify(opts?.headers ?? {})}`;
    const hit = inflight.get(key);
    if (hit) return hit as Promise<T>;
    const p = request<T>("GET", path, opts).finally(() => inflight.delete(key));
    inflight.set(key, p);
    return p;
  },
  post<T>(path: string, body?: unknown, opts?: RequestOptions): Promise<T> {
    return request<T>("POST", path, opts, body);
  },
  put<T>(path: string, body?: unknown, opts?: RequestOptions): Promise<T> {
    return request<T>("PUT", path, opts, body);
  },
  delete<T>(path: string, opts?: RequestOptions): Promise<T> {
    return request<T>("DELETE", path, opts);
  },
};

/** GET к API v2 (короткая запись `nhApi.get`). */
export function apiGet<T>(path: string, opts?: RequestOptions): Promise<T> {
  return nhApi.get<T>(path, opts);
}

/** `?a=1&b=2` без пустых значений. */
export function buildQuery(params: Record<string, unknown>): string {
  const entries = Object.entries(params).filter(([, v]) => v !== undefined && v !== null && v !== "");
  if (!entries.length) return "";
  return "?" + entries.map(([k, v]) => `${k}=${encodeURIComponent(String(v))}`).join("&");
}

// ─── Общий вход в разработке ──────────────────────────────────────────────────
// `tauri dev` и браузер с мобильной версией хранят токены каждый в своём localStorage. Дев-сервер Vite держит
// в памяти последнюю пару (`/__dev/auth`, см. vite.config.ts): кто вошёл или обновил токены — отправляет туда,
// при запуске каждый забирает. В сборке этого кода нет.

const DEV_AUTH_URL = "/__dev/auth";

function devPushTokens(access: string | null, refresh: string | null): void {
  if (!import.meta.env.DEV) return;
  void fetch(DEV_AUTH_URL, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ access, refresh }) }).catch(() => {});
}

/**
 * Свести токены с дев-сервером: там другие — взять их (true), там пусто (сервер перезапущен) — отдать свои.
 * Вне разработки сразу false.
 */
export async function devPullTokens(): Promise<boolean> {
  if (!import.meta.env.DEV) return false;
  try {
    const res = await fetch(DEV_AUTH_URL);
    if (!res.ok) return false;
    const shared = (await res.json()) as { access?: string | null; refresh?: string | null; set?: boolean };
    const access = loadAccessToken();
    const refresh = loadRefreshToken();
    if (!shared.set) {
      if (access && refresh) devPushTokens(access, refresh);
      return false;
    }
    if (shared.access === access && shared.refresh === refresh) return false;
    if (shared.access && shared.refresh) {
      setItem(STORAGE_KEY_ACCESS, shared.access);
      setItem(STORAGE_KEY_REFRESH, shared.refresh);
    } else {
      removeItem(STORAGE_KEY_ACCESS);
      removeItem(STORAGE_KEY_REFRESH);
    }
    return !!shared.access;
  } catch {
    return false;
  }
}
