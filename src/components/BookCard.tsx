/**
 * Карточка книги — перенос `components/BookCard/design/BookCardClassic.tsx` (релиз 1.3.1).
 * Обложка (ширина × 1,4, радиус 12), бейдж «НОВОЕ» для загруженных за 2 часа,
 * заголовок в 2 строки, строка «JP · 20 стр. · 31 мар. 2026», цветные чипы тегов
 * в 2 ряда с «+N», пока тегов нет — плашка «Собирается информация».
 */
import { memo, useMemo, useRef, useState } from "react";
import { bookLanguage, type Book } from "../api/book";
import { thumbSources } from "../api/media";
import { useI18n } from "../i18n/I18nContext";
import { isBookBlacklisted, useBlacklistSets } from "../lib/blacklist";
import { useEnrichPriority } from "../lib/bookEnrich";
import { tagMode, toggleIncludeTag, useBrowseFilters } from "../lib/browseFilters";
import { Icon, Spinner } from "../ui";
import { SmartImage } from "./SmartImage";

type ChipType = "artist" | "parody" | "character" | "category" | "tag";
interface Chip {
  type: ChipType;
  name: string;
}

const COLLAPSED_ROWS = 2;
const CHIP_GAP = 5;
const CHIP_PAD_X = 14;
const CHIP_MAX_W = 120 + CHIP_PAD_X + 1;
const LATIN_CHAR_W = 5.3;
const CJK_CHAR_W = 9.2;
const NEW_WINDOW_MS = 2 * 60 * 60 * 1000;

const isCjk = (s: string) => /[぀-ヿ㐀-䶿一-鿿가-힯]/.test(s);
const chipW = (name: string) =>
  Math.min(CHIP_MAX_W, CHIP_PAD_X + 1 + Math.ceil(name.length * (isCjk(name) ? CJK_CHAR_W : LATIN_CHAR_W)));
const plusW = (n: number) => CHIP_PAD_X + 1 + Math.ceil((String(n).length + 1) * LATIN_CHAR_W);

/** «31 мар. 2026» — как date-fns `d MMM yyyy` в старом (без «г.» у русской локали). */
export function formatShortDate(date: Date, locale: string): string {
  const parts = new Intl.DateTimeFormat(locale, { day: "numeric", month: "short", year: "numeric" }).formatToParts(date);
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? "";
  return `${get("day")} ${get("month")} ${get("year")}`;
}

export const BookCard = memo(function BookCard({
  book,
  cardWidth,
  onPress,
}: {
  book: Book;
  cardWidth: number;
  onPress?: (book: Book) => void;
}) {
  const { t, resolved } = useI18n();
  const [expanded, setExpanded] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  useEnrichPriority(root, book.id, !book.full);
  const blacklist = useBlacklistSets();
  const hidden = useMemo(() => isBookBlacklisted(book, blacklist), [book, blacklist]);
  useBrowseFilters();

  const lang = bookLanguage(book);
  const langShort = (() => {
    const s = (lang ?? "").slice(0, 2).toUpperCase();
    return s === "JA" ? "JP" : s;
  })();
  const pages = book.pagesCount || book.pages.length || 0;

  const uploaded = book.uploaded ? new Date(book.uploaded) : null;
  const validDate = uploaded && Number.isFinite(uploaded.getTime()) ? uploaded : null;
  const displayDate = validDate ? formatShortDate(validDate, resolved) : String(new Date().getFullYear());
  const isNew = !!validDate && Date.now() - validDate.getTime() >= 0 && Date.now() - validDate.getTime() <= NEW_WINDOW_MS;

  const chips = useMemo(() => {
    const pick = (arr: { name: string }[], type: ChipType): Chip[] =>
      arr.map((x) => ({ type, name: String(x?.name ?? "").trim() })).filter((c) => c.name);
    const ordered = [
      ...pick(book.artists, "artist"),
      ...pick(book.parodies, "parody"),
      ...pick(book.characters, "character"),
      ...pick(book.categories, "category"),
      ...pick(book.tags.filter((x) => (x.type ?? "tag") === "tag"), "tag"),
    ];
    const seen = new Set<string>();
    return ordered.filter((c) => {
      const k = `${c.type}::${c.name}`.toLowerCase();
      if (seen.has(k)) return false;
      seen.add(k);
      return true;
    });
  }, [book]);

  // Свёрнутые чипы: сколько влезает в 2 ряда, вместе с «+N» (предсказание без замеров, как в старом)
  const collapsedCount = useMemo(() => {
    if (expanded || chips.length === 0) return chips.length;
    const available = Math.max(120, cardWidth - 14);
    const pack = (n: number) => {
      let row = 1;
      let x = 0;
      for (let i = 0; i < n; i++) {
        const w = chipW(chips[i].name);
        if (x === 0) x = w;
        else if (x + CHIP_GAP + w > available) {
          row += 1;
          if (row > COLLAPSED_ROWS) return { fits: false, row, x };
          x = w;
        } else x += CHIP_GAP + w;
      }
      return { fits: true, row, x };
    };
    let count = 0;
    for (let i = 1; i <= chips.length; i++) {
      if (pack(i).fits) count = i;
      else break;
    }
    if (count < chips.length) {
      while (count > 0) {
        const { row, x } = pack(count);
        if (x + CHIP_GAP + plusW(chips.length - count) <= available || row < COLLAPSED_ROWS) break;
        count--;
      }
      if (count === 0) count = 1;
    }
    return count;
  }, [chips, cardWidth, expanded]);

  const visible = expanded ? chips : chips.slice(0, collapsedCount);
  const more = chips.length - collapsedCount;

  return (
    <div ref={root} className="book-card" style={{ width: cardWidth }} role="button" tabIndex={0} onClick={() => onPress?.(book)}>
      <div className={hidden ? "book-card-cover is-blacklisted" : "book-card-cover"} style={{ height: Math.round(cardWidth * 1.4) }}>
        <SmartImage sources={thumbSources(book.cover)} />
        {hidden && (
          <span className="book-card-blacklist">
            <Icon name="eye-off" size={12} />
            {t("bookcard.hiddenByBlacklist")}
          </span>
        )}
        {isNew && <span className="book-card-new">{t("book.new")}</span>}
      </div>
      <div className="book-card-info">
        {book.title.pretty && <div className="book-card-title">{book.title.pretty}</div>}
        <div className="book-card-meta">
          {langShort && <span>{langShort}</span>}
          {langShort && pages > 0 && <i className="book-card-dot" />}
          {pages > 0 && <span>{pages} стр.</span>}
          {(langShort || pages > 0) && <i className="book-card-dot" />}
          <span>{displayDate}</span>
        </div>
        {chips.length > 0 ? (
          <div className="book-card-tags">
            {visible.map((c) => {
              const mode = tagMode(c.type, c.name);
              return (
                <button
                  key={`${c.type}:${c.name}`}
                  type="button"
                  className={`book-chip chip-${mode === "include" ? "included" : mode === "exclude" ? "excluded" : c.type}`}
                  onClick={(e) => {
                    e.stopPropagation();
                    toggleIncludeTag(c.type, c.name);
                  }}
                >
                  {c.name}
                </button>
              );
            })}
            {expanded ? (
              <button
                type="button"
                className="book-chip chip-more"
                onClick={(e) => {
                  e.stopPropagation();
                  setExpanded(false);
                }}
              >
                ▲
              </button>
            ) : more > 0 ? (
              <button
                type="button"
                className="book-chip chip-more"
                onClick={(e) => {
                  e.stopPropagation();
                  setExpanded(true);
                }}
              >
                +{more}
              </button>
            ) : null}
          </div>
        ) : (
          <div className="book-card-tags">
            <span className="book-chip chip-loading">
              {t("bookcard.collectingInfo")}
              <Spinner size={11} color="rgba(255,255,255,0.55)" />
            </span>
          </div>
        )}
      </div>
    </div>
  );
});
