/**
 * Поиск на телефоне — раздел нижней панели, в стиле остальных разделов: шапка «Поиск» с тегами и фильтрами,
 * большое поле-«лепесток», ниже сразу результаты (та же лента, что в каталоге), обновляются по мере ввода.
 * Пока поле пустое — недавние запросы чипами. Число — карточка «Открыть книгу #…».
 * Запрос — в адресе (`?query=`), поэтому вкладка и «назад» его помнят.
 */
import { useEffect, useRef, useState } from "react";
import { Navigate, useLocation, useNavigate, useSearchParams } from "react-router-dom";
import { devicePath } from "../browser/tabs";
import { IS_DESKTOP } from "../lib/platform";
import { CatalogFeed } from "../components/CatalogFeed";
import { useI18n } from "../i18n/I18nContext";
import { loadSearchHistory, rememberSearch } from "../lib/library";
import { isNumericBookId } from "../lib/searchSuggest";
import { KEYS, removeItem, setJSON } from "../lib/storage";
import { FilterButton } from "../shell/AppHeader";
import { SideMenuButton } from "../shell/SideMenu";
import { Icon } from "../ui";
import { useImagePicker } from "./ImageSearchScreen";

/** Пауза после ввода, прежде чем искать. */
const TYPE_DELAY_MS = 450;

export function SearchScreen() {
  // На ПК поиск — поле в заголовке окна: адрес страницы поиска телефона ведёт сразу к результатам
  if (IS_DESKTOP) return <DesktopSearchRedirect />;
  return <MobileSearch />;
}

function DesktopSearchRedirect() {
  const { search } = useLocation();
  return <Navigate to={devicePath(`/search${search}`, true)} replace />;
}

function MobileSearch() {
  const { t } = useI18n();
  const navigate = useNavigate();
  const imagePicker = useImagePicker();
  const [params, setParams] = useSearchParams();
  const urlQuery = params.get("query") ?? "";
  const [q, setQ] = useState(urlQuery);
  const [history, setHistory] = useState(loadSearchHistory);
  const input = useRef<HTMLInputElement>(null);
  const trimmed = q.trim();

  // Ввод → через паузу запрос в адрес (лента ниже ищет по нему)
  useEffect(() => {
    if (trimmed === urlQuery.trim()) return;
    const timer = window.setTimeout(() => setParams(trimmed ? { query: trimmed } : {}, { replace: true }), TYPE_DELAY_MS);
    return () => window.clearTimeout(timer);
  }, [trimmed]); // eslint-disable-line react-hooks/exhaustive-deps

  // Пустая страница поиска — сразу клавиатура. Без прокрутки и после перехода: фокус во время сдвига экрана
  // заставлял браузер прокрутить контейнер экранов вбок, и страница оставалась сдвинутой
  useEffect(() => {
    if (urlQuery) return;
    const timer = window.setTimeout(() => input.current?.focus({ preventScroll: true }), 320);
    return () => window.clearTimeout(timer);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const commit = (text = q) => {
    const query = text.trim();
    if (!query) return;
    rememberSearch(query);
    setHistory(loadSearchHistory());
    setQ(query);
    setParams({ query }, { replace: true });
    input.current?.blur();
  };

  const removeOne = (item: string) => {
    const next = history.filter((h) => h !== item);
    setJSON(KEYS.searchHistory, next);
    setHistory(next);
  };

  const shown = urlQuery.trim();

  return (
    <div className="screen-fill msr">
      {/* Шапка — карточка панели, как на остальных экранах: меню, поле поиска (вместо адресной строки),
          поиск по картинке, теги и фильтры */}
      <div className="msr-panel">
        <SideMenuButton />
        <div className="msr-field">
          <Icon name="search" size={20} className="msr-field-icon" />
          <input
            ref={input}
            value={q}
            placeholder={t("desk.search")}
            enterKeyHint="search"
            autoCapitalize="none"
            autoCorrect="off"
            onChange={(e) => setQ(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && commit()}
          />
          {q !== "" && (
            <button
              type="button"
              className="msr-field-btn"
              aria-label={t("common.reset")}
              onClick={() => {
                setQ("");
                setParams({}, { replace: true });
                input.current?.focus({ preventScroll: true });
              }}
            >
              <Icon name="x" size={18} />
            </button>
          )}
          <button type="button" className="msr-field-btn is-accent" aria-label={t("search.searchByImage")} onClick={imagePicker.pick}>
            <Icon name="image" size={20} />
          </button>
          {imagePicker.element}
        </div>
        <button type="button" className="ax-icon-btn" aria-label={t("menu.tags")} onClick={() => navigate("/tags")}>
          <Icon name="tag" size={21} />
        </button>
        <FilterButton />
      </div>

      {isNumericBookId(trimmed) && (
        <button type="button" className="msr-open" onClick={() => navigate(`/book/${trimmed}`)}>
          <span className="msr-open-icon">
            <Icon name="book-open" size={20} />
          </span>
          <span className="msr-open-text">
            <b>{t("searchx.openBook", { id: trimmed })}</b>
            <span>nhentai.net/g/{trimmed}</span>
          </span>
          <Icon name="chevron-right" size={20} />
        </button>
      )}

      {shown ? (
        // Результаты на этой же странице; при смене запроса лента начинается заново
        <div className="m-search-results" onPointerDown={() => input.current?.blur()}>
          <CatalogFeed key={shown} query={shown} />
        </div>
      ) : (
        <div className="screen-scroll msr-body">
          {history.length > 0 ? (
            <section>
              <div className="msr-section-head">
                <h2>{t("search.recent")}</h2>
                <button
                  type="button"
                  onClick={() => {
                    removeItem(KEYS.searchHistory);
                    setHistory([]);
                  }}
                >
                  {t("search.clearHistory")}
                </button>
              </div>
              <div className="msr-chips">
                {history.map((item) => (
                  <span key={item} className="msr-chip">
                    <button type="button" className="msr-chip-text" onClick={() => commit(item)}>
                      {item}
                    </button>
                    <button type="button" className="msr-chip-x" aria-label={t("common.delete")} onClick={() => removeOne(item)}>
                      <Icon name="x" size={13} />
                    </button>
                  </span>
                ))}
              </div>
            </section>
          ) : (
            <div className="msr-empty">
              <span className="msr-empty-icon">
                <Icon name="search" size={28} />
              </span>
              <p>{t("searchx.hint")}</p>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
