/**
 * Верхняя строка — перенос `components/SearchBar.tsx` (ветка master / релиз 1.3.1).
 * Слева «меню» на главной или «назад» на остальных (долгое нажатие — шторка «Назад»),
 * по центру заголовок экрана, справа поиск, меню фильтров (язык, страницы, дата, сортировка) и теги.
 */
import { useEffect, useState } from "react";
import { useLocation, useNavigate, useSearchParams } from "react-router-dom";
import type { SortOrder } from "../api/types";
import { useI18n } from "../i18n/I18nContext";
import { useMe } from "../lib/session";
import {
  LANGUAGE_OPTIONS,
  getLanguage,
  getPagesQuery,
  getSort,
  getDateRange,
  getUploaded,
  setLanguage,
  setPagesQuery,
  setSort,
  setCustomRange,
  setUploaded,
  useBrowseFilters,
  type LanguageOption,
} from "../lib/browseFilters";
import { CloudButton } from "./CloudButton";
import { CalendarRangePicker, formatDMY, toISODate } from "../components/CalendarRangePicker";
import { FilterDropdown, Icon, NhModal, useLongPress, type IconName, type SelectItem } from "../ui";

const PRESETS: { key: SortOrder; labelKey: string; icon: IconName }[] = [
  { key: "date", labelKey: "explore.sort.latest", icon: "clock" },
  { key: "popular-today", labelKey: "explore.sort.popularToday", icon: "sun" },
  { key: "popular-week", labelKey: "explore.sort.popularWeek", icon: "calendar" },
  { key: "popular-month", labelKey: "explore.sort.popularMonth", icon: "calendar" },
  { key: "popular", labelKey: "explore.sort.popular", icon: "trending-up" },
];

/** «За последние X» — `uploaded:<X`, как DATE_PRESETS в старом. */
const DATE_PRESETS: { value: string; labelKey: string }[] = [
  { value: "uploaded:<2h", labelKey: "explore.date.2h" },
  { value: "uploaded:<24h", labelKey: "explore.date.24h" },
  { value: "uploaded:<3d", labelKey: "explore.date.3d" },
  { value: "uploaded:<7d", labelKey: "explore.date.7d" },
  { value: "uploaded:<30d", labelKey: "explore.date.30d" },
  { value: "uploaded:<90d", labelKey: "explore.date.90d" },
  { value: "uploaded:<180d", labelKey: "explore.date.180d" },
  { value: "uploaded:<365d", labelKey: "explore.date.1y" },
];

const LANG_LABEL: Record<LanguageOption, string> = {
  english: "explore.language.english",
  japanese: "explore.language.japanese",
  chinese: "explore.language.chinese",
};

/** Первый сегмент пути — как hasSeg в старом. */
function section(pathname: string): string {
  return pathname.split("/").filter(Boolean)[0] ?? "";
}

/** Экраны без правых иконок (hideRight в старом). */
const HIDE_RIGHT = new Set(["settings", "tags", "book", "profile", "characters", "favorites", "favorites-online", "uikit"]);

export function TopBar({ onOpenMenu }: { onOpenMenu: () => void }) {
  const { t } = useI18n();
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const [params] = useSearchParams();
  const [backOpen, setBackOpen] = useState(false);
  useBrowseFilters();

  const me = useMe();
  const seg = section(pathname);
  const isHome = seg === "";
  const q = params.get("query") ?? "";

  const title = (() => {
    switch (seg) {
      case "":
        return t("menu.home");
      case "explore":
        return q ? `${t("search.results")}: ${q}` : t("menu.explore");
      case "favorites":
        return t("menu.favorites");
      case "favorites-online":
        return t("menu.favoritesOnline");
      case "downloaded":
        return t("menu.downloaded");
      case "recommendations":
        return t("menu.recommendations");
      case "history":
        return t("menu.history");
      case "characters":
        return t("menu.characters");
      case "settings":
        return t("menu.settings");
      case "book":
        return `#${pathname.split("/")[2] ?? ""} - ${params.get("title") ?? ""}`;
      case "tags":
        return t("menu.tags");
      case "profile": {
        const [, , pid, pslug, sub] = pathname.split("/");
        if (sub === "edit") return t("profile.edit.title");
        return me && String(me.id) === pid ? t("menu.profile") : decodeURIComponent(pslug ?? "");
      }
      case "uikit":
        return t("uikit.title");
      default:
        return "NHApp";
    }
  })();

  const backLong = useLongPress(() => setBackOpen(true));
  const hideRight = HIDE_RIGHT.has(seg);
  const hideSearchFilter = seg === "recommendations";

  const sort = getSort();
  const uploaded = getUploaded();
  const language = getLanguage();
  const pagesQuery = getPagesQuery();
  const presetLabel = DATE_PRESETS.find((p) => p.value === uploaded)?.labelKey;
  const dateRange = getDateRange();
  const uploadedLabel = presetLabel
    ? t(presetLabel)
    : uploaded
      ? dateRange.customRangeLabel || t("explore.dateRangeCustom")
      : t("explore.dateRange");

  /** Диапазон из календаря → `uploaded:>{до}d uploaded:<{от}d` в днях назад (как applyCalendarRange). */
  const applyCalendarRange = (from: Date, to: Date) => {
    const dayMs = 24 * 60 * 60 * 1000;
    const fromDaysAgo = Math.floor((Date.now() - from.getTime()) / dayMs);
    const toDaysAgo = Math.floor((Date.now() - to.getTime()) / dayMs);
    setCustomRange(
      `uploaded:>${toDaysAgo - 1}d uploaded:<${fromDaysAgo + 1}d`,
      `${formatDMY(from)} – ${formatDMY(to)}`,
      toISODate(from),
      toISODate(to),
    );
  };

  const filterItems: SelectItem[] = [
    {
      type: "submenu",
      label: `${t("explore.filter.language")}: ${language ? t(LANG_LABEL[language]) : t("explore.language.all")}`,
      icon: <Icon name="globe" size={15} />,
      children: [
        { value: "lang:all", label: t("explore.language.all") },
        ...LANGUAGE_OPTIONS.map((l) => ({ value: `lang:${l}`, label: t(LANG_LABEL[l]) })),
      ],
    },
    {
      type: "submenu",
      label: pagesQuery ? `${t("explore.filter.pages")}: ${pagesQuery}` : t("explore.filter.pages"),
      icon: <Icon name="file-text" size={15} />,
      children: [
        {
          type: "custom",
          label: t("explore.filter.pages"),
          backLabel: t("explore.date.back"),
          preferredHeight: 178,
          content: ({ onClose }) => (
            <PagesFilterEditor
              initialQuery={pagesQuery}
              onApply={(next) => {
                setPagesQuery(next);
                onClose();
              }}
              onClear={() => {
                setPagesQuery("");
                onClose();
              }}
            />
          ),
        },
      ],
    },
    {
      type: "submenu",
      label: uploadedLabel,
      backLabel: t("explore.date.back"),
      icon: <Icon name="calendar" size={15} />,
      children: [
        {
          type: "submenu",
          label: t("explore.date.customRange"),
          icon: <Icon name="calendar" size={15} />,
          children: [
            {
              type: "custom",
              label: t("explore.dateRangeCustom"),
              backLabel: t("explore.date.backToDateList"),
              content: ({ onClose, openSubmenu }) => (
                <CalendarRangePicker
                  onApply={applyCalendarRange}
                  onClose={onClose}
                  onReset={() => setUploaded(null)}
                  openSubmenu={openSubmenu}
                  initialFrom={dateRange.lastCustomFrom}
                  initialTo={dateRange.lastCustomTo}
                />
              ),
            },
          ],
        },
        ...DATE_PRESETS.map((p) => ({ value: p.value, label: t(p.labelKey), indicatorShape: "square" as const })),
      ],
    },
    { type: "group", label: t("explore.filter.sortTitle") },
    ...PRESETS.map((p) => ({ value: `sort:${p.key}`, label: t(p.labelKey), icon: <Icon name={p.icon} size={15} /> })),
  ];

  return (
    <header className="topbar">
      {isHome ? (
        <button type="button" className="topbar-btn" aria-label={t("menu.open")} onClick={onOpenMenu}>
          <Icon name="menu" size={22} />
        </button>
      ) : (
        <button
          type="button"
          className="topbar-btn"
          aria-label={t("common.back")}
          onPointerDown={backLong.start}
          onPointerUp={backLong.cancel}
          onPointerLeave={backLong.cancel}
          onClick={() => {
            if (!backLong.fired()) navigate(-1);
          }}
        >
          <Icon name="arrow-left" size={20} />
        </button>
      )}
      <h1 className="topbar-title">{title}</h1>

      {!hideRight && (
        <div className="topbar-right">
          {me && <CloudButton />}
          {!hideSearchFilter && (
            <button
              type="button"
              className="topbar-btn"
              aria-label={t("menu.search")}
              onClick={() => navigate(q ? `/search?query=${encodeURIComponent(q)}` : "/search")}
            >
              <Icon name="search" size={18} />
            </button>
          )}
          {!hideSearchFilter && (
            <FilterDropdown
              value={language ? `lang:${language}` : "lang:all"}
              secondaryValue={uploaded ?? `sort:${sort}`}
              options={filterItems}
              maxDropdownHeight={560}
              keepOpen
              onChange={(val) => {
                if (val.startsWith("lang:")) {
                  const next = val.slice(5);
                  setLanguage(next === "all" ? null : (next as LanguageOption));
                } else if (val.startsWith("sort:")) {
                  setSort(val.slice(5) as SortOrder);
                } else if (DATE_PRESETS.some((p) => p.value === val)) {
                  setUploaded(val === uploaded ? null : val);
                }
              }}
              trigger={({ onPress }) => (
                <button type="button" className="topbar-btn topbar-accent" aria-label={t("explore.filter.sortTitle")} onClick={onPress}>
                  <Icon name="filter" size={18} />
                </button>
              )}
            />
          )}
          <button type="button" className="topbar-btn topbar-accent" aria-label={t("menu.tags")} onClick={() => navigate("/tags")}>
            <Icon name="tag" size={18} />
          </button>
        </div>
      )}

      <NhModal visible={backOpen} onClose={() => setBackOpen(false)} title={t("common.back")} sheetStyle={{ background: "var(--search-bg)" }}>
        <div className="back-sheet">
          <button
            type="button"
            onClick={() => {
              setBackOpen(false);
              navigate(-1);
            }}
          >
            {t("searchBar.backOne")}
          </button>
          <button
            type="button"
            onClick={() => {
              setBackOpen(false);
              navigate(-2);
            }}
          >
            {t("searchBar.backTwo")}
          </button>
          <button
            type="button"
            onClick={() => {
              setBackOpen(false);
              navigate("/", { replace: true });
            }}
          >
            {t("searchBar.backHome")}
          </button>
        </div>
      </NhModal>
    </header>
  );
}

type PagesMode = "eq" | "gt" | "lt" | "range";

/** Редактор фильтра страниц — PagesFilterEditor из старого SearchBar. */
function PagesFilterEditor({
  initialQuery,
  onApply,
  onClear,
}: {
  initialQuery: string;
  onApply: (query: string) => void;
  onClear: () => void;
}) {
  const { t } = useI18n();
  const [mode, setMode] = useState<PagesMode>("eq");
  const [v1, setV1] = useState("");
  const [v2, setV2] = useState("");

  useEffect(() => {
    const q = initialQuery.trim();
    const range = q.match(/^pages:>=?(\d+)\s+pages:<=?(\d+)$/i);
    const gt = q.match(/^pages:>(\d+)$/i);
    const lt = q.match(/^pages:<(\d+)$/i);
    const eq = q.match(/^pages:(\d+)$/i);
    if (range) {
      setMode("range");
      setV1(range[1]);
      setV2(range[2]);
    } else if (gt) {
      setMode("gt");
      setV1(gt[1]);
    } else if (lt) {
      setMode("lt");
      setV1(lt[1]);
    } else if (eq) {
      setMode("eq");
      setV1(eq[1]);
    }
  }, [initialQuery]);

  const toInt = (s: string) => {
    const n = Number(s);
    return Number.isFinite(n) && n > 0 ? Math.floor(n) : 0;
  };

  const apply = () => {
    const a = toInt(v1);
    const b = toInt(v2);
    let next = "";
    if (mode === "eq" && a > 0) next = `pages:${a}`;
    if (mode === "gt" && a > 0) next = `pages:>${a}`;
    if (mode === "lt" && a > 0) next = `pages:<${a}`;
    if (mode === "range" && a > 0 && b > 0) next = `pages:>=${Math.min(a, b)} pages:<=${Math.max(a, b)}`;
    if (next) onApply(next);
  };

  return (
    <div className="pages-filter">
      <div className="pages-filter-modes">
        {(
          [
            ["eq", "="],
            ["gt", ">"],
            ["lt", "<"],
            ["range", "↔"],
          ] as [PagesMode, string][]
        ).map(([k, label]) => (
          <button key={k} type="button" className={mode === k ? "is-on" : ""} onClick={() => setMode(k)}>
            {label}
          </button>
        ))}
      </div>
      <div className="pages-filter-inputs">
        <input
          value={v1}
          inputMode="numeric"
          placeholder={t("explore.pages.input.primary")}
          onChange={(e) => setV1(e.target.value.replace(/[^\d]/g, ""))}
        />
        {mode === "range" && (
          <input
            value={v2}
            inputMode="numeric"
            placeholder={t("explore.pages.input.secondary")}
            onChange={(e) => setV2(e.target.value.replace(/[^\d]/g, ""))}
          />
        )}
      </div>
      <div className="pages-filter-actions">
        <button type="button" className="pages-filter-reset" onClick={onClear}>
          {t("common.reset")}
        </button>
        <button type="button" className="pages-filter-apply" onClick={apply}>
          {t("common.apply")}
        </button>
      </div>
    </div>
  );
}
