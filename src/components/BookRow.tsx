/**
 * Книга строкой — новый кит (в духе списка Anixart): обложка слева со скруглением 16 и меткой «Новое»,
 * справа название, строка с языком (плашкой), страницами, лайками и датой, ниже теги серым,
 * справа сверху «⋮» с действиями. Пока полные данные не догружены, вместо тегов — бледная полоса.
 * Книга из чёрного списка размыта.
 *
 * `variant`: `list` — обычная строка; `compact` — меньше обложка и шрифт, без тегов.
 * `show` — что показывать (настройки карточек, `lib/cardView.ts`).
 */
import { memo, useMemo } from "react";
import { bookLanguage, type Book } from "../api/book";
import { thumbSources } from "../api/media";
import { useI18n } from "../i18n/I18nContext";
import { isBookBlacklisted, useBlacklistSets } from "../lib/blacklist";
import type { CardShow } from "../lib/cardView";
import { isFavorite, toggleFavorite } from "../lib/library";
import { tagById, toSingular, useTagsDbReady } from "../lib/tagsDb";
import { useTagLabel } from "../lib/tagTranslations";
import { useBookTitle } from "../lib/titleTranslations";
import { FilterDropdown, Icon, type SelectItem } from "../ui";
import { formatShortDate } from "./BookCard";
import { SmartImage } from "./SmartImage";

const NEW_WINDOW_MS = 2 * 60 * 60 * 1000;

export function fmtCount(n: number): string {
  if (!n || n <= 0) return "0";
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 10_000) return `${Math.round(n / 1_000)}K`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return String(n);
}

/** Сведения для подписи карточки: язык (JP вместо JA), страницы, дата, «новая ли». */
export function useBookFacts(book: Book) {
  const { resolved } = useI18n();
  const lang = (() => {
    const s = (bookLanguage(book) ?? "").slice(0, 2).toUpperCase();
    return s === "JA" ? "JP" : s;
  })();
  const pages = book.pagesCount || book.pages.length || 0;
  const uploaded = book.uploaded ? new Date(book.uploaded) : null;
  const valid = uploaded && Number.isFinite(uploaded.getTime()) ? uploaded : null;
  const age = valid ? Date.now() - valid.getTime() : NaN;
  return {
    lang,
    pages,
    date: valid ? formatShortDate(valid, resolved) : "",
    isNew: age >= 0 && age <= NEW_WINDOW_MS,
  };
}

/** Меню «⋮» карточки: в закладки, читать. */
export function useBookMenu(book: Book, onRead?: (b: Book) => void): SelectItem[] {
  const { t } = useI18n();
  const fav = isFavorite(book.id);
  return [
    {
      type: "action",
      label: fav ? t("book.inFavorites") : t("book.addFavorite"),
      icon: <Icon name="bookmark" size={16} solid={fav} />,
      onPress: () => toggleFavorite(book.id),
    },
    ...(onRead ? [{ type: "action" as const, label: t("book.read"), icon: <Icon name="book-open" size={16} />, onPress: () => onRead(book) }] : []),
  ];
}

export function BookMenuButton({ book, onRead }: { book: Book; onRead?: (b: Book) => void }) {
  const { t } = useI18n();
  const menu = useBookMenu(book, onRead);
  return (
    <span className="ax-row-menu" onClick={(e) => e.stopPropagation()}>
      <FilterDropdown
        options={menu}
        hideRadio
        minWidth={200}
        trigger={({ onPress }) => (
          <button type="button" className="ax-icon-btn" aria-label={t("common.chooseOption")} onClick={onPress}>
            <Icon name="more-vertical" size={20} />
          </button>
        )}
      />
    </span>
  );
}

export const BookRow = memo(function BookRow({
  book,
  onPress,
  onRead,
  variant = "list",
  show = { tags: true, meta: true, newBadge: true, date: false },
}: {
  book: Book;
  onPress: (b: Book) => void;
  onRead?: (b: Book) => void;
  variant?: "list" | "compact";
  show?: CardShow;
}) {
  const { t } = useI18n();
  const blacklist = useBlacklistSets();
  const hidden = useMemo(() => isBookBlacklisted(book, blacklist), [book, blacklist]);
  const facts = useBookFacts(book);
  const compact = variant === "compact";

  // Строка тегов: из полных данных, а до них — по `tag_ids` карточки через локальный справочник
  const dbReady = useTagsDbReady();
  const tagLabel = useTagLabel();
  const title = useBookTitle(book);
  const tags = useMemo(() => {
    const order = ["parodies", "characters", "artists", "groups", "tags"];
    const fromIds = book.full
      ? []
      : book.tagIds
          .map((id) => tagById(id))
          .filter((x): x is NonNullable<typeof x> => !!x)
          .sort((a, b) => order.indexOf(a.type) - order.indexOf(b.type));
    const names = (book.full ? [...book.parodies, ...book.characters, ...book.artists, ...book.tags.filter((x) => (x.type ?? "tag") === "tag")] : fromIds)
      .map((x) => {
        const name = String(x?.name ?? "").trim();
        return name && tagLabel(toSingular(x.type ?? "tag"), name);
      })
      .filter(Boolean);
    return [...new Set(names)].join(", ");
  }, [book, dbReady, tagLabel]);

  const showTags = show.tags && !compact;

  return (
    <div className={compact ? "ax-row is-compact" : "ax-row"} role="button" tabIndex={0} onClick={() => onPress(book)}>
      <div className={hidden ? "ax-row-cover is-blacklisted" : "ax-row-cover"}>
        <SmartImage sources={thumbSources(book.cover)} />
        {show.newBadge && facts.isNew && <span className="ax-row-new">{t("book.new")}</span>}
        {hidden && (
          <span className="ax-row-hidden">
            <Icon name="eye-off" size={14} />
          </span>
        )}
      </div>
      <div className="ax-row-body">
        <div className="ax-row-head">
          <h3 className="ax-row-title">{title}</h3>
          <BookMenuButton book={book} onRead={onRead} />
        </div>
        {(show.meta || show.date) && (
          <div className="ax-row-meta">
            {show.meta && facts.lang && <span className="ax-lang">{facts.lang}</span>}
            {show.meta && !!facts.pages && (
              <span className="ax-fact">
                <Icon name="file-text" size={14} />
                {facts.pages}
              </span>
            )}
            {show.meta && !!book.favorites && (
              <span className="ax-fact">
                <Icon name="heart" size={14} />
                {fmtCount(book.favorites)}
              </span>
            )}
            {show.date && facts.date && (
              <span className="ax-fact">
                <Icon name="calendar" size={14} />
                {facts.date}
              </span>
            )}
          </div>
        )}
        {showTags && (tags ? <p className="ax-row-desc">{tags}</p> : !book.full && !dbReady && <span className="ax-row-skeleton" />)}
      </div>
    </div>
  );
});
