/**
 * Аккаунты nhentai, привязанные к MoeLibre ID — через сервис mlnappi.moelibre.cc (`/v1/link`).
 * Их может быть несколько; на устройстве активен один — тот, в который вошёл клиент nhentai.
 *
 *  - Привязка: приложение вошло в nhentai и отдаёт сервису свою сессию; сервис сам узнаёт у nhentai, чей это
 *    токен, и записывает привязку в MoeLibre ID. Любой вход в nhentai при открытом MoeLibre ID добавляет
 *    аккаунт в список (`linkAfterNhLogin`).
 *  - Переключение: сессия нужного аккаунта берётся из привязки, библиотека прежнего (уже в его облаке) стирается
 *    с устройства, облако подключается к новому (`switchNh`). «Добавить аккаунт» — то же, но без сессии: открывается вход.
 *  - Новое устройство: вошли в MoeLibre ID, а nhentai здесь нет — входим в последний использованный аккаунт.
 *  - Сессия аккаунта одна на все устройства: обновил токены кто-то один — новые уходят в привязку
 *    (`PUT /v1/link/session`), остальные при неудаче обновления берут свежие оттуда же (`tokenHooks.recover`).
 *  - Выход из nhentai отвязывает активный аккаунт: его сессия на nhentai отзывается для всех устройств.
 */
import { useSyncExternalStore } from "react";
import { hasSession, loadAccessToken, loadRefreshToken, storeTokens, tokenHooks } from "../api/client";
import { getMlAccount, mlFetch, MlError, mlSignedIn, refreshMlProfile, subscribeMl } from "./mlid";
import { rememberCurrentSession } from "./nhAccounts";
import { currentNhUserId, swapNhAccount } from "./session";

export const ML_NH_URL: string = (import.meta.env.VITE_ML_NH_URL || "https://mlnappi.moelibre.cc").replace(/\/+$/, "");

/** Пауза перед отправкой обновлённых токенов — обновления подряд уходят одним запросом. */
const PUSH_DELAY_MS = 1500;

export interface NhLinkedAccount {
  id: number;
  username: string;
  linked_at?: string;
  updated_at?: string;
  has_session?: boolean;
}

interface NhLinkState {
  /** null — ещё не знаем (нет входа в MoeLibre или не загрузили). Свежие первыми. */
  accounts: NhLinkedAccount[] | null;
  /** id аккаунта, над которым идёт действие (или 0 — над списком). */
  busy: number | null;
}

let state: NhLinkState = { accounts: null, busy: null };
const listeners = new Set<() => void>();

function set(patch: Partial<NhLinkState>) {
  state = { ...state, ...patch };
  for (const l of listeners) l();
}

export const isNhLinked = (id: number | null | undefined) => !!id && !!state.accounts?.some((a) => a.id === id);

export function useNhLink(): NhLinkState {
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

interface NhSession {
  access_token: string;
  refresh_token?: string;
}

/** Последняя пара, которую знает привязка (получили оттуда или отправили туда) — чтобы не гонять её по кругу. */
let syncedKey = "";
const keyOf = (a: string | null, r: string | null) => `${a ?? ""}|${r ?? ""}`;

async function busy<T>(id: number, fn: () => Promise<T>): Promise<T> {
  set({ busy: id });
  try {
    return await fn();
  } finally {
    set({ busy: null });
  }
}

// ─── Запросы ──────────────────────────────────────────────────────────────────

export async function refreshNhLinks(): Promise<NhLinkedAccount[] | null> {
  if (!mlSignedIn()) {
    set({ accounts: null });
    return null;
  }
  try {
    const res = await mlFetch<{ linked: boolean; accounts?: NhLinkedAccount[]; nhentai?: NhLinkedAccount; has_session?: boolean }>(`${ML_NH_URL}/v1/link`);
    // Старый сервис отдавал один аккаунт без списка
    const accounts = res.accounts ?? (res.linked && res.nhentai ? [{ ...res.nhentai, has_session: res.has_session }] : []);
    set({ accounts });
    return accounts;
  } catch {
    return state.accounts;
  }
}

/** Привязать аккаунт nhentai, в который вошли на этом устройстве (или обновить его сессию в привязке). */
export async function linkNh(): Promise<void> {
  const access = loadAccessToken();
  const refresh = loadRefreshToken();
  if (!access) throw new MlError("nh_signed_out");
  await busy(currentNhUserId() ?? 0, async () => {
    await mlFetch(`${ML_NH_URL}/v1/link`, {
      method: "POST",
      body: JSON.stringify({ session: { access_token: access, refresh_token: refresh ?? undefined } }),
    });
    syncedKey = keyOf(access, refresh);
    await refreshNhLinks();
    void refreshMlProfile();
  });
}

/** Отвязать аккаунт: его сессия стирается из MoeLibre, данные облака остаются за аккаунтом nhentai. */
export async function unlinkNh(id: number): Promise<void> {
  await busy(id, async () => {
    await mlFetch(`${ML_NH_URL}/v1/link?nh=${id}`, { method: "DELETE" });
    if (id === currentNhUserId()) syncedKey = "";
    set({ accounts: (state.accounts ?? []).filter((a) => a.id !== id) });
    void refreshMlProfile();
  });
}

/** Сессия аккаунта из привязки (без `id` — последнего использованного); null — её нет. */
export async function pullNhSession(id?: number): Promise<NhSession | null> {
  try {
    const { session } = await mlFetch<{ session: NhSession }>(`${ML_NH_URL}/v1/link/session${id ? `?nh=${id}` : ""}`);
    return session?.access_token && session.refresh_token ? session : null;
  } catch {
    return null;
  }
}

/** Перейти на другой привязанный аккаунт nhentai на этом устройстве. */
export async function switchNh(id: number): Promise<void> {
  if (id === currentNhUserId()) return;
  await busy(id, async () => {
    const s = await pullNhSession(id);
    if (!s) throw new MlError("no_session");
    syncedKey = keyOf(s.access_token, s.refresh_token ?? null);
    await swapNhAccount({ access: s.access_token, refresh: s.refresh_token! });
  });
}

/** Добавить ещё один аккаунт: выйти из текущего только на устройстве (он остаётся в привязке) — дальше окно входа. */
export async function prepareAddNhAccount(): Promise<void> {
  if (hasSession()) await swapNhAccount(null);
}

let pushTimer: number | undefined;

function schedulePush(attempt = 0) {
  window.clearTimeout(pushTimer);
  pushTimer = window.setTimeout(() => {
    const access = loadAccessToken();
    const refresh = loadRefreshToken();
    const key = keyOf(access, refresh);
    if (!access || key === syncedKey) return;
    const nh = currentNhUserId();
    // Профиль ещё грузится после входа — подождать
    if (!nh) return void (attempt < 4 && schedulePush(attempt + 1));
    if (!isNhLinked(nh)) return;
    void mlFetch(`${ML_NH_URL}/v1/link/session`, {
      method: "PUT",
      body: JSON.stringify({ nh, session: { access_token: access, refresh_token: refresh ?? undefined } }),
    }).then(
      () => {
        syncedKey = key;
      },
      (e) => {
        // Отвязали на другом устройстве
        if (e instanceof MlError && e.code === "not_linked") void refreshNhLinks();
      },
    );
  }, PUSH_DELAY_MS);
}

// ─── События ──────────────────────────────────────────────────────────────────

/** Вход в nhentai из окна входа: при открытом MoeLibre ID аккаунт добавляется к привязанным. */
export async function linkAfterNhLogin(): Promise<void> {
  if (mlSignedIn()) await linkNh().catch(() => undefined);
}

/** Выход из nhentai: активный аккаунт отвязывается (его сессия на nhentai отзывается для всех устройств). */
export async function unlinkBeforeNhLogout(): Promise<void> {
  const id = currentNhUserId();
  if (mlSignedIn() && isNhLinked(id)) await unlinkNh(id!).catch(() => undefined);
}

/** Вошли в MoeLibre ID: узнать привязки и, если здесь nhentai нет, войти в последний использованный аккаунт. */
async function onMlAccount(): Promise<void> {
  const accounts = await refreshNhLinks();
  if (!accounts?.length) return;
  if (hasSession()) {
    // Здесь уже вошли — держим привязку в курсе свежих токенов
    schedulePush();
    return;
  }
  const target = accounts.find((a) => a.has_session !== false);
  if (!target) return;
  const s = await pullNhSession(target.id);
  if (!s) return;
  syncedKey = keyOf(s.access_token, s.refresh_token ?? null);
  await swapNhAccount({ access: s.access_token, refresh: s.refresh_token! });
}

let started = false;

/** Один раз при старте (main.tsx), после `initMlId()`. */
export function initMlNhentai(): void {
  if (started) return;
  started = true;

  tokenHooks.onStored = (access, refresh) => {
    rememberCurrentSession();
    if (keyOf(access, refresh) !== syncedKey && mlSignedIn()) schedulePush();
  };
  tokenHooks.recover = async (failedRefresh) => {
    const id = currentNhUserId();
    if (!mlSignedIn() || !id) return false;
    if (state.accounts === null) await refreshNhLinks();
    if (!isNhLinked(id)) return false;
    const s = await pullNhSession(id);
    if (!s?.refresh_token || s.refresh_token === failedRefresh) return false;
    syncedKey = keyOf(s.access_token, s.refresh_token);
    // Тот же аккаунт — только токены; библиотеку не трогаем
    storeTokens(s.access_token, s.refresh_token);
    return true;
  };

  let accountId = getMlAccount()?.id ?? null;
  subscribeMl(() => {
    const next = getMlAccount()?.id ?? null;
    if (next === accountId) return;
    accountId = next;
    if (next) void onMlAccount();
    else {
      syncedKey = "";
      set({ accounts: null });
    }
  });
  if (mlSignedIn()) void onMlAccount();
}
