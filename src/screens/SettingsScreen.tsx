/**
 * Настройки — редизайн (по образцу настроек Telegram, в стиле кита): сверху аватар и имя аккаунта,
 * ниже карточки-группы с объёмными цветными иконками, заголовком и подписью; пункт открывает свою страницу
 * (`/settings/:section`): аккаунт (правка профиля), язык (список с отметкой), внешний вид и т. д.
 * Окон-модалок нет — всё отдельными страницами. Внизу версия (три тапа — витрина UI-кита).
 *
 * Содержимое страниц — перенос `app/settings/index.tsx` и `components/settings/*` (релиз 1.3.1):
 * Внешний вид (палитра, бесконечная прокрутка, теги при переходе), Отображение, Карточки книг (вид, что
 * показывать, предпросмотр, колонки сетки), Хранилище.
 */
import { useEffect, useRef, useState, type CSSProperties } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { version } from "../../package.json";
import { galleryCardToBook, type Book } from "../api/book";
import { getRandomGalleryId, listGalleries } from "../api/galleries";
import { initCdn } from "../api/media";
import { BookCollection } from "../components/BookCollection";
import { DEFAULT_GRID, gridLayout, gridProfileFor, loadGridConfig, saveGridConfig, type GridConfig, type GridProfile } from "../components/BookGrid";
import { avatarUrl } from "../components/CommentCard";
import { StorageManager } from "../components/StorageManager";
import { useI18n, type AppLocale } from "../i18n/I18nContext";
import { CARD_VIEWS, setCardView, useCardView, type CardViewKind } from "../lib/cardView";
import { downloadsDir, inTauri } from "../lib/downloads";
import { ownProfileRoute, useMe } from "../lib/session";
import { KEYS, getItem, removeItem, setItem } from "../lib/storage";
import { setLangPref, useLangPref } from "../lib/langPrefs";
import { LoginModal } from "../shell/LoginModal";
import { applyFullscreen } from "../shell/systemUi";
import { applyTheme, getBaseHue, saveHue, setBaseHue, themeColors } from "../theme";
import { Icon, ListGroup, ListHint, ListRow, RadioRow, Spinner, StepperRow, SwitchRow, type IconName } from "../ui";
import { ProfileEditScreen } from "./ProfileEditScreen";
import { ServerSettings } from "./ServerSettings";
import { UpdatesSettings } from "./UpdatesSettings";

const DISCORD_URL = "https://discord.gg/VnxH7yfPqf";

/** Страницы настроек: адрес `/settings/<key>`, иконка и её цвет в списке, подпись. */
const SECTIONS: { key: string; icon: IconName; color: string; subKey: string }[] = [
  { key: "appearance", icon: "palette", color: "#e8594f", subKey: "settings.hub.appearanceSub" },
  { key: "display", icon: "smartphone", color: "#4cae5b", subKey: "settings.hub.displaySub" },
  { key: "cards", icon: "grid", color: "#f0973b", subKey: "settings.hub.cardsSub" },
  { key: "storage", icon: "database", color: "#9a6ae0", subKey: "settings.hub.storageSub" },
  { key: "updates", icon: "download", color: "#3fa7e0", subKey: "settings.hub.updatesSub" },
  { key: "server", icon: "cloud", color: "#2fb39a", subKey: "settings.hub.serverSub" },
];

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

/** Главная страница настроек: аккаунт, список разделов, «Ещё», версия. */
export function SettingsScreen() {
  const { t, available, locale } = useI18n();
  const navigate = useNavigate();
  const me = useMe();
  const [loginOpen, setLoginOpen] = useState(false);
  const [randomBusy, setRandomBusy] = useState(false);
  const taps = useRef<{ count: number; timer: number | null }>({ count: 0, timer: null });
  const avatar = me?.avatar_url ? avatarUrl(me.avatar_url) : "";

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

  const goRandom = async () => {
    if (randomBusy) return;
    setRandomBusy(true);
    try {
      await initCdn();
      navigate(`/book/${await getRandomGalleryId()}?random=1`);
    } catch {
      /* как в старом меню — молча */
    } finally {
      setRandomBusy(false);
    }
  };

  return (
    <div className="screen-scroll set-page set-hub">
      <button type="button" className="set-account" onClick={() => (me ? navigate(ownProfileRoute(me)) : setLoginOpen(true))}>
        <span className="set-account-avatar">{avatar ? <img src={avatar} alt="" /> : <Icon name="user" size={44} />}</span>
        <span className="set-account-name">{me ? me.username : t("nav.guest")}</span>
        <span className="set-account-sub">{me ? t("settings.hub.userId", { id: me.id }) : t("settings.hub.guestSub")}</span>
      </button>

      <ListGroup>
        {me && (
          <ListRow
            icon="user"
            color="#2f9be8"
            title={t("settings.section.account")}
            sub={t("settings.hub.accountSub")}
            onPress={() => navigate("/settings/account")}
          />
        )}
        <ListRow
          icon="language"
          color="#5b7cf0"
          title={t("settings.section.language")}
          sub={available.find((o) => o.code === locale)?.label ?? locale}
          onPress={() => navigate("/settings/language")}
        />
        {SECTIONS.map((s) => (
          <ListRow
            key={s.key}
            icon={s.icon}
            color={s.color}
            title={t(`settings.section.${s.key}`)}
            sub={t(s.subKey)}
            onPress={() => navigate(`/settings/${s.key}`)}
          />
        ))}
      </ListGroup>

      <ListGroup title={t("settings.hub.more")}>
        <ListRow
          icon="dice"
          color="#e0a23b"
          title={t("menu.random")}
          sub={t("settings.hub.randomSub")}
          trailing={randomBusy ? <Spinner size={18} /> : undefined}
          onPress={() => void goRandom()}
        />
        <ListRow
          icon="discord"
          color="#5865f2"
          title={t("menu.discordJoin")}
          sub={t("settings.hub.discordSub")}
          trailing={<Icon name="arrow-up-right" size={18} />}
          onPress={() => window.open(DISCORD_URL, "_blank", "noopener")}
        />
      </ListGroup>

      <div className="set-footer">
        <button type="button" onClick={onVersionPress}>
          NHApp v{version} {t("app.version.beta")}
        </button>
      </div>

      <LoginModal visible={loginOpen} onClose={() => setLoginOpen(false)} />
    </div>
  );
}

/** Страница одного раздела настроек (`/settings/:section`). */
export function SettingsSectionScreen() {
  const { section } = useParams();
  if (section === "account") return <ProfileEditScreen />;
  return (
    <div className="screen-scroll set-page">
      {section === "language" && <LanguageSettings />}
      {section === "appearance" && <AppearanceSettings />}
      {section === "display" && <DisplaySettings />}
      {(section === "cards" || section === "grid") && <CardsSettings />}
      {section === "updates" && <UpdatesSettings />}
      {section === "server" && <ServerSettings />}
      {section === "storage" && (
        <>
          <SavePathRow />
          <StorageManager />
        </>
      )}
    </div>
  );
}

function AppearanceSettings() {
  const { t } = useI18n();
  const [hue, setHue] = useState(() => Math.round(getBaseHue()));
  const [infinite, setInfinite] = usePersistedBool(KEYS.infiniteScroll, false);
  const [resetTags, setResetTags] = usePersistedBool(KEYS.resetTagsOnBookTagNav, false);

  const onHue = (deg: number) => {
    setHue(deg);
    setBaseHue(deg);
    saveHue(deg);
    applyTheme(themeColors());
  };

  const selected = Math.round(hue / 10) * 10;
  // Размер образца как в HuePaletteSelector: от ширины окна, 28…36px; перенос — по ширине карточки
  const hueItemSize = Math.max(28, Math.min(36, (window.innerWidth - 16 * 2 - 16 * 2 - 8 * 9) / 10));

  return (
    <>
      <ListGroup title={t("settings.appearance.theme")}>
        <div className="hue-palette set-pad">
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
      </ListGroup>
      <ListGroup>
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
      </ListGroup>
    </>
  );
}

function DisplaySettings() {
  const { t } = useI18n();
  const [fullscreen, setFullscreen] = usePersistedBool(KEYS.fullscreen, false);
  return (
    <ListGroup>
      <SwitchRow
        title={t("settings.display.fullscreen")}
        description={t("settings.display.fullscreenDesc")}
        value={fullscreen}
        onChange={(v) => {
          setFullscreen(v);
          applyFullscreen(v);
        }}
      />
      <div className="settings-note set-pad">{t("settings.display.androidNote")}</div>
    </ListGroup>
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
    <ListGroup title={t("settings.storage.savePath")} padded>
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
    </ListGroup>
  );
}

/** Английское название языка под родным (как в Telegram); без Intl — пусто. */
function englishName(code: string): string {
  try {
    return new Intl.DisplayNames(["en"], { type: "language", fallback: "none" }).of(code) ?? "";
  } catch {
    return "";
  }
}

/** Страница языка (вместо окна LanguageSelector старого): список с радиокнопками, выбор применяется сразу. */
function LanguageSettings() {
  const { t, available, locale, setLocale } = useI18n();
  const titles = useLangPref("titles");
  const tags = useLangPref("tags");
  return (
    <>
      <ListGroup title={t("settings.languagePage.title")}>
        {available.map((opt) => {
          const on = opt.code === locale;
          const en = englishName(opt.code);
          return (
            <RadioRow
              key={opt.code}
              title={opt.label}
              sub={en && en !== opt.label ? en : undefined}
              checked={on}
              onSelect={() => setLocale(opt.code as AppLocale)}
            />
          );
        })}
      </ListGroup>
      <ListHint>{t("settings.languagePage.note")}</ListHint>
      <ListGroup title={t("settings.languagePage.content")}>
        <SwitchRow
          title={t("settings.languagePage.titles")}
          description={t("settings.languagePage.titlesSub")}
          value={titles}
          onChange={(v) => setLangPref("titles", v)}
        />
        <SwitchRow
          title={t("settings.languagePage.tags")}
          description={t("settings.languagePage.tagsSub")}
          value={tags}
          onChange={(v) => setLangPref("tags", v)}
        />
      </ListGroup>
    </>
  );
}

/**
 * Карточки книг (как «Оформление» в Telegram): сверху живой предпросмотр, ниже выбор вида — четыре схемы
 * в ряд, что показывать на карточке и — для плиток и классики — сетка: колонки, ширина, поля, промежуток
 * кнопками «− +». Любое изменение сразу видно в предпросмотре и в ленте.
 */
function CardsSettings() {
  const { t } = useI18n();
  const { view, show } = useCardView();
  const [preview, setPreview] = useState<Book[]>([]);
  const [previewFailed, setPreviewFailed] = useState(false);
  const [retry, setRetry] = useState(0);

  useEffect(() => {
    let alive = true;
    setPreviewFailed(false);
    void (async () => {
      try {
        await initCdn();
        const res = await listGalleries(1, "popular", "");
        if (alive) setPreview(res.result.map(galleryCardToBook));
      } catch {
        // Предпросмотр необязателен — но не крутим спиннер бесконечно
        if (alive) setPreviewFailed(true);
      }
    })();
    return () => {
      alive = false;
    };
  }, [retry]);

  const rows = view === "list" || view === "compact";
  const sample = preview.slice(0, view === "list" ? 2 : view === "compact" ? 3 : 12);

  return (
    <>
      <ListGroup>
        <div className={`cv-preview is-${view}`}>
          {sample.length ? (
            <BookCollection books={sample} onPress={() => {}} enrich={false} />
          ) : (
            <div className="cv-preview-empty">
              {previewFailed ? (
                <button type="button" className="ax-btn ax-btn-ghost" onClick={() => setRetry((n) => n + 1)}>
                  <Icon name="refresh-cw" size={18} />
                  {t("common.retry")}
                </button>
              ) : (
                <Spinner size={22} />
              )}
            </div>
          )}
        </div>
      </ListGroup>

      <ListGroup title={t("settings.cards.viewTitle")}>
        <div className="cv-options" role="radiogroup">
          {CARD_VIEWS.map((v) => (
            <button
              key={v}
              type="button"
              role="radio"
              aria-checked={v === view}
              className={v === view ? "cv-option is-on" : "cv-option"}
              onClick={() => setCardView({ view: v })}
            >
              <ViewSketch kind={v} />
              <span className="cv-option-title">{t(`settings.cards.view.${v}`)}</span>
            </button>
          ))}
        </div>
      </ListGroup>
      <ListHint>{t(`settings.cards.viewSub.${view}`)}</ListHint>

      {view !== "classic" && (
        <ListGroup title={t("settings.cards.show")}>
          {view === "list" && (
            <SwitchRow title={t("settings.cards.showTags")} value={show.tags} onChange={(v) => setCardView({ show: { tags: v } })} />
          )}
          <SwitchRow title={t("settings.cards.showMeta")} value={show.meta} onChange={(v) => setCardView({ show: { meta: v } })} />
          <SwitchRow title={t("settings.cards.showDate")} value={show.date} onChange={(v) => setCardView({ show: { date: v } })} />
          <SwitchRow
            title={t("settings.cards.showNew")}
            description={t("settings.cards.showNewSub")}
            value={show.newBadge}
            onChange={(v) => setCardView({ show: { newBadge: v } })}
          />
        </ListGroup>
      )}

      {!rows && <GridSection />}
    </>
  );
}

/** Схема вида карточек для выбора: серые полоски-«строки» и «обложки». */
function ViewSketch({ kind }: { kind: CardViewKind }) {
  const n = kind === "compact" ? 4 : kind === "list" ? 2 : 0;
  return (
    <span className={`cv-sketch is-${kind}`} aria-hidden>
      {n > 0
        ? Array.from({ length: n }, (_, i) => (
            <span key={i} className="cv-sk-row">
              <span className="cv-sk-cover" />
              <span className="cv-sk-lines">
                <span />
                <span />
                {kind === "list" && <span />}
              </span>
            </span>
          ))
        : Array.from({ length: kind === "grid" ? 6 : 4 }, (_, i) => (
            <span key={i} className="cv-sk-tile">
              <span className="cv-sk-cover" />
              <span className="cv-sk-line" />
              {kind === "classic" && <span className="cv-sk-chips" />}
            </span>
          ))}
    </span>
  );
}

/**
 * Сетка для плиток и классики — настройки текущего экрана, определяется сам. Ключ `grid_config_map_v2`.
 * ПК: размер карточки, колонки считаются по ширине окна. Телефон и планшет (× портрет/ландшафт,
 * меняется при повороте): число колонок и минимальная ширина карточки, как в 1.3.1.
 */
function GridSection() {
  const { t } = useI18n();
  const [screen, setScreen] = useState(() => ({ w: window.innerWidth, h: window.innerHeight }));
  const [map, setMap] = useState(loadGridConfig);

  useEffect(() => {
    const on = () => setScreen({ w: window.innerWidth, h: window.innerHeight });
    window.addEventListener("resize", on);
    return () => window.removeEventListener("resize", on);
  }, []);

  const profile = gridProfileFor(screen.w, screen.h);
  const cfg = map[profile];
  const save = (next: Record<GridProfile, GridConfig>) => {
    setMap(next);
    saveGridConfig(next);
  };
  const update = (patch: Partial<GridConfig>) => save({ ...map, [profile]: { ...cfg, ...patch } });

  const pad = cfg.paddingHorizontal ?? 0;
  const gap = cfg.columnGap ?? 0;
  const minW = cfg.minColumnWidth ?? 80;
  const colsMax = Math.min(12, Math.max(1, Math.floor((screen.w - pad * 2 + gap) / (minW + gap))));
  const px = (v: number) => t("settings.cards.px", { n: v });
  const changed = JSON.stringify(cfg) !== JSON.stringify(DEFAULT_GRID[profile]);
  const desktop = profile === "desktop";

  return (
    <>
      <ListGroup title={t("settings.cards.grid")}>
        {desktop ? (
          <StepperRow
            title={t("settings.cards.cardSize")}
            sub={t("settings.cards.cardSizeSub", { n: gridLayout(screen.w, cfg).cols })}
            value={cfg.cardWidth ?? 230}
            min={140}
            max={420}
            step={10}
            format={px}
            onChange={(v) => update({ cardWidth: v })}
          />
        ) : (
          <>
            <StepperRow
              title={t("settings.cards.cols")}
              sub={t("settings.cards.colsSub", { max: colsMax })}
              value={Math.min(cfg.numColumns, colsMax)}
              min={1}
              max={colsMax}
              onChange={(v) => update({ numColumns: v })}
            />
            <StepperRow
              title={t("settings.cards.minWidth")}
              sub={t("settings.cards.minWidthSub")}
              value={minW}
              min={80}
              max={240}
              step={10}
              format={px}
              onChange={(v) => update({ minColumnWidth: v })}
            />
          </>
        )}
        <StepperRow title={t("settings.cards.pad")} value={pad} min={0} max={48} step={2} format={px} onChange={(v) => update({ paddingHorizontal: v })} />
        <StepperRow title={t("settings.cards.gap")} value={gap} min={0} max={32} format={px} onChange={(v) => update({ columnGap: v })} />
        {changed && (
          <button type="button" className="set-row set-row-action" onClick={() => update(DEFAULT_GRID[profile])}>
            <Icon name="rotate-ccw" size={20} />
            <span className="set-row-title">{t("settings.cards.reset")}</span>
          </button>
        )}
      </ListGroup>
      <ListHint>{desktop ? t("settings.cards.gridHintDesktop") : t("settings.cards.gridHint", { screen: t(`settings.grid.${profile}`) })}</ListHint>
    </>
  );
}
