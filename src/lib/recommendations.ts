/**
 * Рекомендации на клиенте — перенос `api/nhappApi/recommendations.ts` (релиз 1.3.1).
 *
 * Профиль строится из избранных тегов (×10), закладок (×3), онлайн-избранного (×2), истории чтения (×2–3)
 * и истории поиска, плюс предпочтения по объёму и годам. По случайным терминам из верхушки профиля идут
 * запросы к библиотеке сервера nappi; списки перемешиваются по кругу, чтобы один запрос не занял весь экран.
 *
 * Отличия от 1.3.1:
 *  - вместо одной выдачи на 150 книг — бесконечная лента: кандидаты копятся в очереди и выдаются порциями,
 *    когда очередь пуста, запускается новое поколение запросов с другими страницами;
 *  - ответ `tag-counts/lookup` читается по актуальному полю `counts` (1.3.1 ждал `tagCounts`, и калибровка не работала);
 *  - время в истории чтения сравнивается в миллисекундах (там секунды, и «читал на этой неделе» не срабатывало);
 *  - если не ответил ни один запрос, это ошибка с кнопкой «Повторить», а не пустой экран.
 */
import { galleryToBook, type Book } from "../api/book";
import { getGallery } from "../api/galleries";
import { initCdn } from "../api/media";
import { getBooksBatch, lookupTagCounts, queryLibBooks, type NappiBook } from "../api/nappi";
import { getBlacklistSets, isBookBlacklisted } from "./blacklist";
import { nappiToBook, rememberFullBook } from "./bookEnrich";
import { getTagFilters, type TagFilterItem } from "./browseFilters";
import { loadFavoriteIds, loadReadHistory, loadSearchHistory } from "./library";
import { readOnlineFavoriteIds } from "./onlineFavorites";
import { KEYS, getItem, getJSON, setItem } from "./storage";
import { loadTagsDb, tagById, toPlural, toSingular } from "./tagsDb";

// ─── Типы ─────────────────────────────────────────────────────────────────────

export interface ScoredTerm {
  name: string;
  score: number;
  sources: string[];
}

/** Сырой сигнал тега и его популярность — для живого предпросмотра в шторке настроек. */
export interface TagCalibrationRow {
  name: string;
  rawScore: number;
  popularity: number;
  sources: string[];
}

export interface PagePreference {
  avg: number;
  minPreferred: number;
  maxPreferred: number;
  label: "short" | "medium" | "long" | "mixed";
}

export interface YearPreference {
  topYears: number[];
  yearCounts: Record<number, number>;
}

export interface RecommendationProfile {
  tags: ScoredTerm[];
  artists: ScoredTerm[];
  parodies: ScoredTerm[];
  characters: ScoredTerm[];
  groups: ScoredTerm[];
  languages: string[];
  pagePreference: PagePreference | null;
  yearPreference: YearPreference | null;
  /** С чем пользователь уже имел дело — в выдачу не попадает. */
  seenIds: Set<number>;
  totalLocalFavorites: number;
  totalOnlineFavorites: number;
  totalReadHistory: number;
  totalTagFavs: number;
  totalSearchHistory: number;
  searchQueries: string[];
  tagCalibration: TagCalibrationRow[];
}

export interface RecommendationResult {
  books: Book[];
  profile: RecommendationProfile;
  queriesUsed: string[];
  generation: number;
  filterIncludes: TagFilterItem[];
  filterExcludes: TagFilterItem[];
  /** Больше нечего подгружать. */
  exhausted: boolean;
}

// ─── Состояние ────────────────────────────────────────────────────────────────

const BATCH_SIZE = 60;
const POOL_SIZE = 600;
const QUERY_LIMIT = "50";
const QUERY_CONCURRENCY = 6;
const HYDRATE_CONCURRENCY = 6;
const BATCH_CHUNK = 200;
const SHOWN_LIMIT = 2000;
/** Страницы для запросов по термину: дальше у тега или художника обычно пусто. */
const QUERY_PAGE_MOD = 15;
/** Страницы для запросов без фильтра: каталог большой. */
const DISCOVERY_PAGE_MOD = 400;

/** Случайное на запуск приложения: разные сессии получают разные страницы при одном и том же профиле. */
const sessionSeed = Math.floor(Math.random() * 1e13);

let generation = 0;
let shownIds = new Set<number>();
let current: RecommendationResult | null = null;
let currentFilters = "";
let queue: Book[] = [];
let inFlight: Promise<RecommendationResult> | null = null;
/** Растёт при сбросе: ответ запроса, начатого раньше, отбрасывается. */
let resetToken = 0;

export function getCachedRecommendations(): RecommendationResult | null {
  return current;
}

/** Выход из аккаунта: следующий пользователь не должен получить чужие сигналы. */
export function resetRecommendations(): void {
  resetToken++;
  generation = 0;
  shownIds = new Set();
  current = null;
  queue = [];
  inFlight = null;
}

// ─── Калибровка популярности тегов ────────────────────────────────────────────

/** 0 — приглушить массовые теги, 100 — сырые очки. */
export function readTagCalibration(): number {
  const n = parseInt(getItem(KEYS.recommendationCalibration) ?? "", 10);
  return Number.isFinite(n) ? Math.max(0, Math.min(100, n)) : 100;
}

export function writeTagCalibration(n: number): void {
  setItem(KEYS.recommendationCalibration, String(Math.max(0, Math.min(100, Math.round(n)))));
}

/** score = raw / pop^(1−α), где α = калибровка / 100. */
export function tagPopularityMultiplier(popularity: number, calibration: number): number {
  const alpha = Math.max(0, Math.min(1, calibration / 100));
  return 1 / Math.pow(Math.max(1, popularity), 1 - alpha);
}

// ─── Профиль ──────────────────────────────────────────────────────────────────

type ScoreMap = Map<string, { score: number; sources: Set<string> }>;

function addScore(map: ScoreMap, rawName: string, score: number, source: string): void {
  const key = rawName.trim().toLowerCase();
  if (!key) return;
  const entry = map.get(key);
  if (entry) {
    entry.score += score;
    entry.sources.add(source);
  } else map.set(key, { score, sources: new Set([source]) });
}

function sorted(map: ScoreMap): ScoredTerm[] {
  return [...map.entries()]
    .map(([name, { score, sources }]) => ({ name, score, sources: [...sources] }))
    .sort((a, b) => b.score - a.score);
}

const list = (v: string[] | null | undefined): string[] => (Array.isArray(v) ? v.map(String) : []);

function yearOf(uploaded: string | null | undefined): number | null {
  if (!uploaded) return null;
  const y = new Date(uploaded).getUTCFullYear();
  return y >= 2000 && y <= new Date().getUTCFullYear() + 1 ? y : null;
}

function pagePreference(counts: number[]): PagePreference | null {
  if (counts.length < 3) return null;
  const avg = counts.reduce((s, n) => s + n, 0) / counts.length;
  const stddev = Math.sqrt(counts.reduce((s, n) => s + (n - avg) ** 2, 0) / counts.length);
  const label = stddev > 40 ? "mixed" : avg < 25 ? "short" : avg > 80 ? "long" : "medium";
  return { avg: Math.round(avg), minPreferred: Math.max(1, Math.round(avg - stddev)), maxPreferred: Math.round(avg + stddev), label };
}

async function fetchRows(ids: number[]): Promise<NappiBook[]> {
  const rows: NappiBook[] = [];
  for (let i = 0; i < ids.length; i += BATCH_CHUNK) {
    try {
      rows.push(...(await getBooksBatch(ids.slice(i, i + BATCH_CHUNK))).books);
    } catch {
      /* без этой пачки профиль будет чуть беднее */
    }
  }
  return rows;
}

async function fetchTagCounts(names: string[]): Promise<Map<string, number>> {
  const out = new Map<string, number>();
  for (let i = 0; i < names.length; i += 500) {
    try {
      const counts = await lookupTagCounts(names.slice(i, i + 500));
      for (const [name, count] of Object.entries(counts)) out.set(name.trim().toLowerCase(), Number(count) || 0);
    } catch {
      /* без популярности тег считается редким */
    }
  }
  return out;
}

async function buildProfile(): Promise<RecommendationProfile> {
  const localIds = loadFavoriteIds();
  const onlineIds = readOnlineFavoriteIds();
  const history = loadReadHistory();
  const searches = loadSearchHistory();
  const tagFavs = getJSON<Record<string, unknown> | null>(KEYS.tagFavorites, null) ?? getJSON<Record<string, unknown>>(KEYS.tagFavoritesLegacy, {});

  const tags: ScoreMap = new Map();
  const artists: ScoreMap = new Map();
  const parodies: ScoreMap = new Map();
  const characters: ScoreMap = new Map();
  const groups: ScoreMap = new Map();
  const byKind: Record<string, ScoreMap> = { tags, artists, parodies, characters, groups };
  const langCount = new Map<string, number>();
  const yearCount = new Map<number, number>();
  const pages: number[] = [];

  // Избранные теги: `tags:name`, в старых записях тип бывает в единственном числе
  let totalTagFavs = 0;
  for (const key of Object.keys(tagFavs ?? {})) {
    const colon = key.indexOf(":");
    if (colon < 1 || colon === key.length - 1) continue;
    totalTagFavs++;
    const map = byKind[toPlural(key.slice(0, colon))];
    if (map) addScore(map, key.slice(colon + 1), 10, "tagFavs");
  }

  const process = (row: NappiBook, weight: number, source: string) => {
    for (const x of list(row.tags)) addScore(tags, x, weight, source);
    for (const x of list(row.artists)) addScore(artists, x, weight, source);
    for (const x of list(row.parodies)) addScore(parodies, x, weight, source);
    for (const x of list(row.characters)) addScore(characters, x, weight * 0.7, source);
    for (const x of list(row.groups)) addScore(groups, x, weight * 0.7, source);
    for (const x of list(row.languages)) langCount.set(x, (langCount.get(x) ?? 0) + 1);
    const n = Number(row.pages);
    if (Number.isFinite(n) && n > 0) pages.push(n);
    const year = yearOf(row.uploaded_at);
    if (year) yearCount.set(year, (yearCount.get(year) ?? 0) + 1);
  };

  const localSet = new Set(localIds);
  const recentHistory = [...history].sort((a, b) => b.ts - a.ts).slice(0, 60);
  const [localRows, onlineRows, readRows] = await Promise.all([
    fetchRows(localIds.slice(-150).reverse()),
    fetchRows(onlineIds.filter((id) => !localSet.has(id)).slice(-80).reverse()),
    fetchRows(recentHistory.map((e) => e.id)),
  ]);
  for (const row of localRows) process(row, 3, "localFavorites");
  for (const row of onlineRows) process(row, 2, "onlineFavorites");
  const readAt = new Map(recentHistory.map((e) => [e.id, e.ts * 1000]));
  for (const row of readRows) {
    const at = readAt.get(Number(row.book_id)) ?? 0;
    process(row, Date.now() - at < 7 * 24 * 3_600_000 ? 3 : 2, "readHistory");
  }

  // История поиска: сами запросы и очки с поправкой на свежесть
  const seenSearch = new Set<string>();
  const searchQueries: string[] = [];
  for (const raw of searches) {
    const q = raw.trim();
    if (q.length < 2 || seenSearch.has(q.toLowerCase())) continue;
    seenSearch.add(q.toLowerCase());
    searchQueries.push(q.slice(0, 200));
  }
  searches.slice(0, 28).forEach((query, i, recent) => {
    if (query.trim().length < 2) return;
    const w = 2.5 * (1 + ((recent.length - i) / recent.length) * 1.8);
    addScore(tags, query, w, "searchHistory");
    addScore(artists, query, w * 0.65, "searchHistory");
    addScore(parodies, query, w * 0.65, "searchHistory");
    addScore(characters, query, w * 0.55, "searchHistory");
    addScore(groups, query, w * 0.55, "searchHistory");
  });

  // Популярность тегов: сначала снимок сырых очков для предпросмотра, потом поправка
  const tagCalibration: TagCalibrationRow[] = [];
  if (tags.size) {
    const counts = await fetchTagCounts([...tags.keys()]);
    const calibration = readTagCalibration();
    for (const [name, entry] of tags) {
      const popularity = Math.max(1, counts.get(name) ?? 1);
      tagCalibration.push({ name, rawScore: entry.score, popularity, sources: [...entry.sources] });
      entry.score *= tagPopularityMultiplier(popularity, calibration);
    }
  }

  const years = [...yearCount.entries()].sort((a, b) => b[1] - a[1]);
  return {
    tags: sorted(tags),
    artists: sorted(artists),
    parodies: sorted(parodies),
    characters: sorted(characters),
    groups: sorted(groups),
    languages: [...langCount.entries()].sort((a, b) => b[1] - a[1]).map(([lang]) => lang),
    pagePreference: pagePreference(pages),
    yearPreference: years.length ? { topYears: years.slice(0, 3).map(([y]) => y), yearCounts: Object.fromEntries(years) } : null,
    seenIds: new Set([...localIds, ...onlineIds, ...history.map((e) => e.id)]),
    totalLocalFavorites: localIds.length,
    totalOnlineFavorites: onlineIds.length,
    totalReadHistory: history.length,
    totalTagFavs,
    totalSearchHistory: searches.length,
    searchQueries,
    tagCalibration,
  };
}

// ─── Случайность с повторяемым разбросом ──────────────────────────────────────

function createRng(): () => number {
  const lo = sessionSeed % 4294967296;
  const hi = Math.floor(sessionSeed / 4294967296) % 4294967296;
  let state = (lo ^ hi ^ (generation * 2654435761)) >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = Math.imul(state ^ (state >>> 15), state | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function shuffle<T>(arr: T[], rng: () => number): T[] {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

const pickFromTop = <T,>(terms: T[], take: number, pool: number, rng: () => number): T[] => shuffle(terms.slice(0, pool), rng).slice(0, take);

/** По одному из каждого списка по кругу: один запрос не займёт сплошной кусок ленты. */
function interleave(lists: number[][], maxLen: number, rng: () => number): number[] {
  const shuffled = lists.filter((l) => l.length).map((l) => shuffle(l, rng));
  const ptrs = shuffled.map(() => 0);
  const out: number[] = [];
  const seen = new Set<number>();
  while (out.length < maxLen) {
    let progressed = false;
    for (let i = 0; i < shuffled.length && out.length < maxLen; i++) {
      while (ptrs[i] < shuffled[i].length) {
        const id = shuffled[i][ptrs[i]++];
        if (seen.has(id)) continue;
        seen.add(id);
        out.push(id);
        progressed = true;
        break;
      }
    }
    if (!progressed) break;
  }
  return out;
}

// ─── Запросы и оценка ─────────────────────────────────────────────────────────

interface QueryDef {
  label: string;
  params: Record<string, string>;
  termScore: number;
}

const FILTER_PARAM: Record<string, string> = {
  tag: "tags",
  artist: "artists",
  parody: "parodies",
  character: "characters",
  group: "groups",
  category: "categories",
  language: "languages",
};

function rowField(row: NappiBook, type: string): string[] {
  const param = FILTER_PARAM[toSingular(type)];
  return param ? list(row[param as keyof NappiBook] as string[] | null).map((v) => v.toLowerCase()) : [];
}

function buildQueries(profile: RecommendationProfile, includes: TagFilterItem[], rng: () => number): QueryDef[] {
  const defs: QueryDef[] = [];
  let qi = 0;
  const page = () => String(((sessionSeed + generation * 7 + qi++) % QUERY_PAGE_MOD) + 1);
  const pref = profile.pagePreference;
  const pageParams: Record<string, string> =
    pref && pref.label !== "mixed" ? { min_pages: String(pref.minPreferred), max_pages: String(pref.maxPreferred) } : {};

  for (const term of pickFromTop(profile.tags, 6, 24, rng)) {
    defs.push({ label: `tag: "${term.name}"`, params: { tags: term.name, ...pageParams, page: page() }, termScore: term.score });
  }
  const add = (terms: ScoredTerm[], take: number, pool: number, kind: string, param: string) => {
    for (const term of pickFromTop(terms, take, pool, rng)) {
      defs.push({ label: `${kind}: "${term.name}"`, params: { [param]: term.name, page: page() }, termScore: term.score * 1.5 });
    }
  };
  add(profile.artists, 4, 16, "artist", "artists");
  add(profile.parodies, 3, 12, "parody", "parodies");
  add(profile.characters, 4, 18, "character", "characters");
  add(profile.groups, 3, 14, "group", "groups");

  const lang = profile.languages[0];
  if (lang) defs.push({ label: `language: "${lang}"`, params: { languages: lang, page: page() }, termScore: 3.5 });

  for (const q of shuffle(profile.searchQueries, rng).slice(0, 8)) {
    defs.push({ label: `search: "${q.length > 48 ? `${q.slice(0, 48)}…` : q}"`, params: { search: q, page: page() }, termScore: 5 });
  }

  // Немного неожиданного из всего каталога
  let slot = 200;
  const discovery = () => String(((sessionSeed + generation * 19 + slot++ * 23) % DISCOVERY_PAGE_MOD) + 1);
  const explore = 0.42;
  defs.push(
    { label: "explore: recent", params: { page: discovery() }, termScore: explore },
    { label: "explore: by id", params: { page: discovery(), sort_by: "book_id" }, termScore: explore * 0.95 },
    {
      label: "explore: mixed length",
      params: { page: discovery(), min_pages: String(20 + Math.floor(rng() * 40)), max_pages: String(120 + Math.floor(rng() * 120)) },
      termScore: explore * 0.85,
    },
  );

  // Включённые фильтры соблюдает сервер: значения одного поля через запятую — это «и»
  for (const def of defs) {
    for (const f of includes) {
      const key = FILTER_PARAM[toSingular(f.type)];
      if (key) def.params[key] = def.params[key] ? `${def.params[key]},${f.name}` : f.name;
    }
  }
  return defs;
}

async function mapLimit<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const out = new Array<R>(items.length);
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, async () => {
      while (next < items.length) {
        const i = next++;
        out[i] = await fn(items[i]);
      }
    }),
  );
  return out;
}

function additionalScore(row: NappiBook, p: RecommendationProfile, maps: Record<"tags" | "artists" | "parodies" | "characters" | "groups", Map<string, number>>, yearScores: Map<number, number>): number {
  let bonus = 0;
  const sum = (values: string[], map: Map<string, number>, k: number) => {
    for (const v of values) bonus += (map.get(v.toLowerCase()) ?? 0) * k;
  };
  sum(list(row.tags), maps.tags, 0.3);
  sum(list(row.artists), maps.artists, 0.5);
  sum(list(row.parodies), maps.parodies, 0.5);
  sum(list(row.characters), maps.characters, 0.3);
  sum(list(row.groups), maps.groups, 0.3);
  if (p.languages[0] && list(row.languages).includes(p.languages[0])) bonus *= 1.1;
  const pref = p.pagePreference;
  const pages = Number(row.pages);
  if (pref && pages >= pref.minPreferred && pages <= pref.maxPreferred) bonus *= 1.15;
  const year = yearOf(row.uploaded_at);
  if (year) bonus += yearScores.get(year) ?? 0;
  return bonus;
}

interface BlockList {
  ids: Set<number>;
  names: Set<string>;
}

/** Имена заблокированных тегов: сервер может вернуть только id, тогда берём их из справочника. */
async function loadBlockList(): Promise<BlockList> {
  const { ids, names } = await getBlacklistSets();
  if (ids.size && !names.size) {
    await loadTagsDb().catch(() => undefined);
    for (const id of ids) {
      const tag = tagById(id);
      if (tag) names.add(tag.low);
    }
  }
  return { ids, names };
}

function withoutBlocked(p: RecommendationProfile, names: Set<string>): RecommendationProfile {
  if (!names.size) return p;
  const ok = (x: { name: string }) => !names.has(x.name.toLowerCase());
  return {
    ...p,
    tags: p.tags.filter(ok),
    artists: p.artists.filter(ok),
    parodies: p.parodies.filter(ok),
    characters: p.characters.filter(ok),
    groups: p.groups.filter(ok),
    languages: p.languages.filter((x) => !names.has(x.toLowerCase())),
    searchQueries: p.searchQueries.filter((x) => !names.has(x.toLowerCase())),
    tagCalibration: p.tagCalibration.filter(ok),
  };
}

/** Одно поколение запросов: кандидаты в порядке выдачи, без того, что уже видели. */
async function fetchPool(
  profile: RecommendationProfile,
  includes: TagFilterItem[],
  excludes: TagFilterItem[],
  blocked: BlockList,
  alreadyListed: Set<number>,
): Promise<{ pool: Book[]; queries: string[] }> {
  const rng = createRng();
  const defs = buildQueries(profile, includes, rng);
  const results = await mapLimit(defs, QUERY_CONCURRENCY, async (def) => {
    try {
      return await queryLibBooks({ limit: QUERY_LIMIT, order: "desc", sort_by: "uploaded_at", skip_total: "1", ...def.params });
    } catch {
      return null;
    }
  });
  if (results.every((r) => r === null)) throw new Error("recommendations: no query succeeded");

  const skip = new Set([...profile.seenIds, ...shownIds, ...alreadyListed]);
  const scores = new Map<number, number>();
  const rows = new Map<number, NappiBook>();
  const books = new Map<number, Book>();
  const perQuery: number[][] = results.map((found, i) => {
    const ids = new Set<number>();
    for (const row of found ?? []) {
      const id = Number(row.book_id);
      if (!Number.isFinite(id) || id <= 0 || skip.has(id) || ids.has(id)) continue;
      if (excludes.some((f) => rowField(row, f.type).includes(f.name.toLowerCase()))) continue;
      const book = books.get(id) ?? nappiToBook(row);
      if (isBookBlacklisted(book, blocked)) continue;
      books.set(id, book);
      rows.set(id, row);
      ids.add(id);
      scores.set(id, (scores.get(id) ?? 0) + defs[i].termScore);
    }
    return [...ids];
  });

  const mapOf = (terms: ScoredTerm[]) => new Map(terms.map((t) => [t.name, t.score]));
  const maps = { tags: mapOf(profile.tags), artists: mapOf(profile.artists), parodies: mapOf(profile.parodies), characters: mapOf(profile.characters), groups: mapOf(profile.groups) };
  const yearScores = new Map((profile.yearPreference?.topYears ?? []).map((y, i) => [y, 3 - i]));
  const finalScores = new Map([...rows].map(([id, row]) => [id, (scores.get(id) ?? 0) + additionalScore(row, profile, maps, yearScores)]));
  const byScore = (a: number, b: number) => (finalScores.get(b) ?? 0) - (finalScores.get(a) ?? 0);

  const ordered = interleave(perQuery.map((ids) => ids.sort(byScore)), POOL_SIZE, rng);
  const picked = new Set(ordered);
  for (const id of [...rows.keys()].sort(byScore)) {
    if (ordered.length >= POOL_SIZE) break;
    if (!picked.has(id)) ordered.push(id);
  }
  return { pool: ordered.map((id) => books.get(id)!), queries: defs.map((d) => d.label) };
}

/** Книги без media_id на сервере: обложку знает только nhentai. */
async function withCovers(books: Book[]): Promise<Book[]> {
  return mapLimit(books, HYDRATE_CONCURRENCY, async (book) => {
    if (book.cover) return book;
    try {
      const full = galleryToBook(await getGallery(book.id));
      rememberFullBook(full);
      return full;
    } catch {
      return book;
    }
  });
}

// ─── Выдача ───────────────────────────────────────────────────────────────────

const splitFilters = () => {
  const all = getTagFilters();
  return { all, includes: all.filter((f) => f.mode === "include"), excludes: all.filter((f) => f.mode === "exclude") };
};

/** Следующая порция из очереди. */
async function takeBatch(): Promise<Book[]> {
  const batch = queue.slice(0, BATCH_SIZE);
  queue = queue.slice(BATCH_SIZE);
  for (const b of batch) shownIds.add(b.id);
  return withCovers(batch);
}

function exclusive(run: (token: number) => Promise<RecommendationResult>): Promise<RecommendationResult> {
  if (inFlight) return inFlight;
  const token = resetToken;
  const p: Promise<RecommendationResult> = run(token).finally(() => {
    if (inFlight === p) inFlight = null;
  });
  inFlight = p;
  return p;
}

async function generate(token: number): Promise<RecommendationResult> {
  await initCdn();
  const { all, includes, excludes } = splitFilters();
  const [rawProfile, blocked] = await Promise.all([buildProfile(), loadBlockList()]);
  const profile = withoutBlocked(rawProfile, blocked.names);

  const hasSignals = profile.tags.length + profile.artists.length + profile.parodies.length + profile.characters.length + profile.groups.length + profile.searchQueries.length > 0;
  let queries: string[] = [];
  let books: Book[] = [];
  if (hasSignals) {
    const found = await fetchPool(profile, includes, excludes, blocked, new Set());
    if (token !== resetToken) throw new Error("recommendations: reset");
    queries = found.queries;
    queue = found.pool;
    books = await takeBatch();
  }
  if (token !== resetToken) throw new Error("recommendations: reset");
  current = {
    books,
    profile,
    queriesUsed: queries,
    generation,
    filterIncludes: includes,
    filterExcludes: excludes,
    exhausted: books.length === 0,
  };
  currentFilters = JSON.stringify(all);
  return current;
}

/** Есть выдача под текущие фильтры тегов — собирать заново не нужно. */
export function hasFreshRecommendations(): boolean {
  return !!current && currentFilters === JSON.stringify(getTagFilters());
}

/** Готовая выдача; если её нет или с тех пор поменялись фильтры тегов — собирается заново. */
export function loadRecommendations(): Promise<RecommendationResult> {
  if (hasFreshRecommendations()) return Promise.resolve(current!);
  if (inFlight) {
    const again = () => loadRecommendations();
    return inFlight.then(again, again);
  }
  return refreshRecommendations();
}

/** Новая выдача: другие страницы и случайные термины, показанные книги не повторяются. Идущая догрузка сначала завершается. */
export async function refreshRecommendations(): Promise<RecommendationResult> {
  if (inFlight) await inFlight.catch(() => undefined);
  return exclusive((token) => {
    current = null;
    queue = [];
    generation++;
    if (shownIds.size > SHOWN_LIMIT) shownIds = new Set();
    return generate(token);
  });
}

/** Следующая порция ленты. Очередь кончилась — новое поколение запросов с теми же профилем и фильтрами. */
export function loadMoreRecommendations(): Promise<RecommendationResult> {
  return exclusive(async (token) => {
    const base = current;
    if (!base || base.exhausted) return base ?? generate(token);
    let queries = base.queriesUsed;
    if (!queue.length) {
      generation++;
      const blocked = await loadBlockList();
      const found = await fetchPool(base.profile, base.filterIncludes, base.filterExcludes, blocked, new Set(base.books.map((b) => b.id)));
      if (token !== resetToken) throw new Error("recommendations: reset");
      queue = found.pool;
      queries = found.queries;
    }
    const batch = await takeBatch();
    if (token !== resetToken) throw new Error("recommendations: reset");
    current = { ...base, books: [...base.books, ...batch], queriesUsed: queries, generation, exhausted: batch.length === 0 };
    return current;
  });
}
