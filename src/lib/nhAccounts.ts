/**
 * Аккаунты nhentai на устройстве. У каждой вкладки свой аккаунт (`BrowserTab.account`), клиент nhentai
 * работает за аккаунт выбранной вкладки — при смене вкладки он переключается (`activateNhAccount`).
 *
 * Сессии всех аккаунтов, в которые входили на устройстве, лежат в `@auth.nh.sessions` (префикс `@auth` — только
 * на устройстве) вместе с профилем — переключение мгновенное, профиль уточняется с сервера в фоне. Нет сессии
 * на устройстве, но аккаунт привязан к MoeLibre — она берётся из привязки.
 */
import { useSyncExternalStore } from "react";
import { loadAccessToken, loadRefreshToken } from "../api/client";
import type { Me } from "../api/types";
import { isNhLinked, pullNhSession, useNhLink } from "./mlNhentai";
import { mlSignedIn } from "./mlid";
import { currentNhUserId, swapNhAccount, useMe } from "./session";
import { getJSON, setJSON } from "./storage";

const SESSIONS_KEY = "@auth.nh.sessions";

interface Saved {
  access: string;
  refresh: string;
  me?: Me;
}

let sessions: Record<string, Saved> = getJSON<Record<string, Saved>>(SESSIONS_KEY, {});
let version = 0;
const listeners = new Set<() => void>();

function save() {
  setJSON(SESSIONS_KEY, sessions);
  version++;
  for (const l of listeners) l();
}

/** Запомнить сессию текущего аккаунта (после входа, обновления токенов, загрузки профиля). */
export function rememberCurrentSession(me?: Me | null): void {
  const id = me?.id ?? currentNhUserId();
  const access = loadAccessToken();
  const refresh = loadRefreshToken();
  if (!id || !access || !refresh) return;
  const prev = sessions[id];
  const next: Saved = { access, refresh, me: me ?? prev?.me };
  if (prev && prev.access === next.access && prev.refresh === next.refresh && prev.me === next.me) return;
  sessions = { ...sessions, [id]: next };
  save();
}

/** Забыть сессию аккаунта на устройстве (выход из него). */
export function forgetSession(id: number): void {
  if (!sessions[id]) return;
  const { [id]: _drop, ...rest } = sessions;
  void _drop;
  sessions = rest;
  save();
}

/**
 * Сохранённая сессия аккаунта оказалась от другого аккаунта (раньше запоздалый ответ профиля записывал токены
 * под чужим id): забыть её и взять сессию из привязки MoeLibre. null — взять неоткуда.
 */
export async function repairSavedSession(id: number): Promise<{ access: string; refresh: string } | null> {
  if (sessions[id]?.access === loadAccessToken()) forgetSession(id);
  if (!mlSignedIn() || !isNhLinked(id)) return null;
  const pulled = await pullNhSession(id);
  return pulled ? { access: pulled.access_token, refresh: pulled.refresh_token! } : null;
}

let switching: Promise<boolean> | null = null;

/**
 * Сделать аккаунт текущим в клиенте nhentai: null — без входа (сессии не отзываются, остаются на устройстве).
 * false — сессии этого аккаунта нет ни на устройстве, ни в привязке MoeLibre.
 */
export async function activateNhAccount(id: number | null): Promise<boolean> {
  while (switching) await switching.catch(() => undefined);
  if (id === currentNhUserId()) return true;
  switching = (async () => {
    if (id === null) {
      await swapNhAccount(null);
      return true;
    }
    let s = sessions[id];
    if (!s && mlSignedIn() && isNhLinked(id)) {
      const pulled = await pullNhSession(id);
      if (pulled) s = { access: pulled.access_token, refresh: pulled.refresh_token! };
    }
    if (!s) return false;
    await swapNhAccount({ access: s.access, refresh: s.refresh }, s.me);
    return true;
  })();
  try {
    return await switching;
  } finally {
    switching = null;
  }
}

export const isSwitchingNhAccount = () => switching !== null;

export interface NhAccountItem {
  id: number;
  username: string;
  avatar: string | null;
  /** Привязан к MoeLibre ID. */
  linked: boolean;
  /** Есть сессия на устройстве. */
  local: boolean;
}

/** Все аккаунты nhentai: вошедшие на устройстве и привязанные к MoeLibre. */
export function useNhAccounts(): NhAccountItem[] {
  useSyncExternalStore(
    (cb) => {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
    () => version,
  );
  const link = useNhLink();
  const me = useMe();
  const out = new Map<number, NhAccountItem>();
  for (const [id, s] of Object.entries(sessions)) {
    const n = Number(id);
    out.set(n, { id: n, username: s.me?.username ?? `#${id}`, avatar: s.me?.avatar_url ?? null, linked: false, local: true });
  }
  for (const a of link.accounts ?? []) {
    const cur = out.get(a.id);
    out.set(a.id, { id: a.id, username: cur?.username.startsWith("#") ? a.username : (cur?.username ?? a.username), avatar: cur?.avatar ?? null, linked: true, local: !!cur });
  }
  if (me && !out.has(me.id)) out.set(me.id, { id: me.id, username: me.username, avatar: me.avatar_url, linked: false, local: true });
  return [...out.values()];
}

/** Профиль аккаунта из сохранённого (для значка у вкладки). */
export function savedNhProfile(id: number): Me | undefined {
  return sessions[id]?.me;
}

export function useSavedNhProfiles(): Record<string, Me | undefined> {
  useSyncExternalStore(
    (cb) => {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
    () => version,
  );
  return Object.fromEntries(Object.entries(sessions).map(([id, s]) => [id, s.me]));
}
