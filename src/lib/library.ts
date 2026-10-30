/**
 * Локальные закладки, история чтения и история поиска в формате старого приложения (`master`):
 * `hooks/useFavHistory.ts`, `app/read.tsx` (updateReadHistory), `app/search.tsx` (saveHist),
 * слияние для облака — `api/nhappApi/storageMerge.ts`.
 */
import { KEYS, getJSON, setJSON } from "./storage";

// ─── Закладки: number[] в порядке добавления (старые → новые) ────────────────

function parseIds(raw: unknown): number[] {
  if (!Array.isArray(raw)) return [];
  return raw.map(Number).filter((n) => Number.isFinite(n) && n > 0);
}

export function loadFavoriteIds(): number[] {
  return parseIds(getJSON<unknown>(KEYS.favorites, []));
}

export function isFavorite(id: number): boolean {
  return loadFavoriteIds().includes(id);
}

/** Переключает закладку; `next` — принудительно добавить/убрать. Возвращает новое состояние. */
export function toggleFavorite(id: number, next?: boolean): boolean {
  const ids = loadFavoriteIds();
  const has = ids.includes(id);
  const add = typeof next === "boolean" ? next : !has;
  if (add === has) return has;
  setJSON(KEYS.favorites, add ? [...ids, id] : ids.filter((x) => x !== id));
  return add;
}

// ─── История чтения: [id, страница с 0, всего, unix-секунды], новые первыми ──

export type ReadHistoryEntry = [number, number, number, number];

export interface ReadProgress {
  id: number;
  /** Текущая страница, с нуля. */
  current: number;
  total: number;
  /** Unix-время в секундах. */
  ts: number;
}

export function loadReadHistory(): ReadProgress[] {
  const raw = getJSON<unknown>(KEYS.readHistory, []);
  if (!Array.isArray(raw)) return [];
  const out: ReadProgress[] = [];
  for (const e of raw) {
    if (!Array.isArray(e)) continue;
    const id = Number(e[0]);
    if (!Number.isFinite(id) || id <= 0) continue;
    const total = Math.max(1, Math.floor(Number(e[2]) || 1));
    const current = Math.min(Math.max(0, Math.floor(Number(e[1]) || 0)), total - 1);
    out.push({ id, current, total, ts: Math.floor(Number(e[3]) || 0) });
  }
  return out;
}

export function getReadProgress(id: number): ReadProgress | null {
  return loadReadHistory().find((e) => e.id === id) ?? null;
}

/** Запись прогресса: книга поднимается в начало списка. */
export function updateReadHistory(id: number, current: number, total: number): void {
  const raw = getJSON<unknown>(KEYS.readHistory, []);
  const list = Array.isArray(raw) ? (raw as ReadHistoryEntry[]) : [];
  const rest = list.filter((e) => !Array.isArray(e) || Number(e[0]) !== id);
  const entry: ReadHistoryEntry = [id, current, total, Math.floor(Date.now() / 1000)];
  setJSON(KEYS.readHistory, [entry, ...rest]);
}

// ─── История поиска: string[], до 10, новые первыми ───────────────────────────

const SEARCH_HISTORY_LIMIT = 10;

export function loadSearchHistory(): string[] {
  const raw = getJSON<unknown>(KEYS.searchHistory, []);
  return Array.isArray(raw) ? raw.map((x) => String(x).trim()).filter(Boolean) : [];
}

export function rememberSearch(text: string): void {
  const clean = text.trim();
  if (!clean) return;
  const next = [clean, ...loadSearchHistory().filter((h) => h !== clean)];
  setJSON(KEYS.searchHistory, next.slice(0, SEARCH_HISTORY_LIMIT));
}
