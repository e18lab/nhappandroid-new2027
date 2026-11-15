/**
 * Поиск на ПК — поле прямо в заголовке окна. Фокус или ввод открывает под ним панель: недавние запросы
 * (отфильтрованные по введённому), живые подсказки книг и «Искать …». Enter — результаты в этой вкладке,
 * число — сразу книга; стрелки выбирают строку, Esc закрывает. Ctrl+K — в поле.
 */
import { useEffect, useLayoutEffect, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from "react";
import { createPortal } from "react-dom";
import type { Book } from "../api/book";
import { thumbSources } from "../api/media";
import { useActiveRouter } from "../browser/tabs";
import { SmartImage } from "../components/SmartImage";
import { useI18n } from "../i18n/I18nContext";
import { loadSearchHistory } from "../lib/library";
import { isNumericBookId, searchRoute, useSearchSuggest } from "../lib/searchSuggest";
import { KEYS, setJSON } from "../lib/storage";
import { useBookTitle } from "../lib/titleTranslations";
import { Icon, Spinner } from "../ui";

type Row = { kind: "go"; text: string } | { kind: "history"; text: string } | { kind: "book"; book: Book };

export function DeskSearch() {
  const { t } = useI18n();
  const { navigate, location } = useActiveRouter();
  const input = useRef<HTMLInputElement>(null);
  const box = useRef<HTMLDivElement>(null);
  const panel = useRef<HTMLDivElement>(null);
  const [q, setQ] = useState("");
  const [open, setOpen] = useState(false);
  const [sel, setSel] = useState(0);
  const [history, setHistory] = useState(loadSearchHistory);
  const [rect, setRect] = useState<DOMRect | null>(null);
  const trimmed = q.trim();
  const { books, loading, dateFilter } = useSearchSuggest(open ? trimmed : "", 8);

  // В поле — запрос открытой страницы результатов (пока поле не в работе)
  const pageQuery = new URLSearchParams(location.search).get("query") ?? "";
  useEffect(() => {
    if (!open) setQ(location.pathname === "/explore" ? pageQuery : "");
  }, [location.pathname, pageQuery]); // eslint-disable-line react-hooks/exhaustive-deps

  // Ctrl+K (⌘K) — в поле поиска
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        input.current?.focus();
        input.current?.select();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  useLayoutEffect(() => {
    if (!open) return;
    // По всей рамке поиска (с кнопками тегов и фильтров), а не только по полю
    const place = () => {
      const el = box.current?.closest(".dk-searchbox") ?? box.current;
      if (el) setRect(el.getBoundingClientRect());
    };
    place();
    window.addEventListener("resize", place);
    return () => window.removeEventListener("resize", place);
  }, [open]);

  // Клик мимо поля и панели — закрыть и убрать фокус (заголовок окна — область перетаскивания, сам фокус не снимает)
  useEffect(() => {
    if (!open) return;
    const down = (e: PointerEvent) => {
      const n = e.target as Node;
      if (box.current?.contains(n) || panel.current?.contains(n)) return;
      setOpen(false);
      input.current?.blur();
    };
    document.addEventListener("pointerdown", down, true);
    return () => document.removeEventListener("pointerdown", down, true);
  }, [open]);

  const shownHistory = (trimmed ? history.filter((h) => h.toLowerCase().includes(trimmed.toLowerCase()) && h !== trimmed) : history).slice(0, trimmed ? 4 : 8);
  const rows: Row[] = [
    ...(trimmed ? [{ kind: "go", text: trimmed } as Row] : []),
    ...shownHistory.map((text) => ({ kind: "history", text }) as Row),
    ...books.map((book) => ({ kind: "book", book }) as Row),
  ];

  useEffect(() => setSel(0), [trimmed, books.length]);

  const close = () => {
    setOpen(false);
    input.current?.blur();
  };

  const go = (text: string) => {
    const route = searchRoute(text);
    if (!route) return;
    setHistory(loadSearchHistory());
    setQ(isNumericBookId(text) ? "" : text.trim());
    navigate(route);
    close();
  };

  const pick = (row: Row) => {
    if (row.kind === "book") {
      navigate(`/book/${row.book.id}?title=${encodeURIComponent(row.book.title.pretty)}`);
      close();
    } else go(row.text);
  };

  const onKeyDown = (e: ReactKeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Escape") return close();
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      if (!rows.length) return;
      setSel((s) => (s + (e.key === "ArrowDown" ? 1 : -1) + rows.length) % rows.length);
      return;
    }
    if (e.key === "Enter") {
      e.preventDefault();
      const row = rows[sel];
      if (row && (row.kind !== "go" || sel > 0)) pick(row);
      else go(q);
    }
  };

  const removeHistory = (text: string) => {
    const next = history.filter((h) => h !== text);
    setJSON(KEYS.searchHistory, next);
    setHistory(next);
  };

  return (
    <>
      <div ref={box} className={open ? "dk-search is-open" : "dk-search"} onClick={() => input.current?.focus()}>
        <Icon name="search" size={14} />
        <input
          ref={input}
          value={q}
          placeholder={t("desk.search")}
          spellCheck={false}
          autoComplete="off"
          onFocus={() => {
            setHistory(loadSearchHistory());
            setOpen(true);
          }}
          onChange={(e) => {
            setQ(e.target.value);
            setOpen(true);
          }}
          onKeyDown={onKeyDown}
          onClick={() => setOpen(true)}
          onBlur={() => setOpen(false)}
        />
        {q ? (
          <button
            type="button"
            className="dk-search-clear"
            aria-label={t("common.reset")}
            onClick={(e) => {
              e.stopPropagation();
              setQ("");
              input.current?.focus();
            }}
          >
            <Icon name="x" size={12} />
          </button>
        ) : (
          <kbd>Ctrl+K</kbd>
        )}
      </div>
      {open &&
        rect &&
        (rows.length > 0 || loading) &&
        createPortal(
          <div
            ref={panel}
            className="dk-search-panel"
            style={panelPlace(rect)}
            onPointerDown={(e) => e.preventDefault()}
          >
            {rows.map((row, i) => {
              const cls = i === sel ? "dk-sp-row is-sel" : "dk-sp-row";
              if (row.kind === "go")
                return (
                  <button key="go" type="button" className={cls} onMouseEnter={() => setSel(i)} onClick={() => go(row.text)}>
                    <span className="dk-sp-icon">
                      <Icon name={isNumericBookId(row.text) ? "book" : "search"} size={15} />
                    </span>
                    <span className="dk-sp-text">
                      {isNumericBookId(row.text) ? t("searchx.openBook", { id: row.text }) : t("searchx.searchFor", { q: row.text })}
                    </span>
                    <kbd>Enter</kbd>
                  </button>
                );
              if (row.kind === "history")
                return (
                  <div key={`h-${row.text}`} className={cls} onMouseEnter={() => setSel(i)} onClick={() => go(row.text)}>
                    <span className="dk-sp-icon">
                      <Icon name="clock" size={15} />
                    </span>
                    <span className="dk-sp-text">{row.text}</span>
                    <button
                      type="button"
                      className="dk-sp-x"
                      aria-label={t("common.delete")}
                      onClick={(e) => {
                        e.stopPropagation();
                        removeHistory(row.text);
                      }}
                    >
                      <Icon name="x" size={13} />
                    </button>
                  </div>
                );
              return <BookRow key={`b-${row.book.id}`} book={row.book} className={cls} onHover={() => setSel(i)} onPick={() => pick(row)} />;
            })}
            {loading && (
              <div className="dk-sp-loading">
                <Spinner size={16} />
              </div>
            )}
            {!loading && trimmed && !books.length && dateFilter && <div className="dk-sp-note">{t("searchx.noPreviewDates")}</div>}
          </div>,
          document.body,
        )}
    </>
  );
}

/** Панель под рамкой поиска: по её ширине (не уже 340px) и целиком в окне. */
function panelPlace(rect: DOMRect): { top: number; left: number; width: number } {
  const width = Math.min(Math.max(rect.width, 340), window.innerWidth - 16);
  const left = Math.max(8, Math.min(rect.left, window.innerWidth - width - 8));
  return { top: rect.bottom + 6, left, width };
}

function BookRow({ book, className, onHover, onPick }: { book: Book; className: string; onHover: () => void; onPick: () => void }) {
  const { t } = useI18n();
  const title = useBookTitle(book);
  return (
    <button type="button" className={`${className} is-book`} onMouseEnter={onHover} onClick={onPick}>
      <span className="dk-sp-thumb">
        <SmartImage sources={thumbSources(book.thumbnail)} />
      </span>
      <span className="dk-sp-text">
        <b>{title}</b>
        <span>
          #{book.id} · {t("book.pages", { count: book.pagesCount })}
        </span>
      </span>
    </button>
  );
}
