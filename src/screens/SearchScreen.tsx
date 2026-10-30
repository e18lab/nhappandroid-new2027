/**
 * Поиск — перенос `app/search.tsx` (релиз 1.3.1): своя шапка с полем,
 * недавние запросы (`searchHistory`, до 10), живые подсказки по мере ввода,
 * число — сразу открыть книгу, Enter — результаты в «Обзоре».
 */
import { useEffect, useMemo, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { galleryCardToBook, type Book } from "../api/book";
import { listGalleries } from "../api/galleries";
import { initCdn, thumbSources } from "../api/media";
import { SmartImage } from "../components/SmartImage";
import { useI18n } from "../i18n/I18nContext";
import { buildQuery, getSort, getUploaded, setUploaded, useBrowseFilters } from "../lib/browseFilters";
import { isBookBlacklisted, useBlacklistSets } from "../lib/blacklist";
import { loadSearchHistory, rememberSearch } from "../lib/library";
import { KEYS, removeItem, setJSON } from "../lib/storage";
import { Icon, LoadingSpinner, useToast } from "../ui";

const isNumericBookId = (s: string) => /^\d+$/.test(s.trim());

export function SearchScreen() {
  const { t } = useI18n();
  const navigate = useNavigate();
  const { showToast } = useToast();
  const [params] = useSearchParams();
  const filters = useBrowseFilters();
  const [q, setQ] = useState(params.get("query") ?? "");
  const [history, setHistory] = useState(loadSearchHistory);
  const [allSuggests, setSuggests] = useState<Book[]>([]);
  const blacklist = useBlacklistSets();
  const suggests = useMemo(() => allSuggests.filter((b) => !isBookBlacklisted(b, blacklist)), [allSuggests, blacklist]);
  const [loading, setLoading] = useState(false);
  const dateFilterActive = !!getUploaded();
  const trimmed = q.trim();

  const submit = (text = q) => {
    const query = text.trim();
    if (!query) return;
    rememberSearch(query);
    setHistory(loadSearchHistory());
    if (isNumericBookId(query)) navigate(`/book/${query}`);
    else navigate(`/explore?query=${encodeURIComponent(query)}`);
  };

  useEffect(() => {
    if (!trimmed || dateFilterActive || isNumericBookId(trimmed)) {
      setSuggests([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    let cancelled = false;
    const timer = window.setTimeout(async () => {
      try {
        await initCdn();
        const res = await listGalleries(1, getSort(), buildQuery(trimmed));
        if (!cancelled) setSuggests(res.result.map(galleryCardToBook));
      } catch {
        if (!cancelled) setSuggests([]);
      } finally {
        if (!cancelled) setLoading(false);
      }
    }, 250);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [trimmed, dateFilterActive, filters]);

  const filteredHistory = trimmed ? history.filter((h) => h.toLowerCase().includes(trimmed.toLowerCase())) : history;

  return (
    <div className="screen-fill search-screen">
      <div className="search-top">
        <button type="button" className="topbar-btn" aria-label={t("common.back")} onClick={() => navigate(-1)}>
          <Icon name="arrow-left" size={20} />
        </button>
        <div className="search-input-wrap">
          <Icon name="search" size={18} className="search-input-icon" />
          <input
            autoFocus
            value={q}
            placeholder={t("search.placeholder")}
            enterKeyHint="search"
            autoCapitalize="none"
            autoCorrect="off"
            onChange={(e) => setQ(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && submit()}
          />
          {q !== "" && (
            <button type="button" className="search-small-btn" aria-label={t("common.reset")} onClick={() => setQ("")}>
              <Icon name="x" size={16} />
            </button>
          )}
          <button
            type="button"
            className="search-small-btn topbar-accent"
            aria-label={t("search.searchByImage")}
            onClick={() => showToast({ title: t("search.searchByImage"), message: t("menu.comingSoon") })}
          >
            <Icon name="image" size={18} />
          </button>
        </div>
        <button type="button" className="topbar-btn topbar-accent" aria-label={t("menu.tags")} onClick={() => navigate("/tags")}>
          <Icon name="tag" size={18} />
        </button>
      </div>

      {trimmed && (
        <div className="search-results-caption">
          {t("search.results")}: <span>{trimmed}</span>
        </div>
      )}

      <div className="screen-scroll search-body">
        {filteredHistory.length > 0 && (
          <>
            <div className="search-head-row">
              <span className="search-head">{t("search.recent")}</span>
              <button
                type="button"
                className="search-pill"
                onClick={() => {
                  removeItem(KEYS.searchHistory);
                  setHistory([]);
                }}
              >
                {t("search.clearHistory")}
              </button>
            </div>
            {filteredHistory.map((item) => (
              <div key={item} className="search-history-row">
                <button type="button" className="search-row" onClick={() => submit(item)}>
                  <Icon name="clock" size={16} className="ui-muted" />
                  <span className="search-row-text">{item}</span>
                </button>
                <button
                  type="button"
                  className="search-small-btn"
                  aria-label={t("common.delete")}
                  onClick={() => {
                    const next = history.filter((h) => h !== item);
                    setJSON(KEYS.searchHistory, next);
                    setHistory(next);
                  }}
                >
                  <Icon name="x" size={16} />
                </button>
              </div>
            ))}
          </>
        )}

        {trimmed && (
          <>
            <div className="search-head" style={{ marginTop: filteredHistory.length ? 14 : 2 }}>
              {t("search.results")}
            </div>
            {dateFilterActive ? (
              <div className="search-date-note">
                <div className="search-date-note-title">
                  <Icon name="calendar" size={16} className="ui-accent" />
                  <span>Предпросмотр не работает с датами</span>
                </div>
                <p>
                  Открой результаты или{" "}
                  <button type="button" onClick={() => setUploaded(null)}>
                    сбрось даты
                  </button>
                  , чтобы увидеть быстрые подсказки.
                </p>
              </div>
            ) : loading ? (
              <LoadingSpinner size="small" color="var(--sub)" />
            ) : suggests.length ? (
              suggests.map((b) => (
                <button
                  key={b.id}
                  type="button"
                  className="search-row"
                  onClick={() => navigate(`/book/${b.id}?title=${encodeURIComponent(b.title.pretty)}`)}
                >
                  <span className="search-thumb">
                    <SmartImage sources={thumbSources(b.thumbnail)} />
                  </span>
                  <span className="search-row-body">
                    <span className="search-row-text">{b.title.pretty}</span>
                    <span className="search-row-meta">{t("book.pages", { count: b.pagesCount })}</span>
                  </span>
                </button>
              ))
            ) : (
              <p className="search-empty">{t("empty.search", { q: trimmed })}</p>
            )}
          </>
        )}
      </div>
    </div>
  );
}
