/**
 * Аккаунт MoeLibre ID — главный аккаунт приложения (id.moelibre.cc). Аккаунт nhentai (`session.ts`)
 * привязывается к нему как аккаунт ресурса.
 *
 * Вход — через системный браузер, без паролей в приложении:
 *  1. `startMlLogin("google" | "telegram")` создаёт PKCE (verifier остаётся здесь) и открывает в браузере
 *     `id.moelibre.cc/auth/{provider}/start?redirect_uri=…&code_challenge=…&state=…`;
 *  2. после входа браузер возвращает в приложение `moelibre://auth/callback?code=…&state=…`
 *     (plugin deep-link: на ПК ссылку получает уже открытое окно, на Android — Activity);
 *     в обычном браузере (разработка) — на этот же адрес `http://127.0.0.1:1420/?ml_auth=1&code=…`;
 *  3. код меняется на токены (`POST /auth/exchange` с verifier), профиль — `GET /me`.
 *
 * Токен доступа живёт 15 минут и обновляется сам по refresh-токену (`mlFetch`). Токены — в `@auth.mlid`
 * (префикс `@auth` в облако не уходит).
 */
import { useSyncExternalStore } from "react";
import { getDeviceId, getDeviceName } from "./device";
import { getJSON, removeItem, setJSON } from "./storage";

export const ML_ID_URL: string = (import.meta.env.VITE_ML_ID_URL || "https://id.moelibre.cc").replace(/\/+$/, "");

const SESSION_KEY = "@auth.mlid";
/** Ожидание входа: verifier PKCE и state. В localStorage — переживает выгрузку приложения, пока открыт браузер (Android). */
const PENDING_KEY = "@auth.mlPending";
/** Сколько ждём возврата из браузера. */
const PENDING_TTL_MS = 15 * 60_000;
/** Обновлять токен доступа заранее, за минуту до конца. */
const REFRESH_SKEW_MS = 60_000;

export type MlProvider = "google" | "telegram";

export interface MlAccount {
  id: string;
  display_name: string;
  avatar_url: string | null;
  created_at: string;
}

export interface MlProfile {
  account: MlAccount;
  session_id: string;
  identities: { provider: MlProvider; email: string | null; display_name: string | null; avatar_url: string | null; created_at: string; last_login_at: string }[];
  links: { service: string; external_id: string; display_name: string | null; avatar_url: string | null; linked_at: string }[];
}

export interface MlDeviceSession {
  id: string;
  device_id: string;
  device_name: string | null;
  created_at: string;
  last_used_at: string;
}

interface Stored {
  access: string;
  accessExp: number;
  refresh: string;
  account: MlAccount | null;
}

/** Ошибка MoeLibre ID с машинным кодом (`invalid_code`, `provider_not_configured`, …). */
export class MlError extends Error {
  constructor(
    readonly code: string,
    readonly status = 0,
  ) {
    super(code);
  }
}

// ─── Состояние ────────────────────────────────────────────────────────────────

/**
 * Вход или привязка ещё одного способа входа (`link`) — один и тот же путь через браузер.
 * `linked` в idle — только что привязали этот способ (экран аккаунта показывает уведомление).
 */
export type MlLoginState =
  | { phase: "idle"; linked?: MlProvider }
  | { phase: "waiting"; provider: MlProvider; link?: boolean }
  | { phase: "exchanging"; link?: boolean }
  | { phase: "error"; code: string; link?: boolean };

interface MlState {
  account: MlAccount | null;
  profile: MlProfile | null;
  login: MlLoginState;
}

let stored: Stored | null = getJSON<Stored | null>(SESSION_KEY, null);
let state: MlState = { account: stored?.account ?? null, profile: null, login: { phase: "idle" } };
const listeners = new Set<() => void>();

function set(patch: Partial<MlState>) {
  state = { ...state, ...patch };
  for (const l of listeners) l();
}

function save(next: Stored | null) {
  stored = next;
  if (next) setJSON(SESSION_KEY, next);
  else removeItem(SESSION_KEY);
}

export function useMl(): MlState {
  return useSyncExternalStore(
    (cb) => {
      listeners.add(cb);
      return () => {
        listeners.delete(cb);
      };
    },
    () => state,
  );
}

export const mlSignedIn = () => !!stored;

/** Подписка на изменения аккаунта вне React (привязки ресурсов). */
export function subscribeMl(fn: () => void): () => void {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}

export const getMlAccount = () => state.account;

// ─── HTTP ─────────────────────────────────────────────────────────────────────

async function call<T>(path: string, init: RequestInit = {}): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`${ML_ID_URL}${path}`, { ...init, headers: { "Content-Type": "application/json", ...init.headers } });
  } catch {
    throw new MlError("network");
  }
  if (res.status === 204) return undefined as T;
  const data = (await res.json().catch(() => ({}))) as { error?: string };
  if (!res.ok) throw new MlError(data.error || `http_${res.status}`, res.status);
  return data as T;
}

interface TokenPair {
  access_token: string;
  expires_in: number;
  refresh_token: string;
  account?: MlAccount | null;
}

function keep(pair: TokenPair) {
  save({
    access: pair.access_token,
    accessExp: Date.now() + pair.expires_in * 1000,
    refresh: pair.refresh_token,
    account: pair.account ?? stored?.account ?? null,
  });
}

let refreshing: Promise<void> | null = null;

/** Свежий токен доступа: обновляет по refresh-токену, если старый почти истёк (параллельные вызовы ждут один запрос). */
async function accessToken(): Promise<string> {
  if (!stored) throw new MlError("signed_out", 401);
  if (Date.now() < stored.accessExp - REFRESH_SKEW_MS) return stored.access;
  refreshing ??= call<TokenPair>("/auth/refresh", { method: "POST", body: JSON.stringify({ refresh_token: stored.refresh }) })
    .then(keep)
    .catch((e) => {
      // Сессию отозвали (выход на другом устройстве, кража токена) — выходим и здесь
      if (e instanceof MlError && e.status === 401) signOutLocal();
      throw e;
    })
    .finally(() => {
      refreshing = null;
    });
  await refreshing;
  return stored!.access;
}

/** Токен доступа для своих соединений (WebSocket облака). */
export const mlAccessToken = (): Promise<string> => accessToken();

/** Запрос к любому сервису MoeLibre (ID, mlnappi…) с токеном доступа. */
export async function mlFetch<T>(url: string, init: RequestInit = {}): Promise<T> {
  const doFetch = async () =>
    fetch(url, { ...init, headers: { "Content-Type": "application/json", ...init.headers, Authorization: `Bearer ${await accessToken()}` } });
  let res = await doFetch().catch(() => null);
  // Токен могли отозвать раньше срока — одна попытка обновить и повторить
  if (res?.status === 401 && stored) {
    stored = { ...stored, accessExp: 0 };
    res = await doFetch().catch(() => null);
  }
  if (!res) throw new MlError("network");
  if (res.status === 204) return undefined as T;
  const data = (await res.json().catch(() => ({}))) as { error?: string };
  if (!res.ok) throw new MlError(data.error || `http_${res.status}`, res.status);
  return data as T;
}

// ─── Вход ─────────────────────────────────────────────────────────────────────

const inTauri = () => typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;

const b64url = (bytes: Uint8Array) => btoa(String.fromCharCode(...bytes)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
const randomString = (n: number) => b64url(crypto.getRandomValues(new Uint8Array(n)));

async function sha256b64url(s: string): Promise<string> {
  return b64url(new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s))));
}

/** Куда браузер вернёт код: в приложение по схеме, в разработке в браузере — на эту же страницу. */
function redirectUri(): string {
  return inTauri() ? "moelibre://auth/callback" : `${location.origin}/?ml_auth=1`;
}

/**
 * Вход через браузер. `link` — привязать этот способ к уже вошедшему аккаунту: сперва одноразовый билет
 * по своему токену (сам токен в адрес браузера не попадает), дальше всё как при входе.
 */
export async function startMlLogin(provider: MlProvider, opts: { link?: boolean } = {}): Promise<void> {
  const link = !!opts.link;
  let ticket: string | null = null;
  if (link) {
    try {
      ticket = (await mlFetch<{ ticket: string }>(`${ML_ID_URL}/me/identities/link-ticket`, { method: "POST" })).ticket;
    } catch (e) {
      set({ login: { phase: "error", code: e instanceof MlError ? e.code : "login_failed", link } });
      return;
    }
  }
  const verifier = randomString(48);
  const st = randomString(16);
  localStorage.setItem(PENDING_KEY, JSON.stringify({ verifier, state: st, provider, link, at: Date.now() }));
  const params = new URLSearchParams({ redirect_uri: redirectUri(), code_challenge: await sha256b64url(verifier), state: st });
  if (ticket) params.set("link_ticket", ticket);
  const url = `${ML_ID_URL}/auth/${provider}/start?${params}`;
  set({ login: { phase: "waiting", provider, link } });
  if (inTauri()) {
    const { openUrl } = await import("@tauri-apps/plugin-opener");
    await openUrl(url);
  } else {
    location.assign(url);
  }
}

export function cancelMlLogin() {
  localStorage.removeItem(PENDING_KEY);
  set({ login: { phase: "idle" } });
}

/** Ответ браузера: `moelibre://auth/callback?…` или страница с `?ml_auth=1`. true — ссылка про вход. */
export async function handleMlCallback(rawUrl: string): Promise<boolean> {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    return false;
  }
  const isApp = url.protocol === "moelibre:" && (url.host === "auth" || url.pathname.startsWith("//auth"));
  const isWeb = url.searchParams.get("ml_auth") === "1";
  if (!isApp && !isWeb) return false;

  let pending: { verifier: string; state: string; at: number; provider?: MlProvider; link?: boolean } | null = null;
  try {
    pending = JSON.parse(localStorage.getItem(PENDING_KEY) || "null");
  } catch {
    /* повреждено */
  }
  if (pending && Date.now() - pending.at > PENDING_TTL_MS) pending = null;
  const code = url.searchParams.get("code");
  const error = url.searchParams.get("error");
  if (!pending || url.searchParams.get("state") !== pending.state) {
    set({ login: { phase: "error", code: "state_mismatch" } });
    return true;
  }
  localStorage.removeItem(PENDING_KEY);
  const link = !!pending.link;
  if (error || !code) {
    set({ login: error === "cancelled" || error === "access_denied" ? { phase: "idle" } : { phase: "error", code: error || "no_code", link } });
    return true;
  }
  set({ login: { phase: "exchanging", link } });
  try {
    const pair = await call<TokenPair>("/auth/exchange", {
      method: "POST",
      body: JSON.stringify({ code, code_verifier: pending.verifier, device_id: getDeviceId(), device_name: getDeviceName() }),
    });
    keep(pair);
    set({ account: pair.account ?? null, login: { phase: "idle", linked: link ? pending.provider : undefined } });
    void refreshMlProfile();
  } catch (e) {
    set({ login: { phase: "error", code: e instanceof MlError ? e.code : "login_failed", link } });
  }
  return true;
}

// ─── Профиль, устройства, выход ───────────────────────────────────────────────

export async function refreshMlProfile(): Promise<MlProfile | null> {
  if (!stored) return null;
  try {
    const profile = await mlFetch<MlProfile>(`${ML_ID_URL}/me`);
    if (stored) save({ ...stored, account: profile.account });
    set({ account: profile.account, profile });
    return profile;
  } catch (e) {
    if (e instanceof MlError && e.status === 401) signOutLocal();
    return null;
  }
}

export async function updateMlProfile(patch: { display_name?: string }): Promise<void> {
  const { account } = await mlFetch<{ account: MlAccount }>(`${ML_ID_URL}/me`, { method: "PATCH", body: JSON.stringify(patch) });
  if (stored) save({ ...stored, account });
  set({ account, profile: state.profile ? { ...state.profile, account } : null });
}

// ─── Свой аватар ──────────────────────────────────────────────────────────────

/** Сторона квадратного аватара, который уходит на сервер. */
const AVATAR_SIZE = 384;

/** Картинка → квадрат по центру AVATAR_SIZE px (WebP, если браузер умеет, иначе JPEG). Гифки — первым кадром. */
async function squareAvatar(file: File): Promise<Blob> {
  const bitmap = await createImageBitmap(file).catch(() => {
    throw new MlError("bad_image");
  });
  const side = Math.min(bitmap.width, bitmap.height);
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = Math.min(AVATAR_SIZE, side);
  const ctx = canvas.getContext("2d")!;
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(bitmap, (bitmap.width - side) / 2, (bitmap.height - side) / 2, side, side, 0, 0, canvas.width, canvas.height);
  bitmap.close();
  const encode = (type: string, q: number) => new Promise<Blob | null>((ok) => canvas.toBlob(ok, type, q));
  let blob = await encode("image/webp", 0.86);
  if (!blob || blob.type !== "image/webp") blob = await encode("image/jpeg", 0.88);
  if (!blob) throw new MlError("bad_image");
  return blob;
}

/** Загрузить свой аватар (любая картинка — обрезается и уменьшается здесь). */
export async function uploadMlAvatar(file: File): Promise<void> {
  const blob = await squareAvatar(file);
  const { account } = await mlFetch<{ account: MlAccount }>(`${ML_ID_URL}/me/avatar`, { method: "PUT", body: blob, headers: { "Content-Type": blob.type } });
  applyAccount(account);
}

/** Убрать свой аватар — вернётся аватар Google / Telegram. */
export async function resetMlAvatar(): Promise<void> {
  const { account } = await mlFetch<{ account: MlAccount }>(`${ML_ID_URL}/me/avatar`, { method: "DELETE" });
  applyAccount(account);
}

/** Аватар загружен в MoeLibre, а не взят у способа входа. */
export const isCustomMlAvatar = (url: string | null | undefined) => !!url && url.startsWith(`${ML_ID_URL}/avatars/`);

function applyAccount(account: MlAccount) {
  if (stored) save({ ...stored, account });
  set({ account, profile: state.profile ? { ...state.profile, account } : null });
}

/** Сбросить состояние входа (уведомление о привязке показано, ошибку привязки увидели). */
export function clearMlLoginNotice(): void {
  if (state.login.phase === "idle" || state.login.phase === "error") set({ login: { phase: "idle" } });
}

/** Убрать способ входа (последний сервер не даст убрать). */
export async function unlinkMlIdentity(provider: MlProvider): Promise<void> {
  await mlFetch(`${ML_ID_URL}/me/identities/${provider}`, { method: "DELETE" });
  await refreshMlProfile();
}

export async function listMlSessions(): Promise<{ current: string; sessions: MlDeviceSession[] }> {
  return mlFetch(`${ML_ID_URL}/me/sessions`);
}

export async function revokeMlSession(id: string): Promise<void> {
  await mlFetch(`${ML_ID_URL}/me/sessions/${encodeURIComponent(id)}`, { method: "DELETE" });
}

function signOutLocal() {
  save(null);
  set({ account: null, profile: null });
}

/** Выйти из MoeLibre ID на этом устройстве (сессия устройства закрывается и на сервере). */
export async function mlSignOut(): Promise<void> {
  if (stored) {
    const token = stored.access;
    await call("/auth/logout", { method: "POST", headers: { Authorization: `Bearer ${token}` } }).catch(() => {});
  }
  signOutLocal();
}

// ─── Запуск ───────────────────────────────────────────────────────────────────

let started = false;

/**
 * Слушать возврат из браузера и подтянуть профиль. Вызывается один раз при старте (main.tsx).
 * Холодный старт по ссылке (Android открыл приложение ссылкой) — `getCurrent()`.
 */
export function initMlId(): void {
  if (started) return;
  started = true;
  if (!inTauri()) {
    if (new URLSearchParams(location.search).get("ml_auth") === "1") {
      const href = location.href;
      history.replaceState(null, "", location.pathname + location.hash);
      void handleMlCallback(href);
    }
  } else {
    void (async () => {
      try {
        const { getCurrent, onOpenUrl } = await import("@tauri-apps/plugin-deep-link");
        await onOpenUrl((urls) => urls.forEach((u) => void handleMlCallback(u)));
        (await getCurrent())?.forEach((u) => void handleMlCallback(u));
      } catch (e) {
        console.warn("[mlid] deep-link unavailable", e);
      }
    })();
  }
  if (stored) void refreshMlProfile();
}
