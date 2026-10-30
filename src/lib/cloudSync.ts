/**
 * Облачная синхронизация через лобби nappi — перенос `api/nhappApi/lobbyStorage.ts`, `cloudStorage.ts`,
 * `storageMerge.ts` и `hooks/useCloudStorageSync.ts`.
 *
 * Источник правды — комната пользователя на сервере. При подключении сервер присылает её снимок
 * (`{type:"storage"}`), клиент сливает его с локальным хранилищем и отправляет свой полный снимок;
 * сервер сливает и рассылает остальным устройствам, в БД пишет сам.
 *
 * Отличия от 1.3.1 (там стоял клиент из ветки `master`, отстающий от сервера):
 *  - сервер хранит ключи с префиксом `NHENTAI_`; при приёме префикс снимается (1.3.1 писал их как есть,
 *    поэтому облачные данные до него не доходили);
 *  - закладки синхронизируются журналом `bookFavorites.ops.v1` ({id: {liked, at}}), как ждёт сервер, —
 *    удалённая на одном устройстве книга не возвращается с другого;
 *  - отправка запускается любым изменением хранилища (`storage.subscribe`), а не ручными вызовами
 *    `requestStoragePush` по экранам.
 */
import { useSyncExternalStore } from "react";
import { LOBBY_WS_URL } from "../config/api";
import { APP_VERSION } from "../api/nappi";
import { getAll, getItem, KEYS, removeItem, setItem, subscribe } from "./storage";

const NH_PREFIX = "NHENTAI_";
const FAV_OPS_KEY = "bookFavorites.ops.v1";

/** Не уходят в облако и не принимаются из него: сессия, устройство, служебные флаги. */
const EXCLUDE_PREFIXES = ["@auth", "@v2.", "@nh."];
const EXCLUDE_KEYS = new Set<string>([KEYS.cloudDeviceId, "nh.csrf", "legacyImport.v1"]);

/** Эха нет и без паузы после приёма (в старом — 4 с): запись облачных данных не запускает отправку. */
const PUSH_DEBOUNCE_MS = 900;
/** После подключения ждём снимок комнаты, потом отправляем свой — чтобы не перетереть облачные настройки. */
const FIRST_PUSH_WAIT_MS = 2_500;
const PING_INTERVAL_MS = 2_000;

const syncable = (k: string) => !EXCLUDE_KEYS.has(k) && !EXCLUDE_PREFIXES.some((p) => k.startsWith(p));
const localKey = (k: string) => (k.startsWith(NH_PREFIX) ? k.slice(NH_PREFIX.length) : k);

// ─── Слияние (как src/lobby/storageMerge.ts на сервере) ───────────────────────

function parse(u: unknown): unknown {
  if (typeof u !== "string") return u;
  try {
    return JSON.parse(u);
  } catch {
    return null;
  }
}

function parseIdArray(u: unknown): number[] {
  const raw = parse(u);
  return Array.isArray(raw) ? raw.map(Number).filter((n) => Number.isFinite(n) && n > 0) : [];
}

type FavOps = Record<string, { liked: boolean; at: number }>;

function parseFavOps(u: unknown): FavOps {
  const raw = parse(u);
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};
  const out: FavOps = {};
  for (const [id, v] of Object.entries(raw as Record<string, unknown>)) {
    const n = Number(id);
    if (!Number.isFinite(n) || n <= 0 || !v || typeof v !== "object") continue;
    const rec = v as Record<string, unknown>;
    out[String(Math.floor(n))] = { liked: rec.liked === true, at: Math.max(0, Math.floor(Number(rec.at) || 0)) };
  }
  return out;
}

function mergeFavOps(a: FavOps, b: FavOps): FavOps {
  const out = { ...a };
  for (const [id, op] of Object.entries(b)) if (!out[id] || op.at >= out[id].at) out[id] = op;
  return out;
}

const idsFromOps = (ops: FavOps) =>
  Object.entries(ops)
    .filter(([, op]) => op.liked)
    .sort((a, b) => a[1].at - b[1].at)
    .map(([id]) => Number(id));

function mergeIds(a: unknown, b: unknown): number[] {
  return [...new Set([...parseIdArray(a), ...parseIdArray(b)])].sort((x, y) => x - y);
}

type Hist = [number, number, number, number];

function parseHistory(u: unknown): Map<number, Hist> {
  const m = new Map<number, Hist>();
  const raw = parse(u);
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

function mergeHistory(a: unknown, b: unknown): Hist[] {
  const out = parseHistory(a);
  for (const [id, row] of parseHistory(b)) {
    const prev = out.get(id);
    if (!prev || row[3] > prev[3] || (row[3] === prev[3] && row[1] > prev[1])) out.set(id, row);
  }
  return [...out.values()].sort((x, y) => y[3] - x[3]);
}

function mergeSearch(a: unknown, b: unknown): string[] {
  const list = (u: unknown) => {
    const raw = parse(u);
    return Array.isArray(raw) ? raw.map((x) => String(x).trim()).filter(Boolean) : [];
  };
  return [...new Set([...list(a), ...list(b)])].slice(0, 40);
}

// ─── Журнал закладок ──────────────────────────────────────────────────────────

/**
 * Сверяет журнал с текущими закладками: новые id — «добавлена сейчас», пропавшие — «убрана сейчас».
 * Если журнала ещё нет, он заводится с временем 0 — как сервер заводит его из старого списка id,
 * чтобы прежние закладки не перебивали удаления, сделанные на других устройствах.
 */
function reconcileFavOps(): FavOps {
  const favs = parseIdArray(getItem(KEYS.favorites));
  const stored = getItem(FAV_OPS_KEY);
  if (stored == null) {
    const seeded: FavOps = {};
    for (const id of favs) seeded[String(id)] = { liked: true, at: 0 };
    writeQuiet(FAV_OPS_KEY, JSON.stringify(seeded));
    return seeded;
  }
  const ops = parseFavOps(stored);
  const now = Date.now();
  const current = new Set(favs.map(String));
  let changed = false;
  for (const id of current) {
    if (!ops[id]?.liked) {
      ops[id] = { liked: true, at: now };
      changed = true;
    }
  }
  for (const [id, op] of Object.entries(ops)) {
    if (op.liked && !current.has(id)) {
      ops[id] = { liked: false, at: now };
      changed = true;
    }
  }
  if (changed) writeQuiet(FAV_OPS_KEY, JSON.stringify(ops));
  return ops;
}

// ─── Снимок и применение ──────────────────────────────────────────────────────

/** Пока применяем облако, события хранилища не должны запускать отправку. */
let applying = false;

function writeQuiet(key: string, value: string) {
  applying = true;
  try {
    setItem(key, value);
  } finally {
    applying = false;
  }
}

function collectLocal(): Record<string, string> {
  reconcileFavOps();
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(getAll())) if (syncable(k)) out[k] = v;
  out[KEYS.cloudAppVersion] = APP_VERSION;
  return out;
}

const asString = (v: unknown) => (typeof v === "string" ? v : JSON.stringify(v));

function applyRemote(remote: Record<string, unknown>): void {
  const localOps = reconcileFavOps();
  // Префиксные ключи сервера главнее непрефиксных (те могли остаться от старых клиентов)
  const incoming = new Map<string, unknown>();
  for (const [k, v] of Object.entries(remote)) {
    const lk = localKey(k);
    if (!syncable(lk) || lk === KEYS.cloudAppVersion) continue;
    if (k.startsWith(NH_PREFIX) || !incoming.has(lk)) incoming.set(lk, v);
  }

  const next = new Map<string, string>();
  if (incoming.has(FAV_OPS_KEY)) {
    const ops = mergeFavOps(localOps, parseFavOps(incoming.get(FAV_OPS_KEY)));
    next.set(FAV_OPS_KEY, JSON.stringify(ops));
    // Локальный порядок «по добавлению» сохраняем, новые книги — в конец по времени добавления
    const liked = idsFromOps(ops);
    const likedSet = new Set(liked);
    const kept = parseIdArray(getItem(KEYS.favorites)).filter((id) => likedSet.has(id));
    const keptSet = new Set(kept);
    next.set(KEYS.favorites, JSON.stringify([...kept, ...liked.filter((id) => !keptSet.has(id))]));
  } else if (incoming.has(KEYS.favorites)) {
    // Облако без журнала (писали только старые клиенты) — объединяем
    const local = parseIdArray(getItem(KEYS.favorites));
    const have = new Set(local);
    const added = parseIdArray(incoming.get(KEYS.favorites)).filter((id) => !have.has(id));
    if (added.length) next.set(KEYS.favorites, JSON.stringify([...local, ...added]));
  }
  incoming.delete(FAV_OPS_KEY);
  incoming.delete(KEYS.favorites);

  for (const [k, v] of incoming) {
    const local = getItem(k);
    if (k === KEYS.favoritesOnline) next.set(k, JSON.stringify(mergeIds(local, v)));
    else if (k === KEYS.readHistory) next.set(k, JSON.stringify(mergeHistory(local, v)));
    else if (k === KEYS.searchHistory) next.set(k, JSON.stringify(mergeSearch(local, v)));
    else next.set(k, asString(v));
  }

  applying = true;
  try {
    for (const [k, v] of next) if (getItem(k) !== v) setItem(k, v);
  } finally {
    applying = false;
  }
}

// ─── Лобби ────────────────────────────────────────────────────────────────────

export type CloudStatus = "off" | "connecting" | "online" | "retry";

export interface CloudState {
  status: CloudStatus;
  pingMs: number | null;
  peers: { device_id: string; device_name: string | null }[];
  lastSync: { at: number; fromDeviceId: string; keysCount: number; recipientCount: number } | null;
  /** Свой снимок хотя бы раз ушёл на сервер в этой сессии. */
  pushedOnce: boolean;
}

let state: CloudState = { status: "off", pingMs: null, peers: [], lastSync: null, pushedOnce: false };
const listeners = new Set<() => void>();

function patch(next: Partial<CloudState>) {
  state = { ...state, ...next };
  for (const fn of listeners) fn();
}

let creds: { userId: number; deviceId: string; deviceName: string } | null = null;
let ws: WebSocket | null = null;
let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
let reconnectAttempt = 0;
let pingTimer: ReturnType<typeof setInterval> | null = null;
let pendingPing: { id: number; t: number } | null = null;
let pingSeq = 0;
let pushTimer: ReturnType<typeof setTimeout> | null = null;
let firstPushTimer: ReturnType<typeof setTimeout> | null = null;
let unsubscribeStorage: (() => void) | null = null;
let onOpenHook: (() => void) | null = null;

function clearTimers() {
  for (const t of [reconnectTimer, pushTimer, firstPushTimer]) if (t) clearTimeout(t);
  reconnectTimer = pushTimer = firstPushTimer = null;
  if (pingTimer) clearInterval(pingTimer);
  pingTimer = null;
  pendingPing = null;
}

function send(msg: unknown): boolean {
  if (!ws || ws.readyState !== WebSocket.OPEN) return false;
  try {
    ws.send(JSON.stringify(msg));
    return true;
  } catch {
    return false;
  }
}

/** Отправить полный локальный снимок сейчас. */
function pushNow(): void {
  if (!creds) return;
  if (send({ type: "storage", storage: collectLocal() })) patch({ pushedOnce: true });
}

function schedulePush(): void {
  if (!creds) return;
  if (pushTimer) clearTimeout(pushTimer);
  pushTimer = setTimeout(() => {
    pushTimer = null;
    pushNow();
  }, PUSH_DEBOUNCE_MS);
}

function onMessage(event: MessageEvent) {
  if (typeof event.data !== "string") return;
  let msg: {
    type?: string;
    storage?: Record<string, unknown>;
    id?: number;
    count?: number;
    devices?: CloudState["peers"];
    lastSync?: CloudState["lastSync"];
  };
  try {
    msg = JSON.parse(event.data);
  } catch {
    return;
  }
  if (msg.type === "pong" && pendingPing && msg.id === pendingPing.id) {
    patch({ pingMs: Date.now() - pendingPing.t });
    pendingPing = null;
    return;
  }
  if (msg.type === "storage" && msg.storage && typeof msg.storage === "object") {
    applyRemote(msg.storage);
    // Первый снимок комнаты получен — можно отправить свой (сервер сольёт закладки и историю)
    if (firstPushTimer) {
      clearTimeout(firstPushTimer);
      firstPushTimer = null;
      pushNow();
    }
    return;
  }
  if (msg.type === "peers") {
    patch({
      peers: Array.isArray(msg.devices) ? msg.devices : state.peers,
      lastSync: msg.lastSync === undefined ? state.lastSync : msg.lastSync,
    });
  }
}

function scheduleReconnect() {
  if (!creds || reconnectTimer) return;
  const delay = Math.min(30_000, Math.round(900 * 1.55 ** reconnectAttempt));
  reconnectAttempt++;
  patch({ status: "retry" });
  reconnectTimer = setTimeout(() => {
    reconnectTimer = null;
    openSocket();
  }, delay);
}

function openSocket() {
  if (!creds) return;
  if (ws && (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING)) return;
  const params = new URLSearchParams({
    userId: String(creds.userId),
    deviceId: creds.deviceId,
    deviceName: creds.deviceName,
  });
  let socket: WebSocket;
  try {
    socket = new WebSocket(`${LOBBY_WS_URL}?${params}`);
  } catch {
    scheduleReconnect();
    return;
  }
  ws = socket;
  if (state.status === "off") patch({ status: "connecting" });
  socket.onmessage = onMessage;
  socket.onopen = () => {
    if (ws !== socket) return;
    reconnectAttempt = 0;
    patch({ status: "online" });
    pingTimer = setInterval(() => {
      pendingPing = { id: ++pingSeq, t: Date.now() };
      if (!send({ type: "ping", id: pendingPing.id, t: pendingPing.t })) pendingPing = null;
    }, PING_INTERVAL_MS);
    // Пустая комната снимок не присылает — тогда отправим свой по таймеру
    firstPushTimer = setTimeout(() => {
      firstPushTimer = null;
      pushNow();
    }, FIRST_PUSH_WAIT_MS);
    onOpenHook?.();
  };
  socket.onclose = () => {
    if (ws !== socket) return;
    ws = null;
    if (pingTimer) clearInterval(pingTimer);
    pingTimer = null;
    patch({ pingMs: null, peers: [] });
    scheduleReconnect();
  };
  socket.onerror = () => undefined;
}

function onVisibility() {
  if (!creds) return;
  if (document.visibilityState === "hidden") {
    // Уходим в фон — отправляем всё, что ещё ждёт задержки
    if (pushTimer) {
      clearTimeout(pushTimer);
      pushTimer = null;
      pushNow();
    }
  } else if (!ws) {
    if (reconnectTimer) clearTimeout(reconnectTimer);
    reconnectTimer = null;
    reconnectAttempt = 0;
    openSocket();
  }
}

/** Подключиться к лобби пользователя (повторный вызов с тем же id ничего не делает). */
export function startCloudSync(userId: number, deviceId: string, deviceName: string, onOpen?: () => void): void {
  if (creds?.userId === userId) return;
  stopCloudSync();
  creds = { userId, deviceId, deviceName };
  onOpenHook = onOpen ?? null;
  unsubscribeStorage = subscribe((key) => {
    if (!applying && syncable(key) && key !== FAV_OPS_KEY) schedulePush();
  });
  document.addEventListener("visibilitychange", onVisibility);
  patch({ status: "connecting", pushedOnce: false });
  openSocket();
}

/** Отправить ожидающие изменения и отключиться. */
export function stopCloudSync(flush = false): void {
  if (flush && pushTimer) pushNow();
  creds = null;
  onOpenHook = null;
  clearTimers();
  unsubscribeStorage?.();
  unsubscribeStorage = null;
  document.removeEventListener("visibilitychange", onVisibility);
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
  patch({ status: "off", pingMs: null, peers: [], lastSync: null });
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

/** Ключи библиотеки, которые старое приложение стирало при выходе (`clearUserLocalDataOnLogout`). */
const LIBRARY_KEYS = [
  KEYS.favorites,
  FAV_OPS_KEY,
  KEYS.favoritesOnline,
  KEYS.readHistory,
  KEYS.searchHistory,
  KEYS.tagFavorites,
  KEYS.tagFavoritesLegacy,
  KEYS.tagFilter,
  "@online.imported.cache",
  "@online.pendingFavorites.queue",
  "tagRecents.v1",
  "tagCollections.v1",
  "comments.cache",
  "profile.me",
  KEYS.me,
];

/**
 * Выход: другой аккаунт не должен унаследовать библиотеку. Стираем её, только если снимок
 * в этой сессии дошёл до облака, — иначе данные пропали бы без возврата.
 */
export function clearLibraryAfterLogout(): boolean {
  const safe = state.pushedOnce;
  stopCloudSync(true);
  if (!safe) return false;
  for (const k of LIBRARY_KEYS) removeItem(k);
  return true;
}
