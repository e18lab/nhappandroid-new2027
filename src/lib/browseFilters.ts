/**
 * Фильтры каталога из меню-фильтра в шапке — те же ключи и форматы, что в старом приложении:
 * сортировка `searchSortPref` (SortContext), дата `dateRange:v5` (DateRangeContext),
 * язык — запись `{type:"language", name, mode:"include"}` в `globalTagFilter.v3` (TagFilterContext).
 */
import { useSyncExternalStore } from "react";
import type { SortOrder } from "../api/types";
import { KEYS, getItem, getJSON, setItem, setJSON, subscribe } from "./storage";

export type LanguageOption = "english" | "japanese" | "chinese";
export const LANGUAGE_OPTIONS: LanguageOption[] = ["english", "japanese", "chinese"];

export interface TagFilterItem {
  type: string;
  name: string;
  mode: "include" | "exclude";
  id?: string | number;
}

interface DateRangeState {
  uploaded: string | null;
  customRangeLabel: string | null;
  lastCustomFrom: string | null;
  lastCustomTo: string | null;
}

const SORTS: SortOrder[] = ["date", "popular", "popular-today", "popular-week", "popular-month"];

export function getSort(): SortOrder {
  const s = getItem(KEYS.searchSort) as SortOrder | null;
  return s && SORTS.includes(s) ? s : "date";
}

export function setSort(s: SortOrder): void {
  setItem(KEYS.searchSort, s);
}

function readDate(): DateRangeState {
  const raw = getJSON<Partial<DateRangeState> | null>(KEYS.dateRange, null);
  return {
    uploaded: raw?.uploaded ?? null,
    customRangeLabel: raw?.customRangeLabel ?? null,
    lastCustomFrom: raw?.lastCustomFrom ?? null,
    lastCustomTo: raw?.lastCustomTo ?? null,
  };
}

export function getUploaded(): string | null {
  return readDate().uploaded;
}

/** Пресет вида `uploaded:<7d` или null — снять фильтр по дате. */
export function setUploaded(value: string | null): void {
  setJSON(KEYS.dateRange, { ...readDate(), uploaded: value, customRangeLabel: null });
}

/** Состояние фильтра дат целиком (подпись своего диапазона и последние выбранные даты). */
export function getDateRange(): DateRangeState {
  return readDate();
}

/** Свой диапазон из календаря: запрос, подпись и даты (ISO) сохраняются вместе, как `setCustomRangeApplied`. */
export function setCustomRange(query: string, label: string, fromISO: string, toISO: string): void {
  setJSON(KEYS.dateRange, { uploaded: query, customRangeLabel: label, lastCustomFrom: fromISO, lastCustomTo: toISO });
}

export function getTagFilters(): TagFilterItem[] {
  const raw = getJSON<unknown>(KEYS.tagFilter, []);
  return Array.isArray(raw) ? (raw as TagFilterItem[]) : [];
}

export function getLanguage(): LanguageOption | null {
  const hit = getTagFilters().find(
    (f) => f.type === "language" && f.mode === "include" && LANGUAGE_OPTIONS.includes(f.name as LanguageOption),
  );
  return (hit?.name as LanguageOption) ?? null;
}

/** Как applyLanguageFilter в старом SearchBar: снять все языки, затем включить выбранный. */
export function setLanguage(next: LanguageOption | null): void {
  const rest = getTagFilters().filter((f) => !(f.type === "language" && LANGUAGE_OPTIONS.includes(f.name as LanguageOption)));
  setJSON(KEYS.tagFilter, next ? [...rest, { type: "language", name: next, mode: "include" }] : rest);
}

export function tagMode(type: string, name: string): "include" | "exclude" | null {
  return getTagFilters().find((f) => f.type === type && f.name === name)?.mode ?? null;
}

/**
 * Тап по чипу на карточке (как в старом BookCardClassic): нет режима → включить,
 * включён → снять; исключённый (с экрана тегов) с карточки не трогаем.
 */
export function toggleIncludeTag(type: string, name: string): void {
  const all = getTagFilters();
  const mode = tagMode(type, name);
  if (mode === "exclude") return;
  const rest = all.filter((f) => !(f.type === type && f.name === name));
  setJSON(KEYS.tagFilter, mode === "include" ? rest : [...rest, { type, name, mode: "include" }]);
}

/** Цикл тега на странице книги (TagFilterContext.cycle): нет → включить → исключить → нет. */
export function cycleTag(type: string, name: string): void {
  const mode = tagMode(type, name);
  const rest = getTagFilters().filter((f) => !(f.type === type && f.name === name));
  const next = mode === "include" ? "exclude" : mode === "exclude" ? null : "include";
  setJSON(KEYS.tagFilter, next ? [...rest, { type, name, mode: next }] : rest);
}

/** Задать режим тега (экран тегов). `id` сохраняется — по нему каталог идёт в `/galleries/tagged`. */
export function setTagMode(type: string, name: string, mode: "include" | "exclude" | null, id?: number): void {
  const all = getTagFilters();
  const prev = all.find((f) => f.type === type && f.name === name);
  const rest = all.filter((f) => f !== prev);
  if (!mode) return setJSON(KEYS.tagFilter, rest);
  const item: TagFilterItem = { type, name, mode };
  const knownId = id || prev?.id;
  if (knownId) item.id = knownId;
  setJSON(KEYS.tagFilter, prev ? all.map((f) => (f === prev ? item : f)) : [...rest, item]);
}

/** Заменить все фильтры тегов (применение коллекции, сброс). */
export function setTagFilters(items: TagFilterItem[]): void {
  setJSON(KEYS.tagFilter, items);
}

/** Фильтр по числу страниц: `pages:20`, `pages:>20`, `pages:<20`, `pages:>=10 pages:<=30` или "". */
export function getPagesQuery(): string {
  return (getItem(KEYS.pagesFilter) ?? "").trim();
}

export function setPagesQuery(q: string): void {
  setItem(KEYS.pagesFilter, q.trim());
}

/** Строка запроса v2 как buildV2Query: текст + страницы, включения, исключения (`-type:name`), дата. */
export function buildQuery(base: string): string {
  const parts: string[] = [];
  const text = [base.trim(), getPagesQuery()].filter(Boolean).join(" ");
  if (text) parts.push(text);
  for (const f of getTagFilters()) {
    const val = f.name.includes(" ") ? `"${f.name}"` : f.name;
    parts.push(`${f.mode === "exclude" ? "-" : ""}${f.type}:${val}`);
  }
  const uploaded = getUploaded();
  if (uploaded) parts.push(uploaded);
  return parts.join(" ");
}

const WATCHED = new Set<string>([KEYS.searchSort, KEYS.dateRange, KEYS.tagFilter, KEYS.pagesFilter]);

function snapshot(): string {
  return [getItem(KEYS.searchSort), getItem(KEYS.dateRange), getItem(KEYS.tagFilter), getItem(KEYS.pagesFilter)].join("\u0000");
}

/** Перерисовка при смене любого фильтра; возвращает «отпечаток» для зависимостей эффектов. */
export function useBrowseFilters(): string {
  return useSyncExternalStore(
    (cb) => subscribe((key) => WATCHED.has(key) && cb()),
    snapshot,
  );
}
