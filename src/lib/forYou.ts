/**
 * «Для вас» — рекомендации с сервера (reco.moelibre.cc, сервис `services/reco` в moelibre-services).
 *
 * Приложение отправляет свои сигналы — историю чтения с прогрессом, «нравится» на nhentai, закладки,
 * избранные теги, исключённые теги и чёрный список, скрытое («Не интересно») и недавно показанное —
 * сервер ничего не хранит и отвечает полками: продолжить, ваш микс, потому что вы читали «…», художник,
 * теги, пародия, годы, свежее, открытия. «Ещё» и лента микса догружаются по id полки (сервер держит
 * расчёт 10 минут, заново не считает).
 */
import { useMemo, useSyncExternalStore } from "react";
import type { Book } from "../api/book";
import { getBlacklistSets } from "./blacklist";
import { nappiToBook } from "./bookEnrich";
import { getTagFilters } from "./browseFilters";
import { loadFavoriteIds, loadReadHistory } from "./library";
import { readOnlineFavoriteIds } from "./onlineFavorites";
import { getItem, getJSON, KEYS, setJSON, subscribeKey } from "./storage";
import type { NappiBook } from "../api/nappi";

export const RECO_URL = (import.meta.env.VITE_RECO_URL || "https://reco.moelibre.cc").replace(/\/+$/, "");

/** «Не интересно»: книги, которые не показывать в рекомендациях (последние 3000). */
export const RECO_HIDDEN_KEY = "reco.hidden.v1";
/** Недавно показанное в «Для вас» — чтобы выдача менялась, а не стояла на месте. */
const RECO_SHOWN_KEY = "reco.shown.v1";

export interface ShelfTitle {
  key: string;
  params?: Record<string, string | number>;
}

export interface Shelf {
  id: string;
  kind: "continue" | "mix" | "because" | "artist" | "tag" | "parody" | "group" | "year" | "fresh" | "discover";
  title: ShelfTitle;
  seed?: Book | null;
  progress?: Record<number, [number, number]>;
  books: Book[];
  total: number;
  more: boolean;
}

type RecoBook = NappiBook & { thumbnail?: string | null; favorites?: number | null };

/** Книга из ответа: как с nappi, плюс обложка с настоящим расширением и число избранного. */
export function recoToBook(r: RecoBook): Book {
  const b = nappiToBook(r);
  return {
    ...b,
    // Путь как у карточек nhentai: galleries/<media>/thumb.webp
    cover: r.thumbnail || b.cover,
    favorites: r.favorites ?? b.favorites,
  };
}

export async function collectSignals(lang: string) {
  const history = loadReadHistory()
    .slice(0, 600)
    .map((h) => [h.id, h.current, h.total, h.ts] as [number, number, number, number]);
  const tagFavs = Object.entries(getJSON<Record<string, boolean>>(KEYS.tagFavorites, {}) ?? {})
    .filter(([, on]) => on)
    .map(([k]) => k)
    .slice(0, 300);
  const exclude = getTagFilters()
    .filter((f) => f.mode === "exclude")
    .map((f) => `${f.type}:${f.name}`)
    .slice(0, 500);
  const black = await getBlacklistSets().catch(() => null);
  return {
    lang,
    history,
    likes: readOnlineFavoriteIds().slice(-2500),
    bookmarks: loadFavoriteIds().slice(0, 2500),
    tagFavs,
    exclude,
    excludeIds: black ? [...black.ids].filter((x) => Number.isInteger(x) && x > 0).slice(0, 2000) : [],
    // Выбранные теги каталога (включённые): подборки — только из книг с ними
    include: getTagFilters()
      .filter((f) => f.mode === "include")
      .map((f) => `${f.type}:${f.name}`)
      .slice(0, 40),
    hidden: getJSON<number[]>(RECO_HIDDEN_KEY, []).slice(-2500),
    shown: getJSON<number[]>(RECO_SHOWN_KEY, []).slice(-600),
  };
}

type Signals = Awaited<ReturnType<typeof collectSignals>>;

/**
 * Последние отправленные сигналы — «Ещё» и лента микса спрашивают тот же расчёт.
 * По аккаунту: у вкладок браузера свои аккаунты nhentai, и у каждого своя выдача.
 */
const lastSignals = new Map<string, Signals>();

async function post<T>(path: string, body: unknown): Promise<T> {
  const res = await fetch(`${RECO_URL}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(20_000),
  });
  if (!res.ok) throw new Error(`reco ${path}: HTTP ${res.status}`);
  return (await res.json()) as T;
}

/** Один расчёт на аккаунт и язык: несколько вкладок с «Для вас» и повторные нажатия ждут тот же запрос. */
const inflight = new Map<string, Promise<Shelf[]>>();

/** `who` — чей расчёт (аккаунт выбранной вкладки), `lang` — язык названий. */
export function loadForYou(lang: string, who: string): Promise<Shelf[]> {
  const key = `${who}|${lang}`;
  const have = inflight.get(key);
  if (have) return have;
  const p = fetchForYou(lang, who).finally(() => {
    if (inflight.get(key) === p) inflight.delete(key);
  });
  inflight.set(key, p);
  return p;
}

async function fetchForYou(lang: string, who: string): Promise<Shelf[]> {
  const sig = await collectSignals(lang);
  lastSignals.set(who, sig);
  const r = await post<{ shelves: (Omit<Shelf, "books" | "seed"> & { books: RecoBook[]; seed?: RecoBook | null })[] }>("/v1/foryou", sig);
  const shelves = r.shelves.map((s) => ({ ...s, books: s.books.map(recoToBook), seed: s.seed ? recoToBook(s.seed) : null }));
  rememberShown(shelves.flatMap((s) => (s.kind === "continue" ? [] : s.books.slice(0, 8).map((b) => b.id))));
  return shelves;
}

/** Сигналы аккаунта: те же, что ушли в последний расчёт (тогда сервер отвечает из кэша). */
async function signalsFor(lang: string, who: string): Promise<Signals> {
  let sig = lastSignals.get(who);
  if (!sig) {
    sig = await collectSignals(lang);
    lastSignals.set(who, sig);
  }
  return sig;
}

export async function loadShelfPage(lang: string, who: string, shelf: string, offset: number): Promise<{ books: Book[]; next: number | null }> {
  const sig = await signalsFor(lang, who);
  const r = await post<{ books: RecoBook[]; next: number | null }>("/v1/foryou/shelf", { ...sig, lang, shelf, offset });
  return { books: r.books.map(recoToBook), next: r.next };
}

export interface PicksPage {
  books: Book[];
  next: number | null;
  total: number;
  /** Поиск: тег, по которому подобрано (персонаж, пародия, художник…). */
  tag: { type: string; name: string } | null;
}

/** Подборка «для вас» к месту: под книгой (`book`) или сверху поиска (`search`). */
export type PicksTarget = { kind: "book"; book: number } | { kind: "search"; query: string };

export async function loadPicks(lang: string, who: string, target: PicksTarget, offset = 0, limit?: number): Promise<PicksPage> {
  const sig = await signalsFor(lang, who);
  // Выбранные теги каталога (включённые) — книги подборки должны их иметь, как и в выдаче поиска
  const include = getTagFilters()
    .filter((f) => f.mode === "include")
    .map((f) => `${f.type}:${f.name}`)
    .slice(0, 40);
  const body = target.kind === "book" ? { book: target.book, include } : { query: target.query, include };
  const r = await post<{ books: RecoBook[]; next: number | null; total: number; tag: PicksPage["tag"] }>(`/v1/foryou/${target.kind}`, {
    ...sig,
    lang,
    ...body,
    offset,
    limit,
  });
  return { books: r.books.map(recoToBook), next: r.next, total: r.total, tag: r.tag };
}

function rememberShown(ids: number[]) {
  const prev = getJSON<number[]>(RECO_SHOWN_KEY, []);
  const set = new Set(ids);
  setJSON(RECO_SHOWN_KEY, [...prev.filter((x) => !set.has(x)), ...ids].slice(-600));
}

export function hideFromRecommendations(id: number): void {
  const prev = getJSON<number[]>(RECO_HIDDEN_KEY, []);
  if (!prev.includes(id)) setJSON(RECO_HIDDEN_KEY, [...prev, id].slice(-3000));
}

export function useHiddenFromRecommendations(): Set<number> {
  // Строка из хранилища — стабильна между вызовами (разобранный массив был бы новым каждый раз)
  const raw = useSyncExternalStore(
    (cb) => subscribeKey(RECO_HIDDEN_KEY, cb),
    () => getItem(RECO_HIDDEN_KEY) ?? "[]",
  );
  return useMemo(() => {
    try {
      return new Set<number>(JSON.parse(raw));
    } catch {
      return new Set<number>();
    }
  }, [raw]);
}
