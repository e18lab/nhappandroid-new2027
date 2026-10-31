/**
 * Русские названия книг — машинный перевод на сервере nappi (`titleTranslate.service.ts`).
 * Карточки на экране просят свои id, запросы копятся и уходят пачкой до 100 id
 * (`/books/batch?title_locale=ru`). Найденное хранится в `@nh.titleTr.v1` (последние PERSIST_MAX);
 * у кого перевода ещё нет — переспрашиваем не раньше чем через RETRY_MS (сервер переводит каталог).
 * Настройка «Названия книг на языке интерфейса» (`langPrefs.ts`) выключена — показываем оригинал и ничего не просим.
 */
import { useEffect, useSyncExternalStore } from "react";
import type { Book } from "../api/book";
import { getBooksBatch } from "../api/nappi";
import { useI18n } from "../i18n/I18nContext";
import { useLangPref } from "./langPrefs";

/** Языки, на которые сервер переводит названия. */
const LOCALES = new Set(["ru"]);
const BATCH = 100;
const DELAY_MS = 60;
const RETRY_MS = 10 * 60 * 1000;
const PERSIST_KEY = "@nh.titleTr.v1";
const PERSIST_MAX = 5000;
const PERSIST_DELAY_MS = 2000;

const titles = new Map<number, string>();
/** Перевода не было — когда спрашивали. */
const missingAt = new Map<number, number>();
const pending = new Set<number>();
const inFlight = new Set<number>();
const listeners = new Set<() => void>();
let version = 0;
let timer = 0;
let persistTimer = 0;

try {
  const raw = localStorage.getItem(PERSIST_KEY);
  if (raw) for (const [id, t] of JSON.parse(raw) as [number, string][]) titles.set(id, t);
} catch {
  /* битые данные — начнём заново */
}

function notify() {
  version++;
  for (const l of listeners) l();
}

function schedulePersist() {
  if (persistTimer) return;
  persistTimer = window.setTimeout(() => {
    persistTimer = 0;
    try {
      localStorage.setItem(PERSIST_KEY, JSON.stringify([...titles].slice(-PERSIST_MAX)));
    } catch {
      /* не влезло — останется в памяти */
    }
  }, PERSIST_DELAY_MS);
}

async function flush(locale: string) {
  timer = 0;
  const ids = [...pending];
  pending.clear();
  for (let i = 0; i < ids.length; i += BATCH) {
    const chunk = ids.slice(i, i + BATCH);
    for (const id of chunk) inFlight.add(id);
    try {
      const { books } = await getBooksBatch(chunk, locale);
      const got = new Set<number>();
      for (const b of books) {
        const t = b.title_translated?.trim();
        if (!t) continue;
        const id = Number(b.book_id);
        titles.delete(id);
        titles.set(id, t);
        got.add(id);
      }
      const now = Date.now();
      for (const id of chunk) if (!got.has(id)) missingAt.set(id, now);
      if (got.size) {
        schedulePersist();
        notify();
      }
    } catch {
      /* сервер недоступен — спросим при следующем показе */
    } finally {
      for (const id of chunk) inFlight.delete(id);
    }
  }
}

function want(id: number, locale: string) {
  if (id <= 0 || titles.has(id) || pending.has(id) || inFlight.has(id)) return;
  if (Date.now() - (missingAt.get(id) ?? 0) < RETRY_MS) return;
  pending.add(id);
  if (!timer) timer = window.setTimeout(() => void flush(locale), DELAY_MS);
}

const subscribe = (l: () => void) => {
  listeners.add(l);
  return () => {
    listeners.delete(l);
  };
};
const getVersion = () => version;

/** Переведённое название книги на языке интерфейса или null (тогда показывать оригинал). */
export function useTranslatedTitle(id: number): string | null {
  const { resolved } = useI18n();
  const on = useLangPref("titles") && LOCALES.has(resolved);
  useSyncExternalStore(subscribe, getVersion);
  useEffect(() => {
    if (on) want(id, resolved);
  }, [on, id, resolved]);
  return on ? (titles.get(id) ?? null) : null;
}

const CJK = /[぀-ヿ㐀-䶿一-鿿가-힯]/;

/** english без [автор] (событие) в начале и [English] [Digital] в конце. */
const stripTags = (s: string) =>
  s
    .replace(/^(\s*[([{][^)\]}]*[)\]}])+\s*/, "")
    .replace(/(\s*\[[^\]]*\])+\s*$/, "")
    .trim();

/**
 * Английское название: из «Romaji | English» — часть после «|», для названия иероглифами — english
 * без служебных скобок; английского нет — как есть.
 */
export function englishTitle(book: Pick<Book, "id" | "title">): string {
  const { pretty, english, japanese } = book.title;
  return englishOf(pretty, english) || english || japanese || `#${book.id}`;
}

/** То же для пары строк (шапка знает только ?title=). */
export function englishOf(pretty: string, english = ""): string {
  let s = pretty.trim();
  if (s.includes("|")) {
    const latin = s.split("|").map((p) => p.trim()).filter((p) => p && !CJK.test(p));
    if (latin.length) s = latin[latin.length - 1];
  }
  if (!s || CJK.test(s)) {
    const en = stripTags(english);
    if (en && !CJK.test(en)) s = en;
  }
  return s;
}

/** Название для показа: перевод на язык интерфейса, иначе английское; настройка выключена — оригинал. */
export function useBookTitle(book: Pick<Book, "id" | "title">): string {
  const on = useLangPref("titles");
  const tr = useTranslatedTitle(book.id);
  if (!on) return book.title.pretty || book.title.english || book.title.japanese || `#${book.id}`;
  return tr || englishTitle(book);
}
