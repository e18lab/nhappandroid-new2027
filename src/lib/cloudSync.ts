/**
 * Облако MoeLibre (cloud.moelibre.cc) — данные по аккаунту MoeLibre ID, разложенные по частям:
 *  - `app` — настройки приложения (тема, язык, вид…);
 *  - `app.pc` / `app.mobile` — раскладка своего типа устройства (сетка, полный экран);
 *  - `tabs` — вкладки браузера: один список на все устройства, у каждой вкладки свой аккаунт и фильтры;
 *  - `res:nhentai` — общее для ресурса (история поиска, теги и фильтры каталога);
 *  - `acc:nhentai:<id>` — сохранения аккаунта nhentai (закладки, история чтения, онлайн-избранное).
 * Облако по умолчанию выключено: включает пользователь (`enableCloud`), выключенное ничего не принимает.
 *
 * Каждый ключ хранится как `{v, t}` — значение и время изменения на устройстве (`@local.cloud.t`). Обычные
 * ключи — побеждает более позднее изменение; закладки (журнал), онлайн-избранное, история чтения и поиска
 * сливаются по содержимому (`MERGERS`, те же правила на сервере). Ключи, которых облако не знает, уходят
 * с устройства; значения, которых устройство не трогало, берутся из облака.
 *
 * Библиотека (закладки, история) у каждого аккаунта nhentai своя: при смене аккаунта на устройстве она
 * откладывается (`@local.stash.nhentai.<id>`) и возвращается при входе обратно — даже без облака.
 * Части, выключенные на этом устройстве (`@local.cloud.off`), не отправляются и не принимаются.
 * Без входа в MoeLibre облака нет; старое облако nappi больше не используется (перенос — `importFromNappi`).
 */
import { useSyncExternalStore } from "react";
import { getDeviceId, getDeviceName } from "./device";
import { getMlAccount, mlAccessToken, mlFetch, mlSignedIn, subscribeMl } from "./mlid";
import { IS_DESKTOP } from "./platform";
import { getAll, getItem, KEYS, removeItem, setItem, subscribe } from "./storage";

export const ML_CLOUD_URL: string = (import.meta.env.VITE_ML_CLOUD_URL || "https://cloud.moelibre.cc").replace(/\/+$/, "");

const FAV_OPS_KEY = "bookFavorites.ops.v1";
const API_KEYS_KEY = "nhentai.apiKeys.v1";
export const VAULT_NH_KEY = "vault.nhentai.v1";
const META_KEY = "@local.cloud.t";
const OFF_KEY = "@local.cloud.off";
const STASH_PREFIX = "@local.stash.nhentai.";

const PUSH_DEBOUNCE_MS = 900;
const PING_INTERVAL_MS = 5_000;
const META_SAVE_MS = 1_500;

const PLATFORM_PART = IS_DESKTOP ? "app.pc" : "app.mobile";

// ─── Какой ключ в какой части ─────────────────────────────────────────────────

/** Только на устройстве: вход, служебное, кеши, пути на диске. Список закладок выводится из журнала. */
const LOCAL_PREFIXES = ["@auth", "@v2.", "@nh.", "@local.", "@cloud.", "@online."];
const LOCAL_KEYS = new Set<string>([
  KEYS.cloudDeviceId,
  KEYS.cloudAppVersion,
  KEYS.savePath,
  KEYS.me,
  KEYS.favorites,
  "nh.csrf",
  "legacyImport.v1",
  "profile.me",
  "comments.cache",
  "ota.url",
  "ota.auto",
  // Фильтры каталога — у каждой вкладки свои, едут в облако вместе с вкладками
  KEYS.tagFilter,
  KEYS.searchSort,
  KEYS.dateRange,
  KEYS.pagesFilter,
  // Раздел главной — тоже у вкладки
  "ui.home.tab",
]);

/** Сохранения аккаунта nhentai. */
const ACC_KEYS = new Set<string>([FAV_OPS_KEY, KEYS.favoritesOnline, KEYS.readHistory]);
/** Общее для ресурса nhentai. */
const RES_KEYS = new Set<string>([
  KEYS.searchHistory,
  KEYS.tagFavorites,
  KEYS.tagFavoritesLegacy,
  "tagRecents.v1",
  "tagCollections.v1",
  KEYS.queryFavoritesOnline,
  KEYS.recommendationCalibration,
  // Прежние ключи API открытым текстом — только чтобы стереть их из облака (`nhAccounts.ts`)
  API_KEYS_KEY,
  // Входы аккаунтов nhentai, зашифрованные ключом защиты (`nhAccounts.ts`, `vault.ts`)
  VAULT_NH_KEY,
]);
/** Раскладка своего типа устройства. */
const LAYOUT_KEYS = new Set<string>([KEYS.galleryColumns, KEYS.gridConfig, KEYS.fullscreen]);
const TABS_KEY = "browser.tabs.v1";

/** Ключи библиотеки аккаунта — откладываются при смене аккаунта nhentai. Кеши — просто стираются. */
const LIBRARY_KEYS = [KEYS.favorites, FAV_OPS_KEY, KEYS.favoritesOnline, KEYS.readHistory];
const LIBRARY_CACHES = ["@online.imported.cache", "@online.pendingFavorites.queue", "comments.cache", "profile.me", KEYS.me];

const isLocal = (k: string) => LOCAL_KEYS.has(k) || LOCAL_PREFIXES.some((p) => k.startsWith(p));

export const accPart = (nhId: number) => `acc:nhentai:${nhId}`;

/** Часть ключа; null — ключ только на устройстве (или аккаунта nhentai нет). */
export function partOf(key: string, nhId: number | null = nhAccount): string | null {
  if (isLocal(key)) return null;
  if (ACC_KEYS.has(key)) return nhId ? accPart(nhId) : null;
  if (key === TABS_KEY) return "tabs";
  if (RES_KEYS.has(key)) return "res:nhentai";
  if (LAYOUT_KEYS.has(key)) return PLATFORM_PART;
  return "app";
}

// ─── Слияние (как services/cloud/src/merge.ts) ────────────────────────────────

const parse = (s: string | null): unknown => {
  if (s == null) return null;
  try {
    return JSON.parse(s);
  } catch {
    return null;
  }
};

type FavOps = Record<string, { liked: boolean; at: number }>;

function favOps(s: string | null): FavOps {
  const raw = parse(s);
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};
  const out: FavOps = {};
  for (const [id, v] of Object.entries(raw as Record<string, unknown>)) {
    const n = Number(id);
    if (!Number.isFinite(n) || n <= 0 || !v || typeof v !== "object") continue;
    const r = v as Record<string, unknown>;
    out[String(Math.floor(n))] = { liked: r.liked === true, at: Math.max(0, Math.floor(Number(r.at) || 0)) };
  }
  return out;
}

const idList = (s: string | null): number[] => {
  const raw = parse(s);
  return Array.isArray(raw) ? raw.map(Number).filter((n) => Number.isFinite(n) && n > 0) : [];
};

type Hist = [number, number, number, number];

function history(s: string | null): Map<number, Hist> {
  const m = new Map<number, Hist>();
  const raw = parse(s);
  if (!Array.isArray(raw)) return m;
  for (const e of raw) {
    if (!Array.isArray(e) || e.length < 4) continue;
    const id = Number(e[0]);
    if (!Number.isFinite(id) || id <= 0) continue;
    let ts = Math.floor(Number(e[3]) || 0);
    if (ts > 10_000_000_000) ts = Math.floor(ts / 1000);
    const row: Hist = [id, Math.max(0, Math.floor(Number(e[1]) || 0)), Math.max(1, Math.floor(Number(e[2]) || 1)), ts];
    const prev = m.get(id);
    if (!prev || row[3] > prev[3] || (row[3] === prev[3] && row[1] > prev[1])) m.set(id, row);
  }
  return m;
}

const strings = (s: string | null): string[] => {
  const raw = parse(s);
  return Array.isArray(raw) ? raw.map((x) => String(x).trim()).filter(Boolean) : [];
};

type Merger = (a: string, b: string, aNewer: boolean) => string;

const MERGERS: Record<string, Merger> = {
  [FAV_OPS_KEY]: (a, b) => {
    const out = favOps(a);
    for (const [id, op] of Object.entries(favOps(b))) if (!out[id] || op.at >= out[id].at) out[id] = op;
    return JSON.stringify(out);
  },
  [KEYS.favoritesOnline]: (a, b) => JSON.stringify([...new Set([...idList(a), ...idList(b)])].sort((x, y) => x - y)),
  [KEYS.readHistory]: (a, b) => {
    const out = history(a);
    for (const [id, row] of history(b)) {
      const prev = out.get(id);
      if (!prev || row[3] > prev[3] || (row[3] === prev[3] && row[1] > prev[1])) out.set(id, row);
    }
    return JSON.stringify([...out.values()].sort((x, y) => y[3] - x[3]));
  },
  [KEYS.searchHistory]: (a, b, aNewer) => JSON.stringify([...new Set(aNewer ? [...strings(a), ...strings(b)] : [...strings(b), ...strings(a)])].slice(0, 40)),
};

// ─── Журнал закладок ↔ список закладок ────────────────────────────────────────

/** Пока пишем данные облака, события хранилища не должны запускать отправку. */
let applying = false;

function writeQuiet(key: string, value: string | null) {
  applying = true;
  try {
    if (value == null) removeItem(key);
    else setItem(key, value);
  } finally {
    applying = false;
  }
}

/** Сверить журнал с текущими закладками: новые — «добавлена сейчас», пропавшие — «убрана сейчас». true — журнал изменился. */
function reconcileFavOps(): boolean {
  const favs = idList(getItem(KEYS.favorites));
  const stored = getItem(FAV_OPS_KEY);
  if (stored == null) {
    // Журнала ещё нет — заводим с временем 0, чтобы старые закладки не перебивали удаления с других устройств
    const seeded: FavOps = {};
    for (const id of favs) seeded[String(id)] = { liked: true, at: 0 };
    writeQuiet(FAV_OPS_KEY, JSON.stringify(seeded));
    return favs.length > 0;
  }
  const ops = favOps(stored);
  const now = Date.now();
  const current = new Set(favs.map(String));
  let changed = false;
  for (const id of current) if (!ops[id]?.liked) ((ops[id] = { liked: true, at: now }), (changed = true));
  for (const [id, op] of Object.entries(ops)) if (op.liked && !current.has(id)) ((ops[id] = { liked: false, at: now }), (changed = true));
  if (changed) writeQuiet(FAV_OPS_KEY, JSON.stringify(ops));
  return changed;
}

/** Список закладок из журнала: локальный порядок «по добавлению» сохраняется, новые — в конец по времени. */
function deriveFavorites() {
  const ops = favOps(getItem(FAV_OPS_KEY));
  const liked = Object.entries(ops)
    .filter(([, op]) => op.liked)
    .sort((a, b) => a[1].at - b[1].at)
    .map(([id]) => Number(id));
  const likedSet = new Set(liked);
  const kept = idList(getItem(KEYS.favorites)).filter((id) => likedSet.has(id));
  const keptSet = new Set(kept);
  const next = JSON.stringify([...kept, ...liked.filter((id) => !keptSet.has(id))]);
  if (getItem(KEYS.favorites) !== next) writeQuiet(KEYS.favorites, next);
}

// ─── Отметки времени и выключенные части ──────────────────────────────────────

let meta: Record<string, number> = (() => {
  try {
    const raw = JSON.parse(getItem(META_KEY) || "{}");
    return raw && typeof raw === "object" ? raw : {};
  } catch {
    return {};
  }
})();
let metaTimer: ReturnType<typeof setTimeout> | null = null;

/**
 * Ключ отметки времени: у сохранений аккаунта — своя на каждый аккаунт. Раньше отметка была общей на ключ,
 * и при переходе в другой аккаунт его пустая (ещё не загруженная) история «новее» облачной — облако затиралось.
 */
const mk = (part: string, key: string) => (part.startsWith("acc:") ? `${part}\u0000${key}` : key);

function touch(key: string, t: number, part: string | null = partOf(key)) {
  key = part ? mk(part, key) : key;
  meta[key] = t;
  if (!metaTimer) metaTimer = setTimeout(saveMeta, META_SAVE_MS);
}

function saveMeta() {
  metaTimer = null;
  setItem(META_KEY, JSON.stringify(meta));
}

function readOff(): string[] {
  try {
    const raw = JSON.parse(getItem(OFF_KEY) || "[]");
    return Array.isArray(raw) ? raw.filter((x): x is string => typeof x === "string") : [];
  } catch {
    return [];
  }
}

// ─── Состояние ────────────────────────────────────────────────────────────────

export type CloudStatus = "off" | "connecting" | "online" | "retry";

export interface CloudState {
  /** Включено ли облако у аккаунта MoeLibre; null — ещё не знаем (нет входа или нет связи). */
  enabled: boolean | null;
  status: CloudStatus;
  pingMs: number | null;
  peers: { device_id: string; device_name: string | null }[];
  lastSync: { at: number; fromDeviceId: string; part: string; keysCount: number; recipientCount: number } | null;
  /** Части, которые слушает это устройство. */
  parts: string[];
  /** Части, выключенные на этом устройстве. */
  off: string[];
  /** Последняя ошибка записи (облако переполнено и т. п.). */
  error: string | null;
  /** Задан ли у аккаунта ключ защиты (второй фактор); null — не знаем. */
  vault: boolean | null;
  /** Введён ли ключ защиты на этом устройстве (сервер пускает в облако); null — не знаем. */
  granted: boolean | null;
}

let state: CloudState = { enabled: null, status: "off", pingMs: null, peers: [], lastSync: null, parts: [], off: readOff(), error: null, vault: null, granted: null };
const listeners = new Set<() => void>();

function patch(next: Partial<CloudState>) {
  state = { ...state, ...next };
  for (const fn of listeners) fn();
}

export function getCloudState(): CloudState {
  return state;
}

export function useCloudState(): CloudState {
  return useSyncExternalStore(
    (cb) => {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
    () => state,
  );
}

export const platformPart = PLATFORM_PART;

/** Части устройства сейчас (без учёта выключенных). */
export function deviceParts(): string[] {
  return ["app", PLATFORM_PART, "tabs", "res:nhentai", ...(nhAccount ? [accPart(nhAccount)] : [])];
}

export const isPartOn = (part: string) => !state.off.includes(part);

/** Все части, о которых знает устройство: свои, раскладки обоих типов устройств, вкладки, аккаунты. */
export function allKnownParts(accountIds: number[], serverParts: string[] = []): string[] {
  const base = ["app", "app.pc", "app.mobile", "tabs", "res:nhentai", ...accountIds.map(accPart)];
  return [...new Set([...base, ...serverParts])];
}

/** Часть слушается этим устройством сейчас (своя раскладка, аккаунт открытой вкладки). */
export const isPartActive = (part: string) => deviceParts().includes(part);

/** Включить или выключить часть на этом устройстве. Включили — устройство сразу догоняет облако. */
export function setPartOn(part: string, on: boolean): void {
  const off = on ? state.off.filter((p) => p !== part) : [...new Set([...state.off, part])];
  setItem(OFF_KEY, JSON.stringify(off));
  patch({ off });
  resubscribe(on ? part : null);
}

/** Сколько записей в части на этом устройстве (для страниц облака). */
export function localPartSummary(part: string): { keys: number; favorites?: number; history?: number; searches?: number } {
  let keys = 0;
  for (const k of Object.keys(getAll())) if (partOf(k) === part) keys++;
  if (part.startsWith("acc:")) return { keys, favorites: idList(getItem(KEYS.favorites)).length, history: history(getItem(KEYS.readHistory)).size };
  if (part.startsWith("res:")) return { keys, searches: strings(getItem(KEYS.searchHistory)).length };
  return { keys };
}

// ─── Соединение ───────────────────────────────────────────────────────────────

let nhAccount: number | null = null;
let ws: WebSocket | null = null;
let ready = false;
let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
let reconnectAttempt = 0;
let pingTimer: ReturnType<typeof setInterval> | null = null;
let pendingPing: { id: number; t: number } | null = null;
let seq = 0;
let pushTimer: ReturnType<typeof setTimeout> | null = null;
/** Ключи, ждущие отправки, по частям. */
const pending = new Map<string, Set<string>>();
/** Части, присланные сервером целиком в этом соединении. */
const loaded = new Set<string>();

function send(msg: unknown): boolean {
  if (!ws || ws.readyState !== WebSocket.OPEN) return false;
  try {
    ws.send(JSON.stringify(msg));
    return true;
  } catch {
    return false;
  }
}

// Без ключа защиты на устройстве сервер частей не отдаёт и записей не принимает
const activeParts = () => (state.enabled && state.granted ? deviceParts().filter(isPartOn) : []);

/** Сообщить серверу, какие части слушаем. `fresh` — часть, которую надо получить заново (включили на устройстве). */
function resubscribe(fresh: string | null = null) {
  const parts = activeParts();
  patch({ parts });
  if (!ready) return;
  if (fresh) {
    loaded.delete(fresh);
    // Сервер шлёт часть только новым подпискам — переподписываемся без неё и с ней
    send({ type: "sub", parts: parts.filter((p) => p !== fresh) });
  }
  send({ type: "sub", parts });
}

function markPending(part: string, key: string) {
  let set = pending.get(part);
  if (!set) pending.set(part, (set = new Set()));
  set.add(key);
  schedulePush();
}

function schedulePush() {
  if (pushTimer) clearTimeout(pushTimer);
  pushTimer = setTimeout(flush, PUSH_DEBOUNCE_MS);
}

/** Отправить всё, что ждёт, — только в загруженные части (иначе сперва нужно узнать, что в облаке). */
function flush() {
  pushTimer = null;
  if (!ready || !state.enabled) return;
  for (const [part, keys] of pending) {
    if (!loaded.has(part) || !isPartOn(part)) continue;
    const changes: Record<string, { v: string | null; t: number }> = {};
    for (const key of keys) {
      const v = getItem(key);
      // Закладки и история не «удаляются» облаком: пустое значение — это «нет данных», а не «стереть»
      if (v == null && MERGERS[key]) continue;
      changes[key] = { v, t: meta[mk(part, key)] ?? 1 };
    }
    pending.delete(part);
    if (Object.keys(changes).length && !send({ type: "push", id: ++seq, part, changes })) {
      // Нет связи — вернуть в очередь
      for (const key of keys) markPending(part, key);
      return;
    }
  }
}

type Entry = { v: string | null; t: number };

/** Применить записи облака к устройству; `full` — пришла вся часть (ключи, которых в ней нет, отправляем). */
function applyEntries(part: string, entries: Record<string, Entry>, full: boolean) {
  let favTouched = false;
  for (const [key, e] of Object.entries(entries)) {
    if (partOf(key) !== part) continue;
    const local = getItem(key);
    const lt = meta[mk(part, key)] ?? 0;
    const merger: Merger | undefined = MERGERS[key];
    const mergeable = merger !== undefined;
    if (merger && e.v != null && local != null) {
      const merged = merger(local, e.v, lt >= e.t);
      if (merged !== local) writeQuiet(key, merged);
      touch(key, Math.max(lt, e.t), part);
      if (merged !== e.v) markPending(part, key);
    } else if (mergeable) {
      // Сливаемое и с одной стороны пусто — берём то, что есть
      if (e.v != null && local == null) {
        writeQuiet(key, e.v);
        touch(key, e.t, part);
      } else if (e.v == null && local != null) markPending(part, key);
    } else if (e.t > lt || (local == null && lt === 0)) {
      if (local !== e.v) writeQuiet(key, e.v);
      touch(key, e.t, part);
    } else if (e.t < lt && local !== e.v) {
      markPending(part, key);
    }
    if (key === FAV_OPS_KEY) favTouched = true;
  }
  if (favTouched) deriveFavorites();
  if (full) {
    for (const key of Object.keys(getAll())) if (!(key in entries) && partOf(key) === part) markPending(part, key);
    // Удалённые на устройстве ключи с отметкой времени — тоже отправить (сливаемые — нет, см. flush)
    for (const raw of Object.keys(meta)) {
      const key = raw.includes("\u0000") ? raw.slice(raw.indexOf("\u0000") + 1) : raw;
      if (mk(part, key) !== raw || key in entries || MERGERS[key]) continue;
      if (getItem(key) == null && partOf(key) === part) markPending(part, key);
    }
  }
}

function onMessage(event: MessageEvent) {
  if (typeof event.data !== "string") return;
  let msg: Record<string, unknown>;
  try {
    msg = JSON.parse(event.data);
  } catch {
    return;
  }
  switch (msg.type) {
    case "pong":
      if (pendingPing && msg.id === pendingPing.id) {
        patch({ pingMs: Date.now() - pendingPing.t });
        pendingPing = null;
      }
      return;
    case "ready":
      ready = true;
      reconnectAttempt = 0;
      loaded.clear();
      patch({ status: "online", enabled: msg.enabled === true, error: null, vault: msg.vault === true, granted: msg.granted === true });
      resubscribe();
      return;
    case "vault":
      loaded.clear();
      patch({ vault: msg.vault === true, granted: msg.granted === true });
      resubscribe();
      return;
    case "state":
      loaded.clear();
      patch({ enabled: msg.enabled === true });
      resubscribe();
      return;
    case "part": {
      const part = String(msg.part);
      if (!activeParts().includes(part)) return;
      loaded.add(part);
      applyEntries(part, (msg.data as Record<string, Entry>) ?? {}, true);
      schedulePush();
      return;
    }
    case "changes":
      if (activeParts().includes(String(msg.part))) applyEntries(String(msg.part), (msg.changes as Record<string, Entry>) ?? {}, false);
      return;
    case "ack":
      if (msg.echo && typeof msg.echo === "object") applyEntries(String(msg.part), msg.echo as Record<string, Entry>, false);
      return;
    case "nack":
      if (msg.code === "cloud_disabled") patch({ enabled: false, parts: [] });
      else if (msg.code === "vault_locked") patch({ granted: false, parts: [] });
      else patch({ error: String(msg.code) });
      return;
    case "peers":
      patch({
        peers: Array.isArray(msg.devices) ? (msg.devices as CloudState["peers"]) : state.peers,
        lastSync: (msg.lastSync as CloudState["lastSync"]) ?? state.lastSync,
      });
      return;
  }
}

function clearTimers() {
  if (reconnectTimer) clearTimeout(reconnectTimer);
  if (pingTimer) clearInterval(pingTimer);
  reconnectTimer = null;
  pingTimer = null;
  pendingPing = null;
}

function scheduleReconnect() {
  if (!mlSignedIn() || reconnectTimer) return;
  const delay = Math.min(30_000, Math.round(900 * 1.55 ** reconnectAttempt));
  reconnectAttempt++;
  patch({ status: "retry" });
  reconnectTimer = setTimeout(() => {
    reconnectTimer = null;
    connect();
  }, delay);
}

function connect() {
  if (!mlSignedIn()) return;
  if (ws && (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING)) return;
  let socket: WebSocket;
  try {
    socket = new WebSocket(`${ML_CLOUD_URL.replace(/^http/, "ws")}/v1/sync`);
  } catch {
    scheduleReconnect();
    return;
  }
  ws = socket;
  ready = false;
  if (state.status === "off") patch({ status: "connecting" });
  socket.onmessage = onMessage;
  socket.onopen = () => {
    if (ws !== socket) return;
    mlAccessToken().then(
      (token) => {
        if (ws === socket) send({ type: "auth", token, deviceId: getDeviceId(), deviceName: getDeviceName() });
      },
      () => socket.close(),
    );
    pingTimer = setInterval(() => {
      pendingPing = { id: ++seq, t: Date.now() };
      if (!send({ type: "ping", id: pendingPing.id, t: pendingPing.t })) pendingPing = null;
    }, PING_INTERVAL_MS);
  };
  socket.onclose = () => {
    if (ws !== socket) return;
    ws = null;
    ready = false;
    clearTimers();
    patch({ pingMs: null, peers: [] });
    scheduleReconnect();
  };
  socket.onerror = () => undefined;
}

function disconnect() {
  clearTimers();
  if (pushTimer) clearTimeout(pushTimer);
  pushTimer = null;
  pending.clear();
  loaded.clear();
  ready = false;
  if (ws) {
    const s = ws;
    ws = null;
    s.onopen = s.onmessage = s.onclose = s.onerror = null;
    try {
      s.close();
    } catch {
      /* уже закрыт */
    }
  }
  patch({ status: "off", enabled: null, pingMs: null, peers: [], lastSync: null, parts: [], vault: null, granted: null });
}

/** Синхронизировать сейчас: переподключиться — сервер пришлёт части заново, устройство отправит своё. */
export function syncNow(): void {
  if (!mlSignedIn()) return;
  if (ws) {
    flush();
    const s = ws;
    ws = null;
    s.onopen = s.onmessage = s.onclose = s.onerror = null;
    try {
      s.close();
    } catch {
      /* уже закрыт */
    }
  }
  clearTimers();
  reconnectAttempt = 0;
  ready = false;
  patch({ status: "connecting", pingMs: null });
  connect();
}

// ─── Аккаунт nhentai на устройстве ────────────────────────────────────────────

function stashLibrary(nhId: number) {
  const out: Record<string, string> = {};
  for (const k of LIBRARY_KEYS) {
    const v = getItem(k);
    if (v != null) out[k] = v;
  }
  setItem(STASH_PREFIX + nhId, JSON.stringify(out));
}

function clearLibrary() {
  for (const k of [...LIBRARY_KEYS, ...LIBRARY_CACHES]) writeQuiet(k, null);
}

function restoreLibrary(nhId: number) {
  let saved: Record<string, string> = {};
  try {
    saved = JSON.parse(getItem(STASH_PREFIX + nhId) || "{}");
  } catch {
    /* повреждено */
  }
  for (const k of LIBRARY_KEYS) if (typeof saved[k] === "string") writeQuiet(k, saved[k]);
}

/**
 * Аккаунт nhentai на устройстве сменился (вход, выход, переключение). Библиотека прежнего откладывается,
 * нового — возвращается из отложенного; облако подписывается на часть нового аккаунта.
 * Первый вход без прежнего аккаунта — библиотека остаётся как есть (это данные этого аккаунта).
 */
export function setCloudNhAccount(next: number | null): void {
  if (next === nhAccount) return;
  const prev = nhAccount;
  if (prev) {
    flush();
    stashLibrary(prev);
    clearLibrary();
    if (next) restoreLibrary(next);
  } else if (next && getItem(STASH_PREFIX + next) != null && !LIBRARY_KEYS.some((k) => getItem(k) != null)) {
    restoreLibrary(next);
  }
  if (prev) pending.delete(accPart(prev));
  nhAccount = next;
  if (prev) loaded.delete(accPart(prev));
  // Часть аккаунта — всегда заново с сервера: за время, что он был закрыт, её могли поменять (другое устройство,
  // перенос), а сервер сам присылает часть только при первой подписке
  resubscribe(next ? accPart(next) : null);
}

/** Выход из nhentai: библиотека аккаунта откладывается (вернётся при входе в него) и стирается с экрана. */
export function clearLibraryAfterLogout(): void {
  setCloudNhAccount(null);
}

// ─── Управление облаком (REST) ────────────────────────────────────────────────

export interface CloudInfo {
  enabled: boolean;
  enabled_at: string | null;
  vault: boolean;
  granted: boolean;
  parts: { part: string; bytes: number; keys: number; updated_at: string }[];
  imports: { source: string; external_id: string; decision: "imported" | "declined"; decided_at: string }[];
}

export async function fetchCloudInfo(): Promise<CloudInfo> {
  const info = await mlFetch<CloudInfo>(`${ML_CLOUD_URL}/v1/cloud?device=${encodeURIComponent(getDeviceId())}`);
  if (info.granted !== state.granted || info.vault !== state.vault) {
    loaded.clear();
    patch({ vault: info.vault, granted: info.granted });
    resubscribe();
  }
  return info;
}

/** Включить облако: только на устройстве, где введён ключ защиты (`vault.ts`). */
export async function enableCloud(): Promise<void> {
  await mlFetch(`${ML_CLOUD_URL}/v1/cloud/enable`, { method: "POST", body: JSON.stringify({ device_id: getDeviceId() }) });
  loaded.clear();
  patch({ enabled: true });
  resubscribe();
  if (!ws) syncNow();
}

/** Выключить облако на всех устройствах; `wipe` — заодно удалить данные с сервера. */
export async function disableCloud(wipe: boolean): Promise<void> {
  await mlFetch(`${ML_CLOUD_URL}/v1/cloud/disable`, { method: "POST", body: JSON.stringify({ wipe }) });
  patch({ enabled: false, parts: [] });
}

/** Копия облака файлом. */
export async function exportCloud(): Promise<void> {
  const data = await mlFetch<unknown>(`${ML_CLOUD_URL}/v1/cloud/export?device=${encodeURIComponent(getDeviceId())}`);
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = `moelibre-cloud-${new Date().toISOString().slice(0, 10)}.json`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 10_000);
}

// ─── Перенос из старого облака nappi ──────────────────────────────────────────

const NH_PREFIX = "NHENTAI_";

/** Снимок старого облака аккаунта nhentai (через mlnappi, по привязке). */
export async function fetchNappiSnapshot(nhId: number): Promise<Record<string, string>> {
  const { ML_NH_URL } = await import("./mlNhentai");
  const { storage } = await mlFetch<{ storage: Record<string, unknown> }>(`${ML_NH_URL}/v1/storage?nh=${nhId}`);
  const out: Record<string, string> = {};
  // Ключи сервера с префиксом NHENTAI_ главнее (непрефиксные могли остаться от старых клиентов)
  for (const [k, v] of Object.entries(storage ?? {})) {
    const key = k.startsWith(NH_PREFIX) ? k.slice(NH_PREFIX.length) : k;
    if (!k.startsWith(NH_PREFIX) && key in out) continue;
    out[key] = typeof v === "string" ? v : JSON.stringify(v);
  }
  // Старые клиенты писали только список закладок — заводим журнал
  if (!out[FAV_OPS_KEY] && out[KEYS.favorites]) {
    const ops: FavOps = {};
    for (const id of idList(out[KEYS.favorites])) ops[String(id)] = { liked: true, at: 0 };
    out[FAV_OPS_KEY] = JSON.stringify(ops);
  }
  return out;
}

/** Что есть в старом облаке — для окна переноса. */
export function summarizeSnapshot(snap: Record<string, string>): { favorites: number; history: number; settings: number } {
  let settings = 0;
  for (const k of Object.keys(snap)) {
    const p = partOf(k, 1);
    if (p === "app" || p === PLATFORM_PART) settings++;
  }
  return {
    favorites: Object.values(favOps(snap[FAV_OPS_KEY] ?? null)).filter((o) => o.liked).length,
    history: history(snap[KEYS.readHistory] ?? null).size,
    settings,
  };
}

/**
 * Перенести старое облако аккаунта в облако MoeLibre: ключи раскладываются по частям. Старые значения —
 * с самым ранним временем, поэтому настройки, уже заданные в MoeLibre, не перебиваются, а закладки
 * и история сливаются. Решение запоминается на сервере.
 */
export async function importFromNappi(nhId: number, snap: Record<string, string>): Promise<void> {
  const byPart = new Map<string, Record<string, Entry>>();
  for (const [k, v] of Object.entries(snap)) {
    const part = partOf(k, nhId);
    if (!part) continue;
    // Раскладка старого облака — для того типа устройства, с которого переносим
    if (!byPart.has(part)) byPart.set(part, {});
    byPart.get(part)![k] = { v, t: 1 };
  }
  for (const [part, changes] of byPart) {
    const keys = Object.keys(changes);
    for (let i = 0; i < keys.length; i += 400) {
      const chunk = Object.fromEntries(keys.slice(i, i + 400).map((k) => [k, changes[k]]));
      await mlFetch(`${ML_CLOUD_URL}/v1/cloud/parts/${encodeURIComponent(part)}/merge`, { method: "POST", body: JSON.stringify({ changes: chunk }) });
    }
  }
  await decideImport(nhId, "imported");
}

export const decideImport = (nhId: number, decision: "imported" | "declined") =>
  mlFetch(`${ML_CLOUD_URL}/v1/cloud/imports`, { method: "POST", body: JSON.stringify({ source: "nappi", external_id: String(nhId), decision }) });

// ─── Запуск ───────────────────────────────────────────────────────────────────

let started = false;

/** Один раз при старте (main.tsx), после `initMlId()`. Подключается, пока вошли в MoeLibre ID. */
export function initCloud(): void {
  if (started) return;
  started = true;
  reconcileFavOps();

  subscribe((key) => {
    if (applying || key === META_KEY) return;
    let k = key;
    if (key === KEYS.favorites) {
      if (!reconcileFavOps()) return;
      k = FAV_OPS_KEY;
    }
    const part = partOf(k);
    if (!part) return;
    touch(k, Date.now());
    if (state.enabled && isPartOn(part)) markPending(part, k);
  });

  let accountId = getMlAccount()?.id ?? null;
  subscribeMl(() => {
    const next = getMlAccount()?.id ?? null;
    if (next === accountId) return;
    accountId = next;
    disconnect();
    if (next) connect();
  });
  if (mlSignedIn()) connect();

  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "hidden") {
      if (pushTimer) flush();
    } else if (mlSignedIn() && !ws) {
      if (reconnectTimer) clearTimeout(reconnectTimer);
      reconnectTimer = null;
      reconnectAttempt = 0;
      connect();
    }
  });
}
