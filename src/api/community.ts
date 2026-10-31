/**
 * Раздел «Сообщество» на своём бэкенде (nappi): карточки персонажей (`characterCards.routes.ts`) и перевод
 * тегов силами пользователей (`communityTagTranslations.routes.ts`, быстрая таблица — `communityIndex.service.ts`).
 *
 * Каталог персонажей кешируется в памяти: повторное открытие раздела показывает прошлый список сразу,
 * а свежий подтягивается в фоне. Время ответа сервера (`X-Response-Time`) запоминается для отладки.
 * Числа сервер местами отдаёт строками (bigint из Postgres) — приводим здесь.
 *
 * Личность сервер проверяет по токену nhentai (`Authorization: User <token>`, тот же, что для API v2):
 * без него править нельзя, `x-user-id` остаётся только для старых серверов и чтения.
 */
import { API_BASE_URL, API_TIMEOUT_MS } from "../config/api";
import { loadAccessToken, tryRefreshTokens } from "./client";

/** Область карточки на странице — доли ширины и высоты картинки (0…1). */
export interface CardRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface CharacterCatalogItem {
  characterName: string;
  parodyName: string | null;
  cardsCount: number;
  imageUrl: string | null;
  rect: CardRect | null;
  userId: number | null;
  userName: string | null;
  bookId: number | null;
}

export interface CharacterCard {
  id: number;
  imageUrl: string;
  rect: CardRect;
  pageIndex: number;
  bookId: number | null;
  userName: string | null;
  createdAt: string;
}

export type TranslationLocale = "en" | "ru" | "ja" | "zh";
export const TRANSLATION_LOCALES: TranslationLocale[] = ["en", "ru", "ja", "zh"];
export const TRANSLATION_TAG_TYPES = ["tag", "artist", "parody", "character", "group", "category", "language"] as const;
export type TranslationTagType = (typeof TRANSLATION_TAG_TYPES)[number];
export type TranslationStatus = "all" | "missing" | "done";
export type TranslationSort = "name" | "popular" | "recent";

export interface TranslationAudit {
  updatedBy: string;
  updatedAt: string;
  source: string;
  editorUserId?: number | null;
}

export interface TranslationRow {
  tagType: TranslationTagType;
  originalName: string;
  /** В скольких книгах библиотеки встречается (0 — неизвестно). */
  count: number;
  /** Заблокирован модератором — правят только модераторы. */
  locked: boolean;
  values: Record<TranslationLocale, string>;
  audit: Partial<Record<TranslationLocale, TranslationAudit>>;
  /** Описание тега на каждом языке ("" — нет). */
  descriptions: Record<TranslationLocale, string>;
  descAudit: Partial<Record<TranslationLocale, TranslationAudit>>;
}

export interface TranslationTable {
  total: number;
  rows: TranslationRow[];
  /** Сколько найдено каждого типа без фильтра по типу (у старого сервера нет). */
  facets: Partial<Record<TranslationTagType, number>>;
  /** Сколько тегов переведено на каждый язык из всех (у старого сервера нет). */
  progress: { total: number; byLocale: Record<TranslationLocale, number> } | null;
  cache: { tagsAgeSec: number; translationsAgeSec: number } | null;
}

export interface TranslationStats {
  totalTranslated: number;
  communityEdits: number;
  contributors: { userId: number | null; label: string; count: number }[];
}

export interface HistoryEntry {
  id: number;
  tagType: TranslationTagType;
  tagName: string;
  locale: TranslationLocale;
  oldValue: string | null;
  newValue: string | null;
  action: string;
  source: string;
  updatedBy: string;
  editorUserId: number | null;
  createdAt: string;
}

export interface CommunityMe {
  isModerator: boolean;
  banned: boolean;
  /** Личность подтверждена токеном nhentai — модератору не нужен пароль. */
  verified: boolean;
}

export interface TagLock {
  tagType: TranslationTagType;
  tagName: string;
  lockedBy: string;
  note: string | null;
  createdAt: string;
}

export interface EditorSummary {
  username: string | null;
  lastHour: number;
  lastDay: number;
  total: number;
  banned: boolean;
  firstAt: string | null;
}

export interface EditorBan {
  userId: number;
  /** Ник из базы nappi (null — пользователь не заходил в приложение). */
  username: string | null;
  bannedBy: string;
  note: string | null;
  createdAt: string;
}

export type RollbackPeriod = "1h" | "7d" | "16d" | "30d" | "2mo";
export const ROLLBACK_PERIODS: RollbackPeriod[] = ["1h", "7d", "16d", "30d", "2mo"];

/** Ошибка сервера с кодом из тела (`auth_required`, `editor_banned`, `rate_limited`, `tag_locked`…). */
export class CommunityError extends Error {
  constructor(
    public status: number,
    public code: string,
    public extra: Record<string, unknown> = {},
  ) {
    super(code);
  }
}

/** Последний ответ сервера: адрес и время (для отладки на странице модерации). */
export const lastResponse = { path: "", serverMs: null as number | null, totalMs: 0 };

interface Who {
  userId?: number;
  userName?: string;
}

async function request<T>(path: string, init: RequestInit & Who & { raw?: boolean; timeoutMs?: number } = {}, retried = false): Promise<T> {
  const { userId, userName, headers, raw: _raw, timeoutMs, ...rest } = init;
  const started = performance.now();
  const token = loadAccessToken();
  const res = await fetch(`${API_BASE_URL}${path}`, {
    ...rest,
    headers: {
      ...(rest.body instanceof FormData ? {} : { "Content-Type": "application/json" }),
      ...(token ? { Authorization: `User ${token}` } : {}),
      ...(userId != null ? { "x-user-id": String(userId) } : {}),
      // Заголовки — только ASCII, имя с другими буквами сервер заменит на user:<id>
      ...(userName && /^[\x20-\x7e]+$/.test(userName) ? { "x-user-name": userName } : {}),
      ...(headers as Record<string, string> | undefined),
    },
    signal: AbortSignal.timeout(timeoutMs ?? API_TIMEOUT_MS),
  });
  const server = res.headers.get("X-Response-Time");
  Object.assign(lastResponse, { path, serverMs: server ? parseFloat(server) : null, totalMs: Math.round(performance.now() - started) });
  if (!res.ok) {
    const body = (await res.json().catch(() => null)) as ({ error?: string } & Record<string, unknown>) | null;
    const { error, ...extra } = body ?? {};
    // Токен nhentai истёк — обновить один раз и повторить
    if (error === "auth_invalid" && token && !retried && (await tryRefreshTokens().catch(() => false))) return request<T>(path, init, true);
    throw new CommunityError(res.status, error || `HTTP ${res.status}`, extra);
  }
  return (init.raw ? res : await res.json()) as T;
}

const num = (v: unknown): number | null => (v == null || v === "" || !Number.isFinite(Number(v)) ? null : Number(v));
const toRect = (r: unknown): CardRect | null => {
  const x = r as CardRect | null;
  return x && Number(x.width) > 0 && Number(x.height) > 0 ? { x: Number(x.x), y: Number(x.y), width: Number(x.width), height: Number(x.height) } : null;
};

// ─── Персонажи ────────────────────────────────────────────────────────────────

let catalogCache: CharacterCatalogItem[] | null = null;

/** Каталог из прошлой загрузки (или null) — чтобы показать сразу. */
export const cachedCharacterCatalog = () => catalogCache;

export async function getCharacterCatalog(): Promise<CharacterCatalogItem[]> {
  const data = await request<{ items?: Record<string, unknown>[] }>("/api/character-cards/catalog");
  catalogCache = (data.items ?? []).map((r) => ({
    characterName: String(r.characterName ?? ""),
    parodyName: (r.parodyName as string | null) || null,
    cardsCount: num(r.cardsCount) ?? 0,
    imageUrl: (r.imageUrl as string | null) || null,
    rect: toRect(r.rect),
    userId: num(r.userId),
    userName: (r.userName as string | null) || null,
    bookId: num(r.bookExternalId),
  }));
  return catalogCache;
}

/** Все карточки персонажа (в каталоге — только последняя). */
export async function getCharacterCards(name: string, parody: string | null): Promise<CharacterCard[]> {
  const q = new URLSearchParams({ name });
  if (parody) q.set("parody", parody);
  const data = await request<{ cards?: Record<string, unknown>[] }>(`/api/character-cards/by-character?${q}`);
  return (data.cards ?? []).flatMap((c) => {
    const rect = toRect(c.rect);
    return rect && c.imageUrl
      ? [{ id: Number(c.id), imageUrl: String(c.imageUrl), rect, pageIndex: Number(c.pageIndex) || 0, bookId: num(c.bookExternalId), userName: (c.userName as string | null) || null, createdAt: String(c.createdAt ?? "") }]
      : [];
  });
}

// ─── Перевод тегов ────────────────────────────────────────────────────────────

export async function getTranslationTable(params: {
  search: string;
  tagTypes: TranslationTagType[];
  locale: TranslationLocale;
  status: TranslationStatus;
  sort: TranslationSort;
  limit: number;
  offset: number;
}): Promise<TranslationTable> {
  const q = new URLSearchParams({ limit: String(params.limit), offset: String(params.offset), locale: params.locale, status: params.status, sort: params.sort });
  if (params.search.trim()) q.set("search", params.search.trim());
  if (params.tagTypes.length) q.set("tag_types", params.tagTypes.join(","));
  const data = await request<{
    total: number;
    rows: (Record<TranslationLocale, string> & {
      tagType: TranslationTagType;
      originalName: string;
      count?: number;
      locked?: boolean;
      audit?: TranslationRow["audit"];
      descriptions?: Partial<Record<TranslationLocale, { value: string; updatedBy: string; updatedAt: string }>>;
    })[];
    facets?: TranslationTable["facets"];
    progress?: TranslationTable["progress"];
    cache?: TranslationTable["cache"];
  }>(`/api/community/tag-translations/table?${q}`);
  return {
    total: data.total,
    rows: data.rows.map((r) => ({
      tagType: r.tagType,
      originalName: r.originalName,
      count: r.count ?? 0,
      locked: !!r.locked,
      values: { en: r.en, ru: r.ru, ja: r.ja, zh: r.zh },
      audit: r.audit ?? {},
      descriptions: { en: r.descriptions?.en?.value ?? "", ru: r.descriptions?.ru?.value ?? "", ja: r.descriptions?.ja?.value ?? "", zh: r.descriptions?.zh?.value ?? "" },
      descAudit: Object.fromEntries(Object.entries(r.descriptions ?? {}).map(([l, d]) => [l, { updatedBy: d!.updatedBy, updatedAt: d!.updatedAt, source: "" }])),
    })),
    facets: data.facets ?? {},
    progress: data.progress ?? null,
    cache: data.cache ?? null,
  };
}

export async function getTranslationStats(): Promise<TranslationStats> {
  const data = await request<TranslationStats>("/api/community/tag-translations/stats");
  return { totalTranslated: data.totalTranslated, communityEdits: data.communityEdits, contributors: data.contributors ?? [] };
}

/** Сохранить перевод одного тега (пустая строка — убрать перевод). */
export async function saveTranslation(params: Who & {
  userId: number;
  userName: string;
  tagType: TranslationTagType;
  tagName: string;
  locale: TranslationLocale;
  translatedName: string;
}): Promise<void> {
  const { userId, userName, ...body } = params;
  await request("/api/community/tag-translations/upsert", {
    method: "POST",
    userId,
    userName,
    body: JSON.stringify({ ...body, userId, actor: userName }),
  });
}

/** Описание тега на одном языке (пустое — убрать). Не длиннее 500 символов. */
export async function saveDescription(params: {
  userId: number;
  userName: string;
  tagType: TranslationTagType;
  tagName: string;
  locale: TranslationLocale;
  description: string;
}): Promise<void> {
  const { userId, userName, ...body } = params;
  await request("/api/community/tag-translations/describe", { method: "POST", userId, userName, body: JSON.stringify({ ...body, userId }) });
}

/** Лента правок (всех или одного пользователя), постранично: `beforeId` — id последней показанной. */
export async function getRecentEdits(params: { limit?: number; beforeId?: number; userId?: number } = {}): Promise<HistoryEntry[]> {
  const q = new URLSearchParams({ limit: String(params.limit ?? 50) });
  if (params.beforeId) q.set("before_id", String(params.beforeId));
  if (params.userId) q.set("user_id", String(params.userId));
  const data = await request<{ items?: HistoryEntry[] }>(`/api/community/tag-translations/recent?${q}`);
  return data.items ?? [];
}

export async function getTagHistory(tagType: TranslationTagType, tagName: string): Promise<HistoryEntry[]> {
  const q = new URLSearchParams({ tag_type: tagType, tag_name: tagName });
  const data = await request<{ items?: HistoryEntry[] }>(`/api/community/tag-translations/history?${q}`);
  return data.items ?? [];
}

/** Модератор ли и не забанен ли (старый сервер такого не знает — тогда обычный пользователь). */
export async function getCommunityMe(userId: number): Promise<CommunityMe> {
  try {
    const data = await request<CommunityMe>("/api/community/me", { userId });
    return { isModerator: !!data.isModerator, banned: !!data.banned, verified: !!data.verified };
  } catch {
    return { isModerator: false, banned: false, verified: false };
  }
}

/** CSV всех переводов (выгрузка для модератора): текст и имя файла. */
export async function exportTranslationsCsv(params: { locales?: TranslationLocale[]; untranslatedOnly?: boolean } = {}): Promise<{ text: string; fileName: string }> {
  const q = new URLSearchParams();
  if (params.locales?.length) q.set("locales", params.locales.join(","));
  if (params.untranslatedOnly) q.set("untranslated_only", "1");
  const res = await request<Response>(`/api/community/tag-translations/export.csv${q.toString() ? `?${q}` : ""}`, { raw: true, timeoutMs: 60_000 });
  const name = /filename="([^"]+)"/.exec(res.headers.get("Content-Disposition") ?? "")?.[1];
  return { text: await res.text(), fileName: name || "community-tag-translations.csv" };
}

// ─── Модерация (только модераторы; пароль админки — только без подтверждённого токена) ─

export async function getEditorBans(userId: number): Promise<EditorBan[]> {
  const data = await request<{ bans?: EditorBan[] }>("/api/community/tag-translations/moderation/bans", { userId });
  return data.bans ?? [];
}

/** Бан / разбан; `rollback` — заодно откатить правки за период. Возвращает, сколько откачено. */
export async function setEditorBan(params: Who & { userId: number; password?: string; targetUserId: number; ban: boolean; note?: string; rollback?: RollbackPeriod }): Promise<number> {
  const { userId, userName, ...body } = params;
  const data = await request<{ reverted?: number }>("/api/community/tag-translations/moderation/ban", { method: "POST", userId, userName, body: JSON.stringify({ ...body, userId }) });
  return data.reverted ?? 0;
}

export async function rollbackEditor(params: Who & { userId: number; password?: string; targetUserId: number; period: RollbackPeriod }): Promise<number> {
  const { userId, userName, ...body } = params;
  const data = await request<{ reverted?: number }>("/api/community/tag-translations/moderation/rollback", {
    method: "POST",
    userId,
    userName,
    body: JSON.stringify({ ...body, userId }),
  });
  return data.reverted ?? 0;
}

/** Откатить одну правку из истории. */
export async function revertEdit(params: { userId: number; password?: string; historyId: number }): Promise<void> {
  const { userId, ...body } = params;
  await request("/api/community/tag-translations/moderation/revert", { method: "POST", userId, body: JSON.stringify({ ...body, userId }) });
}

/** Заблокировать / разблокировать тег. */
export async function setTagLock(params: { userId: number; password?: string; tagType: TranslationTagType; tagName: string; lock: boolean; note?: string }): Promise<void> {
  const { userId, ...body } = params;
  await request("/api/community/tag-translations/moderation/lock", { method: "POST", userId, body: JSON.stringify({ ...body, userId }) });
}

export async function getTagLocks(userId: number): Promise<TagLock[]> {
  const data = await request<{ locks?: TagLock[] }>("/api/community/tag-translations/moderation/locks", { userId });
  return data.locks ?? [];
}

export async function getEditorSummary(userId: number, targetUserId: number): Promise<EditorSummary> {
  return request<EditorSummary>(`/api/community/tag-translations/moderation/user/${targetUserId}`, { userId });
}

// ─── Перевод файлом ───────────────────────────────────────────────────────────

export type PreviewStatus = "new" | "change" | "same" | "unknown" | "locked";

export interface PreviewRow {
  key: string;
  tagType: TranslationTagType;
  tagName: string;
  locale: TranslationLocale;
  value: string;
  current: string;
  status: PreviewStatus;
  count: number;
}

export interface FilePreview {
  rows: PreviewRow[];
  errors: string[];
  summary: Record<PreviewStatus, number>;
}

export type SubmissionStatus = "pending" | "approved" | "partial" | "rejected" | "withdrawn";

export interface Submission {
  id: number;
  userId: number;
  username: string;
  note: string | null;
  status: SubmissionStatus;
  summary: Partial<Record<PreviewStatus, number>>;
  total: number;
  applied: number;
  reviewedBy: string | null;
  reviewNote: string | null;
  createdAt: string;
  reviewedAt: string | null;
}

/** CSV с тегами для перевода: текст и имя файла. */
export async function downloadTranslationFile(params: {
  /** all — строка на каждый язык каждого тега. */
  locale: TranslationLocale | "all";
  status: TranslationStatus;
  tagTypes: TranslationTagType[];
  sort: TranslationSort;
  /** Сколько тегов или "all" — все. */
  limit: number | "all";
}): Promise<{ text: string; fileName: string; rows: number }> {
  const q = new URLSearchParams({ locale: params.locale, status: params.status, sort: params.sort, limit: String(params.limit) });
  if (params.tagTypes.length) q.set("tag_types", params.tagTypes.join(","));
  const res = await request<Response>(`/api/community/tag-translations/file.csv?${q}`, { raw: true, timeoutMs: 120_000 });
  // Заголовки X-Rows / Content-Disposition браузер может не показать (CORS) — строки считаем по самому файлу
  const text = await res.text();
  const rows = Math.max(0, text.split("\n").filter((l) => l.trim()).length - 1);
  const name = /filename="([^"]+)"/.exec(res.headers.get("Content-Disposition") ?? "")?.[1];
  const limit = params.limit === "all" ? "all" : params.limit;
  return { text, fileName: name || `nhapp-tags-${params.locale}-${params.status}-${limit}.csv`, rows };
}

const fileForm = (file: File, extra: Record<string, string> = {}) => {
  const form = new FormData();
  form.append("file", file);
  for (const [k, v] of Object.entries(extra)) form.append(k, v);
  return form;
};

/** Что изменит файл (ничего не сохраняет). */
export async function previewTranslationFile(userId: number, file: File): Promise<FilePreview> {
  return request<FilePreview>("/api/community/tag-translations/submissions/preview", { method: "POST", userId, body: fileForm(file) });
}

/** Отправить файл на рассмотрение модераторам. */
export async function submitTranslationFile(userId: number, file: File, note: string): Promise<Submission> {
  const data = await request<{ submission: Submission }>("/api/community/tag-translations/submissions", { method: "POST", userId, body: fileForm(file, { note }) });
  return data.submission;
}

/** Заявки: свои или (модераторам) ожидающие / все. */
export async function getSubmissions(userId: number, scope: "mine" | "pending" | "all"): Promise<Submission[]> {
  const data = await request<{ items?: Submission[] }>(`/api/community/tag-translations/submissions?scope=${scope}`, { userId });
  return data.items ?? [];
}

export async function getSubmission(userId: number, id: number): Promise<{ info: Submission; rows: PreviewRow[] }> {
  return request<{ info: Submission; rows: PreviewRow[] }>(`/api/community/tag-translations/submissions/${id}`, { userId });
}

/** Модератор: принять (все или только `keys`) или отклонить. */
export async function reviewSubmission(userId: number, id: number, action: "approve" | "reject", keys: string[] | null, note: string): Promise<Submission> {
  const data = await request<{ submission: Submission }>(`/api/community/tag-translations/submissions/${id}/review`, {
    method: "POST",
    userId,
    body: JSON.stringify({ action, keys, note }),
  });
  return data.submission;
}

/**
 * Модератор: применить часть файла сразу, без заявки (импорт `import/apply`). Существующие переводы
 * не трогаются, пока не задано `overwrite` — тогда для каждой строки решение «new».
 */
export async function applyTranslationChunk(
  userId: number,
  csv: string,
  overwrite: string[] | null,
): Promise<{ upserted: number; conflictsKeptOld: number; conflictsAppliedNew: number }> {
  const form = new FormData();
  form.append("file", new File([csv], "chunk.csv", { type: "text/csv" }));
  if (overwrite?.length) form.append("conflictResolutions", JSON.stringify(Object.fromEntries(overwrite.map((k) => [k, "new"]))));
  return request("/api/community/tag-translations/import/apply", { method: "POST", userId, body: form, timeoutMs: 120_000 });
}

export async function withdrawSubmission(userId: number, id: number): Promise<Submission> {
  const data = await request<{ submission: Submission }>(`/api/community/tag-translations/submissions/${id}/withdraw`, { method: "POST", userId });
  return data.submission;
}
