/**
 * Книга строкой — новый кит (в духе списка Anixart): обложка слева, справа заголовок,
 * строка «EN • 24 стр. • ♥ 1.2K», ниже теги серым в 3 строки, справа сверху «⋮» с действиями.
 * Пока полные данные не догружены, вместо тегов — бледная полоса. Книга из чёрного списка размыта.
 */
import { useMemo } from "react";
import { bookLanguage, type Book } from "../api/book";
import { thumbSources } from "../api/media";
import { useI18n } from "../i18n/I18nContext";
import { isBookBlacklisted, useBlacklistSets } from "../lib/blacklist";
import { isFavorite, toggleFavorite } from "../lib/library";
import { tagById, useTagsDbReady } from "../lib/tagsDb";
import { FilterDropdown, Icon, type SelectItem } from "../ui";
import { SmartImage } from "./SmartImage";

const NEW_WINDOW_MS = 2 * 60 * 60 * 1000;

export function fmtCount(n: number): string {
  if (!n || n <= 0) return "0";
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 10_000) return `${Math.round(n / 1_000)}K`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return String(n);
}

export function BookRow({ book, onPress, onRead }: { book: Book; onPress: (b: Book) => void; onRead?: (b: Book) => void }) {
  const { t } = useI18n();
  const blacklist = useBlacklistSets();
  const hidden = useMemo(() => isBookBlacklisted(book, blacklist), [book, blacklist]);

  const lang = (() => {
    const s = (bookLanguage(book) ?? "").slice(0, 2).toUpperCase();
    return s === "JA" ? "JP" : s;
  })();
  const pages = book.pagesCount || book.pages.length || 0;
  const uploaded = book.uploaded ? Date.parse(book.uploaded) : NaN;
  const isNew = Number.isFinite(uploaded) && Date.now() - uploaded >= 0 && Date.now() - uploaded <= NEW_WINDOW_MS;

  // Строка тегов: из полных данных, а до них — по `tag_ids` карточки через локальный справочник
  const dbReady = useTagsDbReady();
  const tags = useMemo(() => {
    const order = ["parodies", "characters", "artists", "groups", "tags"];
    const fromIds = book.full
      ? []
      : book.tagIds
          .map((id) => tagById(id))
          .filter((x): x is NonNullable<typeof x> => !!x)
          .sort((a, b) => order.indexOf(a.type) - order.indexOf(b.type));
    const names = (book.full ? [...book.parodies, ...book.characters, ...book.artists, ...book.tags.filter((x) => (x.type ?? "tag") === "tag")] : fromIds)
      .map((x) => String(x?.name ?? "").trim())
      .filter(Boolean);
    return [...new Set(names)].join(", ");
  }, [book, dbReady]);

  const fav = isFavorite(book.id);
  const menu: SelectItem[] = [
    {
      type: "action",
      label: fav ? t("book.inFavorites") : t("book.addFavorite"),
      icon: <Icon name="bookmark" size={16} />,
      onPress: () => toggleFavorite(book.id),
    },
    ...(onRead
      ? [{ type: "action" as const, label: t("book.read"), icon: <Icon name="book-open" size={16} />, onPress: () => onRead(book) }]
      : []),
  ];

  const meta = [lang, pages ? t("book.pagesShort", { count: pages }) : "", book.favorites ? `♥ ${fmtCount(book.favorites)}` : ""].filter(Boolean);

  return (
    <div className="ax-row" role="button" tabIndex={0} onClick={() => onPress(book)}>
      <div className={hidden ? "ax-row-cover is-blacklisted" : "ax-row-cover"}>
        <SmartImage sources={thumbSources(book.cover)} />
        {isNew && <span className="ax-row-new">{t("book.new")}</span>}
        {hidden && (
          <span className="ax-row-hidden">
            <Icon name="eye-off" size={14} />
          </span>
        )}
      </div>
      <div className="ax-row-body">
        <div className="ax-row-head">
          <h3 className="ax-row-title">{book.title.pretty || book.title.english || `#${book.id}`}</h3>
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
        </div>
        {meta.length > 0 && <div className="ax-row-meta">{meta.join("  •  ")}</div>}
        {tags ? <p className="ax-row-desc">{tags}</p> : !book.full && !dbReady && <span className="ax-row-skeleton" />}
      </div>
    </div>
  );
}
