/**
 * Меню фильтров каталога — язык, страницы, дата загрузки и сортировка (из `components/SearchBar.tsx`).
 * Вынесено из шапки: на главной оно открывается из полосы вкладок, где сортировку задают сами вкладки
 * (`withSort={false}`), в результатах поиска — из шапки.
 */
import { useEffect, useState, type ReactNode } from "react";
import type { SortOrder } from "../api/types";
import { useI18n } from "../i18n/I18nContext";
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
import { CalendarRangePicker, formatDMY, toISODate } from "../components/CalendarRangePicker";
import { FilterDropdown, Icon, type IconName, type SelectItem } from "../ui";

export const PRESETS: { key: SortOrder; labelKey: string; icon: IconName }[] = [
  { key: "date", labelKey: "explore.sort.latest", icon: "clock" },
  { key: "popular-today", labelKey: "explore.sort.popularToday", icon: "sun" },
  { key: "popular-week", labelKey: "explore.sort.popularWeek", icon: "calendar" },
  { key: "popular-month", labelKey: "explore.sort.popularMonth", icon: "calendar" },
  { key: "popular", labelKey: "explore.sort.popular", icon: "trending-up" },
];

/** «За последние X» — `uploaded:<X`, как DATE_PRESETS в старом. */
export const DATE_PRESETS: { value: string; labelKey: string }[] = [
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

export function CatalogFilterButton({
  trigger,
  withSort = true,
}: {
  trigger: (props: { open: boolean; onPress: () => void }) => ReactNode;
  withSort?: boolean;
}) {
  const { t } = useI18n();
  useBrowseFilters();
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
    ...(withSort
      ? [
          { type: "group" as const, label: t("explore.filter.sortTitle") },
          ...PRESETS.map((p) => ({ value: `sort:${p.key}`, label: t(p.labelKey), icon: <Icon name={p.icon} size={15} /> })),
        ]
      : []),
  ];

  return (
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
      trigger={trigger}
    />
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
