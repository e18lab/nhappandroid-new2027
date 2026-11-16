/**
 * Рекомендации — перенос `app/recommendations.tsx` (релиз 1.3.1) в новом ките.
 * Вместо разового списка на 150 книг — бесконечная лента; обновление — кнопкой (потягивания вниз в приложении нет).
 * Запросы идут, только когда вкладка открыта (`active`): соседние страницы ленты монтируются при свайпе заранее.
 * Калибровка применяется при закрытии шторки: ползунок двигают много раз, а выдача — это десятки запросов.
 */
import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import type { Book } from "../api/book";
import { BookCollection } from "../components/BookCollection";
import { errorText, useI18n } from "../i18n/I18nContext";
import {
  getCachedRecommendations,
  hasFreshRecommendations,
  loadMoreRecommendations,
  loadRecommendations,
  readTagCalibration,
  refreshRecommendations,
  tagPopularityMultiplier,
  writeTagCalibration,
  type RecommendationResult,
  type ScoredTerm,
  type TagCalibrationRow,
} from "../lib/recommendations";
import { KEYS, subscribe } from "../lib/storage";
import { useStableCallback } from "../lib/useStableCallback";
import { PageBar } from "../shell/PageBar";
import { Button, Icon, LoadingSpinner, NhModal, NoResultsPanel, Slider, Spinner, type IconName } from "../ui";

export function RecommendationsScreen({ active = true }: { active?: boolean }) {
  const { t } = useI18n();
  const navigate = useNavigate();
  const [result, setResult] = useState<RecommendationResult | null>(getCachedRecommendations);
  const [state, setState] = useState<"loading" | "ready" | "error">(result ? "ready" : "loading");
  const [error, setError] = useState<unknown>(null);
  const [moreError, setMoreError] = useState(false);
  const [filtersVersion, setFiltersVersion] = useState(0);
  const [sheet, setSheet] = useState(false);
  const scroller = useRef<HTMLDivElement>(null);
  const sentinel = useRef<HTMLDivElement>(null);
  const loadingMore = useRef(false);

  const run = async (load: () => Promise<RecommendationResult>) => {
    setState("loading");
    setMoreError(false);
    try {
      setResult(await load());
      setState("ready");
    } catch (e) {
      setError(e);
      setState("error");
    }
  };

  useEffect(() => subscribe((key) => key === KEYS.tagFilter && setFiltersVersion((n) => n + 1)), []);

  // Первая загрузка и смена фильтров тегов; при возврате на вкладку список и прокрутка остаются как были
  useEffect(() => {
    if (active && !hasFreshRecommendations()) void run(loadRecommendations);
  }, [active, filtersVersion]);

  const refresh = () => {
    scroller.current?.scrollTo({ top: 0 });
    void run(refreshRecommendations);
  };

  const loadMore = async () => {
    if (loadingMore.current) return;
    loadingMore.current = true;
    setMoreError(false);
    try {
      setResult(await loadMoreRecommendations());
    } catch {
      setMoreError(true);
    } finally {
      loadingMore.current = false;
    }
  };

  const hasMore = state === "ready" && !!result?.books.length && !result.exhausted;

  // Низ списка близко к экрану — следующая порция
  useEffect(() => {
    const el = sentinel.current;
    if (!el || !hasMore || moreError || !active) return;
    const io = new IntersectionObserver((entries) => entries.some((e) => e.isIntersecting) && void loadMore(), {
      root: scroller.current,
      rootMargin: "0px 0px 1200px 0px",
    });
    io.observe(el);
    return () => io.disconnect();
  });

  const open = useStableCallback((b: Book) => navigate(`/book/${b.id}?title=${encodeURIComponent(b.title.pretty)}`));
  const read = useStableCallback((b: Book) => navigate(`/read/${b.id}`));

  const profile = result?.profile;
  const coldStart =
    !!profile && !profile.totalLocalFavorites && !profile.totalOnlineFavorites && !profile.totalReadHistory && !profile.totalTagFavs && !profile.totalSearchHistory;
  const emptyKey = coldStart ? "noFav" : "default";

  return (
    <div className="screen-fill library-screen">
      <div ref={scroller} className="screen-scroll ax-feed">
        <PageBar>
          <div className="list-sort-bar">
            <button type="button" className="list-sort-btn" onClick={() => setSheet(true)}>
              <Icon name="sliders" size={16} />
              <span>{t("recommendations.howItWorks")}</span>
            </button>
            <button type="button" className="list-sort-btn rec-refresh" aria-label={t("recommendations.refresh")} disabled={state === "loading"} onClick={refresh}>
              <Icon name="refresh-cw" size={16} />
            </button>
          </div>
        </PageBar>

        {state === "loading" && (
          <div className="rec-loading">
            <LoadingSpinner />
            <p>{t("recommendations.loading")}</p>
          </div>
        )}
        {state === "error" && (
          <div className="error-block">
            <p>{errorText(t, error, "errors.catalog")}</p>
            <Button title={t("common.retry")} variant="secondary" compact onPress={refresh} />
          </div>
        )}
        {state === "ready" && result && result.books.length === 0 && (
          <NoResultsPanel
            title={t(`recommendations.emptyTitle.${emptyKey}`)}
            subtitle={t(`recommendations.emptySubtitle.${emptyKey}`)}
            iconName="star"
            actions={[
              coldStart
                ? { label: t("recommendations.actions.openFavorites"), onPress: () => navigate("/favorites") }
                : { label: t("recommendations.actions.openFilters"), onPress: () => navigate("/tags") },
            ]}
          />
        )}
        {state === "ready" && result && result.books.length > 0 && (
          <>
            <BookCollection books={result.books} enrich={false} onPress={open} onRead={read} />
            <div ref={sentinel} className="ax-feed-foot">
              {moreError ? (
                <Button title={t("common.retry")} variant="secondary" compact onPress={() => void loadMore()} />
              ) : hasMore ? (
                <Spinner size={22} />
              ) : null}
            </div>
          </>
        )}
      </div>

      <SettingsSheet visible={sheet} result={result} coldStart={coldStart} onClose={() => setSheet(false)} onCalibrationChanged={refresh} />
    </div>
  );
}

// ─── Шторка настроек ──────────────────────────────────────────────────────────

const SOURCE_KEY: Record<string, string> = {
  tagFavs: "recommendations.modal.tagFavs",
  localFavorites: "recommendations.modal.favs",
  onlineFavorites: "recommendations.modal.onlineFavs",
  readHistory: "recommendations.modal.readHist",
  searchHistory: "recommendations.modal.searchHist",
};

function fmtScore(n: number): string {
  if (!Number.isFinite(n)) return "—";
  const a = Math.abs(n);
  if (a > 0 && a < 0.02) return n.toPrecision(4);
  if (a < 100) return n.toFixed(2).replace(/\.?0+$/, "");
  return String(Math.round(n));
}

function SettingsSheet({
  visible,
  result,
  coldStart,
  onClose,
  onCalibrationChanged,
}: {
  visible: boolean;
  result: RecommendationResult | null;
  coldStart: boolean;
  onClose: () => void;
  onCalibrationChanged: () => void;
}) {
  const { t } = useI18n();
  const [calibration, setCalibration] = useState(readTagCalibration);
  const profile = result?.profile;
  const pref = profile?.pagePreference;
  const years = profile?.yearPreference;
  const filters = [...(result?.filterIncludes ?? []), ...(result?.filterExcludes ?? [])];

  useEffect(() => {
    if (visible) setCalibration(readTagCalibration());
  }, [visible]);

  const close = () => {
    onClose();
    if (calibration !== readTagCalibration()) {
      writeTagCalibration(calibration);
      onCalibrationChanged();
    }
  };

  return (
    <NhModal visible={visible} onClose={close} title={t("recommendations.modal.title")}>
      <div className="rec-sheet">
        <SectionLabel>{t("recommendations.modal.dataSection")}</SectionLabel>
        {profile ? (
          <div className="rec-box">
            <InfoRow icon="heart" label={t("recommendations.modal.favs")} value={profile.totalLocalFavorites} />
            <InfoRow icon="cloud" label={t("recommendations.modal.onlineFavs")} value={profile.totalOnlineFavorites} />
            <InfoRow icon="book-open" label={t("recommendations.modal.readHist")} value={profile.totalReadHistory} />
            <InfoRow icon="star" label={t("recommendations.modal.tagFavs")} value={profile.totalTagFavs} />
            <InfoRow icon="search" label={t("recommendations.modal.searchHist")} value={profile.totalSearchHistory} />
          </div>
        ) : (
          <p className="rec-text">{t("recommendations.loading")}</p>
        )}
        {coldStart && <p className="rec-note">{t("recommendations.modal.coldStartHint")}</p>}

        {filters.length > 0 && (
          <>
            <SectionLabel>{t("recommendations.modal.filtersSection")}</SectionLabel>
            <div className="rec-box">
              {filters.map((f) => (
                <div key={`${f.mode}:${f.type}:${f.name}`} className={f.mode === "include" ? "rec-filter is-include" : "rec-filter is-exclude"}>
                  <span className="rec-filter-mode">{t(f.mode === "include" ? "recommendations.modal.filterInclude" : "recommendations.modal.filterExclude")}</span>
                  <span className="rec-filter-name">{f.name}</span>
                  <span className="rec-filter-type">{f.type}</span>
                </div>
              ))}
            </div>
          </>
        )}

        {pref && (
          <>
            <SectionLabel>{t("recommendations.modal.pageSection")}</SectionLabel>
            <div className="rec-box">
              <InfoRow icon="file-text" label={t("recommendations.modal.pageAvg")} value={`${pref.avg} ${t("recommendations.modal.pages")}`} />
              <InfoRow icon="sliders" label={t("recommendations.modal.pageRange")} value={`${pref.minPreferred}–${pref.maxPreferred}`} />
              <InfoRow icon="align-left" label={t("recommendations.modal.pageTendency")} value={t(`recommendations.modal.pageLabel.${pref.label}`)} accent />
            </div>
          </>
        )}

        {years && years.topYears.length > 0 && (
          <>
            <SectionLabel>{t("recommendations.modal.yearSection")}</SectionLabel>
            <div className="rec-box">
              {years.topYears.map((year, i) => (
                <InfoRow key={year} icon="calendar" label={String(year)} value={`${years.yearCounts[year]} ${t("recommendations.modal.books")}`} accent={i === 0} />
              ))}
            </div>
          </>
        )}

        <SectionLabel>{t("recommendations.modal.tagPopCalibration")}</SectionLabel>
        <p className="rec-text">{t("recommendations.modal.tagPopCalibrationHint")}</p>
        <div className="rec-calib-ends">
          <span>{t("recommendations.modal.tagPopCalibrationLow")}</span>
          <span>{t("recommendations.modal.tagPopCalibrationHigh")}</span>
        </div>
        <Slider min={0} max={100} value={calibration} onChange={setCalibration} accessibilityLabel={t("recommendations.modal.tagPopCalibration")} />

        {profile && (profile.tagCalibration.length > 0 || profile.artists.length > 0 || profile.parodies.length > 0) && (
          <>
            <SectionLabel>{t("recommendations.modal.topPrefs")}</SectionLabel>
            {profile.tagCalibration.length > 0 && <TagTerms rows={profile.tagCalibration} calibration={calibration} />}
            {profile.artists.length > 0 && <Terms label={t("recommendations.modal.artists")} icon="pen-tool" terms={profile.artists.slice(0, 4)} />}
            {profile.parodies.length > 0 && <Terms label={t("recommendations.modal.parodies")} icon="film" terms={profile.parodies.slice(0, 3)} />}
          </>
        )}

        {result && result.queriesUsed.length > 0 && (
          <>
            <SectionLabel>{t("recommendations.modal.queriesSection")}</SectionLabel>
            <div className="rec-box rec-queries">
              {result.queriesUsed.map((q, i) => (
                <div key={i}>› {q}</div>
              ))}
              <div className="rec-generation">
                {t("recommendations.modal.generation")} #{result.generation}
              </div>
            </div>
          </>
        )}

        <SectionLabel>{t("recommendations.modal.algorithm")}</SectionLabel>
        <p className="rec-text">{t(coldStart ? "recommendations.modal.algorithmColdDesc" : "recommendations.modal.algorithmDesc")}</p>
        <p className="rec-note">{t("recommendations.modal.refreshNote")}</p>
      </div>
    </NhModal>
  );
}

function SectionLabel({ children }: { children: string }) {
  return <h3 className="rec-section">{children}</h3>;
}

function InfoRow({ icon, label, value, accent }: { icon: IconName; label: string; value: string | number; accent?: boolean }) {
  return (
    <div className="rec-info">
      <Icon name={icon} size={14} />
      <span className="rec-info-label">{label}</span>
      <span className={accent ? "rec-info-value is-accent" : "rec-info-value"}>{value}</span>
    </div>
  );
}

function Sources({ sources }: { sources: string[] }) {
  const { t } = useI18n();
  return (
    <>
      {sources.slice(0, 2).map((s) => (
        <span key={s} className="rec-source">
          {SOURCE_KEY[s] ? t(SOURCE_KEY[s]) : s}
        </span>
      ))}
    </>
  );
}

/** Топ тегов с формулой: пересчитывается прямо при движении ползунка. */
function TagTerms({ rows, calibration }: { rows: TagCalibrationRow[]; calibration: number }) {
  const { t } = useI18n();
  const items = useMemo(() => {
    const exp = 1 - calibration / 100;
    return rows
      .map((r) => {
        const w = tagPopularityMultiplier(r.popularity, calibration);
        return { ...r, w, exp, display: r.rawScore * w };
      })
      .sort((a, b) => b.display - a.display)
      .slice(0, 6);
  }, [rows, calibration]);

  return (
    <div className="rec-terms">
      <div className="rec-terms-head">
        <Icon name="tag" size={12} />
        {t("recommendations.modal.tags")}
      </div>
      {items.map((r) => (
        <div key={r.name} className="rec-term-block">
          <div className="rec-term">
            <span className="rec-term-name">{r.name}</span>
            <Sources sources={r.sources} />
            <span className="rec-term-score">{fmtScore(r.display)}</span>
          </div>
          <div className="rec-term-formula">{`${fmtScore(r.rawScore)}/(${r.popularity}^${r.exp.toFixed(3)})=${fmtScore(r.display)}`}</div>
        </div>
      ))}
    </div>
  );
}

function Terms({ label, icon, terms }: { label: string; icon: IconName; terms: ScoredTerm[] }) {
  return (
    <div className="rec-terms">
      <div className="rec-terms-head">
        <Icon name={icon} size={12} />
        {label}
      </div>
      {terms.map((term) => (
        <div key={term.name} className="rec-term">
          <span className="rec-term-name">{term.name}</span>
          <Sources sources={term.sources} />
          <span className="rec-term-score">{Math.round(term.score)}</span>
        </div>
      ))}
    </div>
  );
}
