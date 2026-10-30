/**
 * Список книг в выбранном виде (Настройки → Карточки, `lib/cardView.ts`): строками (`BookRow`),
 * компактными строками, плитками-постерами (`PosterCard`) или классическими карточками 1.3.1 (`BookGrid`).
 * Плитки берут число колонок, поля и промежуток из настроек сетки — как классическая сетка.
 *
 * `enrich` — догружать полные данные (теги, дату) самому; лента каталога делает это сама и передаёт false.
 */
import { useMemo, useRef } from "react";
import type { Book } from "../api/book";
import { thumbSources } from "../api/media";
import { useI18n } from "../i18n/I18nContext";
import { isBookBlacklisted, useBlacklistSets } from "../lib/blacklist";
import { useEnrichedBooks } from "../lib/bookEnrich";
import { useCardView, type CardShow } from "../lib/cardView";
import { Icon } from "../ui";
import { BookCard } from "./BookCard";
import { BookGrid, useGridMetrics } from "./BookGrid";
import { BookMenuButton, BookRow, fmtCount, useBookFacts } from "./BookRow";
import { SmartImage } from "./SmartImage";

const NONE: Book[] = [];

export function BookCollection({
  books,
  onPress,
  onRead,
  enrich = true,
}: {
  books: Book[];
  onPress: (b: Book) => void;
  onRead?: (b: Book) => void;
  enrich?: boolean;
}) {
  const { view, show } = useCardView();
  const enriched = useEnrichedBooks(enrich && view !== "classic" ? books : NONE);
  const list = enrich && view !== "classic" ? enriched : books;

  if (view === "classic") return <BookGrid books={books} onPress={onPress} />;
  if (view === "grid") return <PosterGrid books={list} show={show} onPress={onPress} onRead={onRead} />;
  return (
    <div className={view === "compact" ? "ax-list is-compact" : "ax-list"}>
      {list.map((b) => (
        <BookRow key={b.id} book={b} variant={view} show={show} onPress={onPress} onRead={onRead} />
      ))}
    </div>
  );
}

/** Ширина элемента карусели по виду карточек. */
const CAROUSEL_W: Record<string, number> = { grid: 140, classic: 150, list: 300, compact: 260 };

/**
 * Карусель — те же карточки выбранного вида, но лентой с горизонтальной прокруткой (профиль: избранное).
 * Стрелки листания — на ПК (мышь), на телефоне листается пальцем.
 */
export function BookCarousel({ books, onPress }: { books: Book[]; onPress: (b: Book) => void }) {
  const { t } = useI18n();
  const { view, show } = useCardView();
  const list = useEnrichedBooks(view !== "classic" ? books : NONE);
  const row = useRef<HTMLDivElement>(null);
  const w = CAROUSEL_W[view];
  const items = view === "classic" ? books : list;
  const scroll = (dir: number) => row.current?.scrollBy({ left: dir * (row.current.clientWidth - w), behavior: "smooth" });

  return (
    <div className={`ax-carousel is-${view}`}>
      <div ref={row} className="ax-carousel-row">
        {items.map((b) => (
          <div key={b.id} className="ax-carousel-item" style={{ width: w }}>
            {view === "classic" ? (
              <BookCard book={b} cardWidth={w} onPress={onPress} />
            ) : view === "grid" ? (
              <PosterCard book={b} show={show} onPress={onPress} />
            ) : (
              <BookRow book={b} variant={view} show={show} onPress={onPress} />
            )}
          </div>
        ))}
      </div>
      <button type="button" className="ax-carousel-arrow is-prev" aria-label={t("common.back")} onClick={() => scroll(-1)}>
        <Icon name="chevron-left" size={20} />
      </button>
      <button type="button" className="ax-carousel-arrow is-next" aria-label={t("common.nextPage")} onClick={() => scroll(1)}>
        <Icon name="chevron-right" size={20} />
      </button>
    </div>
  );
}

function PosterGrid({ books, show, onPress, onRead }: { books: Book[]; show: CardShow; onPress: (b: Book) => void; onRead?: (b: Book) => void }) {
  const { host, ready, cols, pad, gap } = useGridMetrics();
  return (
    <div
      ref={host}
      className="ax-posters"
      style={{ padding: `4px ${pad}px 0`, columnGap: gap, gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))` }}
    >
      {ready && books.map((b) => <PosterCard key={b.id} book={b} show={show} onPress={onPress} onRead={onRead} />)}
    </div>
  );
}

/**
 * Плитка-постер — как карточка релиза в Anixart (item_release_card): обложка 0.7 со скруглением 16,
 * на ней метка «Новое», снизу на затемнении язык и лайки; под обложкой название в 2 строки и подпись.
 */
export function PosterCard({ book, show, onPress, onRead }: { book: Book; show: CardShow; onPress: (b: Book) => void; onRead?: (b: Book) => void }) {
  const { t } = useI18n();
  const blacklist = useBlacklistSets();
  const hidden = useMemo(() => isBookBlacklisted(book, blacklist), [book, blacklist]);
  const facts = useBookFacts(book);
  const sub = [show.meta && facts.pages ? t("book.pagesShort", { count: facts.pages }) : "", show.date ? facts.date : ""].filter(Boolean);
  const onCover = show.meta && (facts.lang || book.favorites);

  return (
    <div className="ax-poster" role="button" tabIndex={0} onClick={() => onPress(book)}>
      <div className={hidden ? "ax-poster-cover is-blacklisted" : "ax-poster-cover"}>
        <SmartImage sources={thumbSources(book.cover)} />
        {show.newBadge && facts.isNew && <span className="ax-row-new">{t("book.new")}</span>}
        {hidden && (
          <span className="ax-row-hidden">
            <Icon name="eye-off" size={14} />
          </span>
        )}
        {onCover && (
          <span className="ax-poster-badges">
            {facts.lang && <span className="ax-lang">{facts.lang}</span>}
            {!!book.favorites && (
              <span className="ax-fact">
                <Icon name="heart" size={13} solid />
                {fmtCount(book.favorites)}
              </span>
            )}
          </span>
        )}
        <span className="ax-poster-menu">
          <BookMenuButton book={book} onRead={onRead} />
        </span>
      </div>
      <h3 className="ax-poster-title">{book.title.pretty || book.title.english || `#${book.id}`}</h3>
      {sub.length > 0 && <div className="ax-poster-sub">{sub.join(" • ")}</div>}
    </div>
  );
}
