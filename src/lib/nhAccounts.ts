/**
 * Аккаунты nhentai на устройстве. У каждой вкладки свой аккаунт (`BrowserTab.account`), клиент nhentai
 * работает за аккаунт выбранной вкладки — при смене вкладки он переключается (`activateNhAccount`).
 *
 * Сессии всех аккаунтов, в которые входили на устройстве, лежат в `@auth.nh.sessions` (префикс `@auth` — только
 * на устройстве) вместе с профилем — переключение мгновенное, профиль уточняется с сервера в фоне. Нет сессии
 * на устройстве, но аккаунт привязан к MoeLibre — она берётся из привязки.
 */
import { useEffect, useSyncExternalStore } from "react";
import { getMeWithToken } from "../api/account";
import { refresh as refreshTokens } from "../api/auth";
import { ApiError, hasSession, hasUserSession, loadAccessToken, loadAccountKey, loadRefreshToken, storeAccountKey, type NhAuth } from "../api/client";
import type { Me } from "../api/types";
import { nhLinkHooks, pullNhSession, putNhSession, refreshNhLinks, useNhLink } from "./mlNhentai";
import { mlSignedIn } from "./mlid";
import { currentNhUserId, isSwappingAuth, swapNhAccount, useMe } from "./session";
import { getItem, getJSON, removeItem, setItem, setJSON, subscribeKey } from "./storage";
import { NH_AUTH_KEY } from "./cloudSync";

const SESSIONS_KEY = "@auth.nh.sessions";

/** Вход аккаунта на устройстве: сессия (может устареть) и / или ключ API (не протухает). */
interface Saved {
  access?: string;
  refresh?: string;
  apiKey?: string;
  me?: Me;
  /** Сессия устарела (обновить не вышло, или её не нашлось нигде) — нужно войти снова. */
  expired?: boolean;
  /** Отпечаток токена обновления, который nhentai уже отверг: такую сессию из привязки не пробуем снова. */
  dead?: string;
}

/** Отпечаток токена (сам токен в заметку не кладём). */
const fp = (token: string | null | undefined) => (token ? `${token.length}:${token.slice(-10)}` : undefined);

const usable = (s: Saved | undefined): s is Saved => !!s && (!!(s.access && s.refresh) || !!s.apiKey);

let sessions: Record<string, Saved> = getJSON<Record<string, Saved>>(SESSIONS_KEY, {});
let version = 0;
const listeners = new Set<() => void>();

function notify() {
  version++;
  for (const l of listeners) l();
}

function save() {
  setJSON(SESSIONS_KEY, sessions);
  schedulePublish();
  notify();
}

// ─── Входы в облаке ───────────────────────────────────────────────────────────
// Токены и ключи API аккаунтов уходят в облако одной записью `nhentai.auth.v1` (часть `res:nhentai`); облако
// доступно только входу в MoeLibre ID с аутентификатором. Другое устройство берёт их оттуда и входит само. У каждого аккаунта — время изменения `at`: побеждает более позднее.
// Выход на одном устройстве другие не трогает; отозванный ключ и отвергнутую сессию другим не раздаём.

interface VaultEntry {
  access?: string;
  refresh?: string;
  apiKey?: string;
  me?: Me;
  at: number;
}
type VaultBook = Record<string, VaultEntry>;

/** Когда менялся вход аккаунта на устройстве и каким он был (отпечаток): `id → {at, sig}`. */
const VAULT_AT = "@local.vault.nh.at";
/** Прежние записи (ключи API; входы под ключом защиты) — стираются на устройстве. */
const OLD_KEYS = ["nhentai.apiKeys.v1", "vault.nhentai.v1"];

const sig = (s: Saved | undefined) => `${fp(s?.access) ?? ""}|${fp(s?.refresh) ?? ""}|${fp(s?.apiKey) ?? ""}`;
const readAts = () => getJSON<Record<string, { at: number; sig: string }>>(VAULT_AT, {});

/** Отвергнутое nhentai — не раздавать: отозванные ключи и мёртвые токены обновления (отпечатки). */
const rejected = new Set<string>();
let book: VaultBook = {};
/** Последнее, что записали сами — своё же изменение не разбираем. */
let lastSealed: string | null = null;
let publishTimer = 0;

function schedulePublish() {
  window.clearTimeout(publishTimer);
  publishTimer = window.setTimeout(() => void publishVault(), 800);
}

async function publishVault() {
  const ats = readAts();
  let atsChanged = false;
  const next: VaultBook = { ...book };
  for (const [id, s] of Object.entries(sessions)) {
    const g = sig(s);
    if (ats[id]?.sig !== g) {
      ats[id] = { at: Date.now(), sig: g };
      atsChanged = true;
    }
    const prev = next[id];
    if (prev && prev.at >= ats[id].at) continue;
    // Чего на устройстве нет (вышли, сессия устарела) — оставляем из облака
    const pair = s.access && s.refresh ? { access: s.access, refresh: s.refresh } : prev?.access ? { access: prev.access, refresh: prev.refresh } : {};
    const apiKey = s.apiKey ?? prev?.apiKey;
    next[id] = { ...pair, ...(apiKey ? { apiKey } : {}), me: s.me ?? prev?.me, at: ats[id].at };
  }
  for (const e of Object.values(next)) {
    if (e.apiKey && rejected.has(fp(e.apiKey)!)) delete e.apiKey;
    if (e.refresh && rejected.has(fp(e.refresh)!)) {
      delete e.access;
      delete e.refresh;
    }
  }
  if (atsChanged) setJSON(VAULT_AT, ats);
  const same = JSON.stringify(next) === JSON.stringify(book);
  book = next;
  if (same && lastSealed && getItem(NH_AUTH_KEY) === lastSealed) return;
  const raw = JSON.stringify(book);
  lastSealed = raw;
  setItem(NH_AUTH_KEY, raw);
}

/** Пришла запись из облака: взять более свежие входы. */
async function receiveVault() {
  const raw = getItem(NH_AUTH_KEY);
  if (raw && raw !== lastSealed) {
    let remote: VaultBook | null = null;
    try {
      remote = JSON.parse(raw) as VaultBook;
    } catch {
      /* битая запись — перезапишем своей */
    }
    if (remote && typeof remote === "object") {
      for (const [id, e] of Object.entries(remote)) if (e && typeof e.at === "number" && (!book[id] || e.at > book[id].at)) book[id] = e;
    }
  }
  const ats = readAts();
  let next = sessions;
  for (const [id, e] of Object.entries(book)) {
    if (e.at <= (ats[id]?.at ?? 0)) continue;
    const cur = next[id];
    const pair = e.access && e.refresh && !rejected.has(fp(e.refresh)!) ? { access: e.access, refresh: e.refresh } : null;
    const key = e.apiKey && !rejected.has(fp(e.apiKey)!) ? e.apiKey : null;
    const updated: Saved = { ...cur, ...(pair ? { ...pair, expired: undefined, dead: undefined } : {}), ...(key ? { apiKey: key } : {}), me: cur?.me ?? e.me };
    next = { ...next, [id]: updated };
    ats[id] = { at: e.at, sig: sig(updated) };
    // Открытый сейчас аккаунт без рабочего входа — сразу войти
    if (currentNhUserId() === Number(id)) {
      if (pair && !hasUserSession() && !isSwappingAuth()) void swapNhAccount({ ...pair, ...(key ? { apiKey: key } : {}) }, updated.me, Number(id));
      else if (key && !loadAccountKey()) storeAccountKey(key);
    }
  }
  setJSON(VAULT_AT, ats);
  if (next !== sessions) {
    sessions = next;
    setJSON(SESSIONS_KEY, sessions);
    notify();
  }
  schedulePublish();
}

subscribeKey(NH_AUTH_KEY, () => void receiveVault());
// Прежние записи — стереть
const dropPlain = () => OLD_KEYS.forEach((k) => getItem(k) != null && removeItem(k));
queueMicrotask(() => {
  dropPlain();
  void receiveVault();
});

/** Запомнить сессию текущего аккаунта (после входа, обновления токенов, загрузки профиля). */
export function rememberCurrentSession(me?: Me | null): void {
  // Подмена входа ещё идёт: токены уже нового аккаунта, а `me` — прежнего
  if (isSwappingAuth()) return;
  const id = me?.id ?? currentNhUserId();
  if (!id) return;
  const prev = sessions[id];
  const next = keepKey(currentAuth(me ?? prev?.me), prev);
  if (!next) return;
  if (prev && prev.access === next.access && prev.refresh === next.refresh && prev.apiKey === next.apiKey && prev.me === next.me) return;
  sessions = { ...sessions, [id]: next };
  save();
}

/** Вход, который сейчас в клиенте (сессия устарела — только ключ). */
function currentAuth(me?: Me): Saved | null {
  const access = loadAccessToken() ?? undefined;
  const refresh = loadRefreshToken() ?? undefined;
  const apiKey = loadAccountKey() ?? undefined;
  const s: Saved = { ...(access && refresh ? { access, refresh } : {}), ...(apiKey ? { apiKey } : {}), me };
  return usable(s) ? s : null;
}

/**
 * Ключ, который у аккаунта уже был, не теряется, если в клиенте его сейчас нет (сессия пришла из привязки без
 * ключа, ключ ещё не подгрузился). Убирает ключ только `dropAccountKey` — когда nhentai его отверг.
 */
function keepKey(next: Saved | null, prev: Saved | undefined): Saved | null {
  if (!next || next.apiKey || !prev?.apiKey) return next;
  return { ...next, apiKey: prev.apiKey };
}

/** Текущий вход — точно этого аккаунта (подтвердил ответ профиля): сохранить под ним. */
export function rememberSessionOf(me: Me): void {
  const next = keepKey(currentAuth(me), sessions[me.id]);
  if (!next) return;
  sessions = { ...sessions, [me.id]: next };
  save();
}

// Привязка MoeLibre забирает ключи устройства, которых у неё нет (`mlNhentai.ts`)
nhLinkHooks.localKey = (id) => sessions[id]?.apiKey;

/** Ключ аккаунта получен (создан после входа или пришёл из привязки) — запомнить. */
export function rememberAccountKey(id: number, apiKey: string): void {
  const prev = sessions[id];
  if (prev?.apiKey === apiKey) return;
  sessions = { ...sessions, [id]: { ...prev, apiKey } };
  save();
}

/** Ключ отозвали на сайте — забыть его у аккаунта. */
export function dropAccountKey(apiKey: string): void {
  const id = Object.keys(sessions).find((k) => sessions[k].apiKey === apiKey);
  if (!id) return;
  const { apiKey: _k, ...rest } = sessions[id];
  void _k;
  sessions = { ...sessions, [id]: rest };
  rejected.add(fp(apiKey)!);
  save();
}

/**
 * Что о входе аккаунта известно на устройстве сразу, без сети: `usable` — есть сессия или ключ,
 * `expired` — отмечено «сессия устарела», `none` — ничего (вход возьмут из привязки MoeLibre).
 */
export function savedAuthKind(id: number): "usable" | "expired" | "none" {
  const s: Saved | undefined = sessions[id];
  if (s?.expired && !s.apiKey) return "expired";
  if (usable(s)) return "usable";
  return "none";
}

/** Есть ли у аккаунта ключ на устройстве. */
export const hasAccountKey = (id: number) => !!sessions[id]?.apiKey;

/** Сессия аккаунта устарела: токены забываем, ключ и профиль оставляем. */
export function markSessionExpired(id: number | null, deadRefresh?: string | null): void {
  if (!id) return;
  const prev = sessions[id];
  const dead = fp(deadRefresh) ?? prev?.dead;
  if (dead) rejected.add(dead);
  if (prev?.expired && !prev.access && prev.dead === dead) return;
  sessions = { ...sessions, [id]: { ...(prev?.apiKey ? { apiKey: prev.apiKey } : {}), me: prev?.me, expired: true, ...(dead ? { dead } : {}) } };
  save();
}

/** Сессия из привязки — та же, что nhentai уже отверг (на другом устройстве ещё не входили заново). */
const isDead = (id: number, auth: NhAuth | null) => !!auth?.refresh && !!sessions[id]?.dead && fp(auth.refresh) === sessions[id]!.dead;

/**
 * Что со входом аккаунта: `key` — ключ и сессия (всё хорошо); `keyOnly` — сессия устарела, работает по ключу;
 * `noKey` — сессия есть, ключа нет (может устареть); `expired` — входа нет, нужно войти; `unknown` — не знаем.
 * `link` — сведения привязки MoeLibre (там могут быть сессия и ключ, которых нет на устройстве).
 */
export type AccountAuth = "key" | "keyOnly" | "noKey" | "expired" | "unknown";

export function accountAuth(id: number, link?: { has_session?: boolean; has_key?: boolean } | null): AccountAuth {
  const s = sessions[id];
  const key = !!s?.apiKey || !!link?.has_key;
  const session = !!(s?.access && s.refresh) || (!s?.expired && !!link?.has_session);
  if (key && session) return "key";
  if (key) return "keyOnly";
  if (session) return "noKey";
  if (s?.expired || link) return "expired";
  return "unknown";
}

/** Перерисовка при изменении сохранённых входов. */
export function useSessionsVersion(): number {
  return useSyncExternalStore(
    (cb) => {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
    () => version,
  );
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
export async function repairSavedSession(id: number): Promise<NhAuth | null> {
  const cur = sessions[id];
  if (cur && (cur.access ?? null) === loadAccessToken() && (cur.apiKey ?? null) === loadAccountKey()) forgetSession(id);
  if (!mlSignedIn()) return null;
  return pullNhSession(id);
}

/** Ключ аккаунта из привязки — на устройство (и в клиент, если аккаунт сейчас открыт). */
async function fetchKeyFromLink(id: number) {
  const pulled = await pullNhSession(id);
  if (!pulled?.apiKey) return;
  rememberAccountKey(id, pulled.apiKey);
  if (currentNhUserId() === id && !loadAccountKey()) storeAccountKey(pulled.apiKey);
}

/** Привязанные аккаунты, чей вход из привязки уже проверяли (за этот запуск). */
const linkChecked = new Set<number>();

/**
 * Привязка говорит «сессия есть», а на устройстве входа нет: проверить, живая ли она (профиль по токену,
 * при 401 — обновление). Живая — сохраняем на устройстве (и обновлённую — обратно в привязку), мёртвая —
 * отмечаем «сессия устарела». Иначе в списках у невошедшего аккаунта значилось бы «нет ключа API».
 */
async function checkLinkedSession(id: number): Promise<void> {
  const cur: Saved | undefined = sessions[id];
  if (linkChecked.has(id) || cur?.expired || usable(cur) || id === currentNhUserId()) return;
  linkChecked.add(id);
  const pulled = await pullNhSession(id);
  if (usable(sessions[id]) || id === currentNhUserId()) return; // пока ждали — вошли
  if (!pulled) return markSessionExpired(id);
  const keep = (auth: NhAuth, me?: Me) => {
    sessions = { ...sessions, [id]: { ...(auth.access && auth.refresh ? { access: auth.access, refresh: auth.refresh } : {}), ...(auth.apiKey ? { apiKey: auth.apiKey } : {}), me: me ?? sessions[id]?.me } };
    save();
  };
  const authFailed = (e: unknown) => e instanceof ApiError && (e.status === 401 || e.status === 403 || e.status === 400);
  if (!pulled.access || !pulled.refresh) {
    // Только ключ — сессии нет, работает по ключу
    keep(pulled);
    return markSessionExpired(id);
  }
  try {
    const me = await getMeWithToken(pulled.access);
    if (me.id === id) keep(pulled, me);
    return;
  } catch (e) {
    if (!authFailed(e)) return void linkChecked.delete(id); // сеть — проверим в другой раз
  }
  try {
    const t = await refreshTokens(pulled.refresh);
    const me = await getMeWithToken(t.access_token);
    if (me.id !== id) return markSessionExpired(id);
    keep({ access: t.access_token, refresh: t.refresh_token, apiKey: pulled.apiKey }, me);
    void putNhSession(id, t.access_token, t.refresh_token);
  } catch (e) {
    if (!authFailed(e)) return void linkChecked.delete(id);
    if (pulled.apiKey) keep({ apiKey: pulled.apiKey });
    markSessionExpired(id, pulled.refresh);
  }
}

let switching: Promise<boolean> | null = null;

/**
 * Сделать аккаунт текущим в клиенте nhentai: null — без входа (сессии не отзываются, остаются на устройстве).
 * false — сессии этого аккаунта нет ни на устройстве, ни в привязке MoeLibre.
 */
export async function activateNhAccount(id: number | null): Promise<boolean> {
  while (switching) await switching.catch(() => undefined);
  // «Без входа» — только если в клиенте действительно ничего нет: профиль мог ещё не загрузиться, а токены
  // или ключ прошлого аккаунта лежат (иначе вкладка тихо работала под чужим аккаунтом)
  if (id === currentNhUserId() && (id !== null || !hasSession())) return true;
  switching = (async () => {
    if (id === null) {
      await swapNhAccount(null);
      return true;
    }
    const saved: Saved | undefined = sessions[id];
    let s: Saved | undefined = saved;
    // Входа на устройстве нет — из привязки MoeLibre (сессия и ключ). Список привязок при запуске ещё мог
    // не загрузиться (тогда раньше сразу «нет сессии») — спрашиваем сервис напрямую
    if (!usable(s) && mlSignedIn()) {
      const pulled = await pullNhSession(id);
      // Мёртвую сессию не пробуем снова (только ключ, если он есть)
      if (pulled && isDead(id, pulled)) s = pulled.apiKey ? { apiKey: pulled.apiKey, me: saved?.me } : undefined;
      else if (pulled) s = { ...pulled, me: saved?.me };
    }
    if (!usable(s)) {
      // Входа нет ни на устройстве, ни в привязке — показываем, что нужно войти
      markSessionExpired(id);
      return false;
    }
    // Ключа на устройстве нет, а в привязке может быть — заберём в фоне
    if (!s.apiKey && mlSignedIn()) void fetchKeyFromLink(id);
    await swapNhAccount(s, s.me, id);
    // Сессия оказалась чужой или мёртвой (обновить не вышло) — не вошли; входа нет — так и отметим
    if (currentNhUserId() !== id) {
      if (!hasSession()) markSessionExpired(id, s.refresh);
      return false;
    }
    return true;
  })();
  notify(); // экраны, которые ждут конца переключения (AccountNotice)
  try {
    return await switching;
  } finally {
    switching = null;
    notify();
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

/** Сессии, у которых уже пробовали узнать профиль (за этот запуск). */
const profileTried = new Set<string>();

/**
 * Профили сессий, сохранённых без профиля (вход прошёл, а ответ профиля не дошёл), — по их собственным
 * токенам. Иначе в списке вместо ника и аватара «#5912619».
 */
function fillMissingProfiles() {
  for (const [id, s] of Object.entries(sessions)) {
    if (s.me || profileTried.has(id) || !(s.access || s.apiKey)) continue;
    profileTried.add(id);
    void getMeWithToken(s.access ?? "", s.access ? undefined : s.apiKey)
      .then((me) => {
        const cur = sessions[id];
        if (!cur || cur.me || String(me.id) !== id) return;
        sessions = { ...sessions, [id]: { ...cur, me } };
        save();
      })
      .catch(() => profileTried.delete(id));
  }
}

let linksAsked = false;

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
  useEffect(() => {
    fillMissingProfiles();
    // Привязка говорит «сессия есть» — проверить, живая ли (иначе статус врёт)
    for (const a of link.accounts ?? []) if (a.has_session) void checkLinkedSession(a.id);
    // Список привязок ещё не загружен (не дошёл при запуске) — ещё раз
    if (link.accounts === null && mlSignedIn() && !linksAsked) {
      linksAsked = true;
      void refreshNhLinks().finally(() => (linksAsked = false));
    }
  }, [link.accounts]);
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
