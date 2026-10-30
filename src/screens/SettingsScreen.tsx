/**
 * Настройки — перенос `app/settings/index.tsx` и `components/settings/*` (релиз 1.3.1):
 * SettingsLayout, Section, Card, LanguageSelector, HuePaletteSelector, SwitchRow, GridSection.
 * Порядок: Язык → Внешний вид (палитра, бесконечная прокрутка, теги при переходе) → Отображение →
 * Сетка каталога → Хранилище устройства; внизу версия (три тапа — витрина UI-кита).
 */
import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { useNavigate } from "react-router-dom";
import { version } from "../../package.json";
import { galleryCardToBook, type Book } from "../api/book";
import { listGalleries } from "../api/galleries";
import { initCdn } from "../api/media";
import { BookCard } from "../components/BookCard";
import { DEFAULT_GRID, type GridConfig } from "../components/BookGrid";
import { useI18n, type AppLocale } from "../i18n/I18nContext";
import { KEYS, getItem, getJSON, removeItem, setItem, setJSON } from "../lib/storage";
import { useBackHandler } from "../shell/androidBack";
import { StorageManager } from "../components/StorageManager";
import { downloadsDir, inTauri } from "../lib/downloads";
import { applyTheme, getBaseHue, saveHue, setBaseHue, themeColors } from "../theme";
import { Icon } from "../ui";
import { applyFullscreen } from "../shell/systemUi";

type GridProfile = keyof typeof DEFAULT_GRID;
const PROFILES: GridProfile[] = ["phonePortrait", "phoneLandscape", "tabletPortrait", "tabletLandscape"];

/** Цвет образца палитры — hslToHex(h, 78%, 50%) из HuePaletteSelector. */
function hslToHex(h: number, s: number, l: number): string {
  h %= 360;
  s /= 100;
  l /= 100;
  const c = (1 - Math.abs(2 * l - 1)) * s;
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
  const m = l - c / 2;
  const [r, g, b] =
    h < 60 ? [c, x, 0] : h < 120 ? [x, c, 0] : h < 180 ? [0, c, x] : h < 240 ? [0, x, c] : h < 300 ? [x, 0, c] : [c, 0, x];
  return `#${[r, g, b].map((v) => Math.round((v + m) * 255).toString(16).padStart(2, "0")).join("")}`.toUpperCase();
}

function usePersistedBool(key: string, def: boolean): [boolean, (v: boolean) => void] {
  const [v, setV] = useState(() => {
    const raw = getItem(key);
    return raw == null ? def : raw === "true" || raw === "1";
  });
  return [
    v,
    (next) => {
      setV(next);
      setItem(key, next ? "true" : "false");
    },
  ];
}

export function SettingsScreen() {
  const { t } = useI18n();
  const navigate = useNavigate();
  const [hue, setHue] = useState(() => Math.round(getBaseHue()));
  const [infinite, setInfinite] = usePersistedBool(KEYS.infiniteScroll, false);
  const [resetTags, setResetTags] = usePersistedBool(KEYS.resetTagsOnBookTagNav, false);
  const [fullscreen, setFullscreen] = usePersistedBool(KEYS.fullscreen, false);
  const taps = useRef<{ count: number; timer: number | null }>({ count: 0, timer: null });

  const onHue = (deg: number) => {
    setHue(deg);
    setBaseHue(deg);
    saveHue(deg);
    applyTheme(themeColors());
  };

  const onVersionPress = () => {
    const s = taps.current;
    if (s.timer !== null) window.clearTimeout(s.timer);
    s.count += 1;
    if (s.count >= 3) {
      s.count = 0;
      navigate("/uikit");
      return;
    }
    s.timer = window.setTimeout(() => {
      s.count = 0;
      s.timer = null;
    }, 1500);
  };

  const toggleFullscreen = (v: boolean) => {
    setFullscreen(v);
    applyFullscreen(v);
  };

  const selected = Math.round(hue / 10) * 10;
  // Размер образца как в HuePaletteSelector: от ширины окна, 28…36px; перенос — по ширине карточки
  const hueItemSize = Math.max(28, Math.min(36, (window.innerWidth - 16 * 2 - 8 * 9) / 10));

  return (
    <div className="settings-page">
      <div className="settings-content">
        <SettingsSection title={t("settings.section.language")} />
        <SettingsCard>
          <LanguageSelector />
        </SettingsCard>

        <SettingsSection title={t("settings.section.appearance")} />
        <SettingsCard>
          <div className="settings-theme-title">{t("settings.appearance.theme")}</div>
          <div className="hue-palette">
            <div className="hue-grid" style={{ "--hue-size": `${hueItemSize}px` } as CSSProperties}>
              {Array.from({ length: 36 }, (_, i) => i * 10).map((h) => (
                <button
                  key={h}
                  type="button"
                  className={h === selected ? "hue-item is-selected" : "hue-item"}
                  style={{ background: hslToHex(h, 78, 50) }}
                  aria-label={`${h}°`}
                  onClick={() => onHue(h)}
                >
                  {h === selected && (
                    <span className="hue-check">
                      <Icon name="check" size={10} />
                    </span>
                  )}
                </button>
              ))}
            </div>
            <div className="hue-current">
              <span>{t("settings.appearance.hue", { deg: Math.round(hue) })}</span>
              <span className="hue-current-dot" style={{ background: hslToHex(hue, 78, 50) }} />
            </div>
          </div>
          <SwitchRow
            title={t("settings.appearance.infiniteScroll")}
            description={t("settings.appearance.infiniteScrollDesc")}
            value={infinite}
            onChange={setInfinite}
          />
          <SwitchRow
            title={t("settings.appearance.includeTagsOnBookTagNav")}
            description={t("settings.appearance.includeTagsOnBookTagNavDesc")}
            value={!resetTags}
            onChange={(v) => setResetTags(!v)}
          />
        </SettingsCard>

        <SettingsSection title={t("settings.section.display")} />
        <SettingsCard>
          <SwitchRow
            title={t("settings.display.fullscreen")}
            description={t("settings.display.fullscreenDesc")}
            value={fullscreen}
            onChange={toggleFullscreen}
          />
          <div className="settings-note">{t("settings.display.androidNote")}</div>
        </SettingsCard>

        <SettingsSection title={t("settings.section.grid")} />
        <GridSection />

        <SettingsSection title={t("settings.section.storage")} />
        <SavePathRow />
        <StorageManager />
      </div>
      <div className="settings-footer">
        <button type="button" onClick={onVersionPress}>
          v{version} {t("app.version.beta")}
        </button>
      </div>
    </div>
  );
}

/**
 * Папка загрузок — `settings/rows/SavePathRow.tsx`. Только на ПК: на Android книги лежат в папке
 * приложения, как в 1.3.1. Ключ `electron:savePath` тот же, что у старого ПК-клиента.
 */
function SavePathRow() {
  const { t } = useI18n();
  const [path, setPath] = useState("");
  const [busy, setBusy] = useState(false);
  const custom = getItem(KEYS.savePath);
  const desktop = inTauri() && !window.NHAppNative;

  useEffect(() => {
    if (desktop) void downloadsDir().then(setPath).catch(() => setPath(""));
  }, [desktop, custom]);

  if (!desktop) return null;

  const choose = async () => {
    setBusy(true);
    try {
      const { open } = await import("@tauri-apps/plugin-dialog");
      const picked = await open({ directory: true, multiple: false, defaultPath: custom || undefined, title: t("settings.storage.savePath") });
      if (typeof picked === "string" && picked) {
        setItem(KEYS.savePath, picked);
        setPath(await downloadsDir());
      }
    } finally {
      setBusy(false);
    }
  };

  const reset = async () => {
    removeItem(KEYS.savePath);
    setPath(await downloadsDir());
  };

  return (
    <SettingsCard>
      <div className="settings-theme-title">{t("settings.storage.savePath")}</div>
      <p className="settings-muted savepath-desc">{t("settings.storage.savePathDesc")}</p>
      <button type="button" className="savepath-box" disabled={busy} onClick={() => void choose()}>
        <span className="savepath-path">{path || t("common.loading")}</span>
        <span className="savepath-hint">{t("downloads.choose")}</span>
      </button>
      {custom && (
        <button type="button" className="savepath-reset" onClick={() => void reset()}>
          {t("downloads.reset")}
        </button>
      )}
    </SettingsCard>
  );
}

/** Заголовок раздела. В старом иконка ищется по переведённому заголовку и не находится — всегда шестерёнка. */
function SettingsSection({ title }: { title: string }) {
  return (
    <div className="settings-section">
      <span className="settings-section-icon">
        <Icon name="settings" size={16} />
      </span>
      <span className="settings-section-title">{title}</span>
    </div>
  );
}

function SettingsCard({ children }: { children: ReactNode }) {
  return <div className="settings-card">{children}</div>;
}

function SwitchRow({
  title,
  description,
  value,
  onChange,
}: {
  title: string;
  description?: string;
  value: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <div className="switch-row">
      <div className="switch-row-text">
        <div className="switch-row-title">{title}</div>
        {description && <div className="switch-row-desc">{description}</div>}
      </div>
      <button
        type="button"
        role="switch"
        aria-checked={value}
        aria-label={title}
        className={value ? "android-switch is-on" : "android-switch"}
        onClick={() => onChange(!value)}
      >
        <span className="android-switch-track" />
        <span className="android-switch-thumb" />
      </button>
    </div>
  );
}

/** Выбор языка — кнопка «Текущий: …» и модальное окно со списком (LanguageSelector). */
function LanguageSelector() {
  const { t, available, locale, setLocale } = useI18n();
  const [open, setOpen] = useState(false);
  useBackHandler(open, () => setOpen(false));
  const current = available.find((o) => o.code === locale);

  return (
    <>
      <button type="button" className="lang-selector" onClick={() => setOpen(true)}>
        <span className="lang-selector-left">
          <span className="lang-selector-label">{t("settings.language.current")}</span>
          <span className="lang-selector-value">{current?.label ?? locale}</span>
        </span>
        <Icon name="chevron-down" size={20} className="ui-accent" />
      </button>
      {open &&
        createPortal(
          <div className="lang-modal-overlay" onClick={() => setOpen(false)}>
            <div className="lang-modal" role="dialog" onClick={(e) => e.stopPropagation()}>
              <div className="lang-modal-header">
                <span>{t("settings.language.choose")}</span>
                <button type="button" aria-label="Close" onClick={() => setOpen(false)}>
                  <Icon name="x" size={20} />
                </button>
              </div>
              <div className="lang-modal-list">
                {available.map((opt) => {
                  const on = opt.code === locale;
                  return (
                    <button
                      key={opt.code}
                      type="button"
                      className={on ? "lang-modal-item is-selected" : "lang-modal-item"}
                      onClick={() => {
                        setLocale(opt.code as AppLocale);
                        setOpen(false);
                      }}
                    >
                      <span>{opt.label}</span>
                      {on && <Icon name="check" size={18} />}
                    </button>
                  );
                })}
              </div>
              <div className="lang-modal-note">
                <Icon name="info" size={14} className="ui-accent" />
                <span>{t("settings.language.note")}</span>
              </div>
            </div>
          </div>,
          document.body,
        )}
    </>
  );
}

/** Сетка каталога — GridSection: профили, превью строкой, ползунки, сброс. Ключ `grid_config_map_v2`. */
function GridSection() {
  const { t } = useI18n();
  const isTablet = Math.min(window.innerWidth, window.innerHeight) >= 600;
  const landscape = window.innerWidth > window.innerHeight;
  const [profile, setProfile] = useState<GridProfile>(
    isTablet ? (landscape ? "tabletLandscape" : "tabletPortrait") : landscape ? "phoneLandscape" : "phonePortrait",
  );
  const [map, setMap] = useState<Record<GridProfile, GridConfig>>(() => ({ ...DEFAULT_GRID, ...getJSON(KEYS.gridConfig, {}) }));
  const [preview, setPreview] = useState<Book[]>([]);
  const [previewW, setPreviewW] = useState(0);
  const previewRef = useRef<HTMLDivElement>(null);
  const cfg = map[profile];

  useEffect(() => {
    let alive = true;
    void (async () => {
      try {
        await initCdn();
        const res = await listGalleries(1, "popular", "");
        if (alive) setPreview(res.result.map(galleryCardToBook));
      } catch {
        /* превью необязательно */
      }
    })();
    return () => {
      alive = false;
    };
  }, []);

  useEffect(() => {
    const el = previewRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setPreviewW(Math.floor(el.getBoundingClientRect().width)));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const save = (next: Record<GridProfile, GridConfig>) => {
    setMap(next);
    setJSON(KEYS.gridConfig, next);
  };
  const update = (patch: Partial<GridConfig>) => save({ ...map, [profile]: { ...cfg, ...patch } });

  const pad = cfg.paddingHorizontal ?? 0;
  const gap = cfg.columnGap ?? 0;
  const minW = cfg.minColumnWidth ?? 80;
  const inner = Math.max(0, previewW - pad * 2);
  const colsMax = Math.min(12, Math.max(1, Math.floor((inner + gap) / (minW + gap))));
  const cols = Math.min(cfg.numColumns, colsMax);
  const cardW = cols > 0 ? (inner - gap * (cols - 1)) / cols : 0;

  const slider = (label: string, value: number, min: number, max: number, badge: string, onCommit: (v: number) => void) => (
    <div>
      <div className="grid-setting-head">
        <span className="grid-setting-label">{label}</span>
        <span className="grid-setting-badge">{badge}</span>
      </div>
      <div className="grid-slider-wrap">
        <input
          type="range"
          className="grid-slider"
          min={min}
          max={max}
          step={1}
          value={value}
          style={{ "--pct": `${max > min ? ((value - min) / (max - min)) * 100 : 0}%` } as CSSProperties}
          onChange={(e) => onCommit(Number(e.target.value))}
        />
      </div>
    </div>
  );

  return (
    <SettingsCard>
      <div className="grid-profiles">
        {PROFILES.map((p) => (
          <button key={p} type="button" className={p === profile ? "grid-profile is-active" : "grid-profile"} onClick={() => setProfile(p)}>
            {t(`settings.grid.${p}`)}
          </button>
        ))}
      </div>
      <div ref={previewRef} className="grid-preview" style={{ padding: `0 ${pad}px`, gap }}>
        {cardW > 0 && preview.map((b) => <BookCard key={b.id} book={b} cardWidth={cardW} />)}
      </div>
      <div className="grid-settings">
        {slider(t("settings.grid.columns"), cols, 1, colsMax, String(cols), (v) => update({ numColumns: Math.max(1, Math.min(colsMax, v)) }))}
        {slider(t("settings.grid.minWidth"), minW, 80, 200, `${minW}px`, (v) => update({ minColumnWidth: v }))}
        {slider(t("settings.grid.sidePadding"), pad, 0, 32, String(pad), (v) => update({ paddingHorizontal: v }))}
        {slider(t("settings.grid.columnGap"), gap, 0, 24, String(gap), (v) => update({ columnGap: v }))}
      </div>
      <div className="grid-actions">
        <button type="button" className="grid-reset" onClick={() => update(DEFAULT_GRID[profile])}>
          <Icon name="rotate-ccw" size={14} />
          <span>{t("settings.grid.resetProfile")}</span>
        </button>
        <button type="button" className="grid-reset is-all" onClick={() => save({ ...DEFAULT_GRID })}>
          <Icon name="trash-2" size={14} />
          <span>{t("settings.grid.resetAll")}</span>
        </button>
      </div>
    </SettingsCard>
  );
}
