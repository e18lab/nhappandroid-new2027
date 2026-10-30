/**
 * Разовый импорт данных релиза 1.3.1 после обновления поверх него (тот же ID `com.nhapp.android`).
 * Старое приложение хранило всё в AsyncStorage (SQLite `RKStorage`), Android-часть отдаёт его через
 * `window.NHAppLegacy.readAll()` (см. `LegacyStorage.kt`). Ключи у нас те же, что в старом.
 *
 * - Ключи с префиксом `NHENTAI_` (из сборок ветки new-ui и облачной синхронизации) полнее обычных —
 *   если есть оба, берём версию с префиксом.
 * - Закладки, история чтения и поиска объединяются с тем, что уже есть в новом приложении.
 * - Остальные значения записываются, только если такого ключа ещё нет.
 * Старая база не изменяется; после импорта ставится флаг, повторно импорт не идёт.
 */
import { KEYS, getItem, getJSON, setItem, setJSON } from "./storage";

const DONE_FLAG = "legacyImport.v1";
const PREFIX = "NHENTAI_";

type ReadHistoryEntry = [number, number, number, number];

declare global {
  interface Window {
    NHAppLegacy?: { readAll(): string };
  }
}

function parseJSON<T>(raw: string | undefined, fallback: T): T {
  if (raw == null) return fallback;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

/** Закладки: id от старых к новым — сначала старые, затем те, что уже добавлены в новом. */
function mergeFavorites(legacy: unknown): void {
  if (!Array.isArray(legacy)) return;
  const old = legacy.map(Number).filter((n) => Number.isFinite(n) && n > 0);
  const current = getJSON<unknown[]>(KEYS.favorites, []).map(Number);
  setJSON(KEYS.favorites, [...old.filter((id) => !current.includes(id)), ...current]);
}

/** История: по каждой книге запись с самым поздним временем, новые первыми. */
function mergeReadHistory(legacy: unknown): void {
  if (!Array.isArray(legacy)) return;
  const byId = new Map<number, ReadHistoryEntry>();
  for (const e of [...getJSON<unknown[]>(KEYS.readHistory, []), ...legacy]) {
    if (!Array.isArray(e) || e.length < 4) continue;
    const entry = e.map(Number) as ReadHistoryEntry;
    const prev = byId.get(entry[0]);
    if (!prev || entry[3] > prev[3]) byId.set(entry[0], entry);
  }
  setJSON(KEYS.readHistory, [...byId.values()].sort((a, b) => b[3] - a[3]));
}

/** Поиск: сначала новые запросы, потом старые, без повторов, до 10 (как `rememberSearch`). */
function mergeSearchHistory(legacy: unknown): void {
  if (!Array.isArray(legacy)) return;
  const all = [...getJSON<unknown[]>(KEYS.searchHistory, []), ...legacy].map((x) => String(x).trim()).filter(Boolean);
  setJSON(KEYS.searchHistory, [...new Set(all)].slice(0, 10));
}

const MERGERS: Record<string, (value: unknown) => void> = {
  [KEYS.favorites]: mergeFavorites,
  [KEYS.readHistory]: mergeReadHistory,
  [KEYS.searchHistory]: mergeSearchHistory,
};

/** Возвращает число перенесённых ключей (0 — нечего переносить или уже перенесено). */
export function importLegacyStorage(): number {
  if (getItem(DONE_FLAG) != null || !window.NHAppLegacy) return 0;

  let raw = "";
  try {
    raw = window.NHAppLegacy.readAll();
  } catch {
    return 0;
  }
  const legacy = parseJSON<Record<string, string>>(raw || undefined, {});

  // Ключ без префикса → значение (версия NHENTAI_ важнее)
  const values = new Map<string, string>();
  for (const [key, value] of Object.entries(legacy)) {
    if (!key.startsWith(PREFIX) && typeof value === "string") values.set(key, value);
  }
  for (const [key, value] of Object.entries(legacy)) {
    if (key.startsWith(PREFIX) && typeof value === "string") values.set(key.slice(PREFIX.length), value);
  }

  let imported = 0;
  for (const [key, value] of values) {
    const merge = MERGERS[key];
    if (merge) merge(parseJSON<unknown>(value, null));
    else if (getItem(key) == null) setItem(key, value);
    else continue;
    imported++;
  }

  setItem(DONE_FLAG, new Date().toISOString());
  return imported;
}
