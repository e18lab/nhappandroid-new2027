/**
 * Заголовок окна ПК-версии (в стиле нашего кита, раскладка как у Steam / браузера): окно без системной рамки.
 * Стоит вне роутеров вкладок: всё, что зависит от страницы, берёт роутер выбранной вкладки (`useActiveRouter`).
 * Три строки:
 *  1) вкладки браузера (`browser/TabStrip.tsx`) и «+» — выбор ресурса для новой вкладки;
 *     справа обновление, облако и кнопки окна (свернуть, развернуть, закрыть);
 *  2) крупные вкладки главной (Новое, Сообщество, Рекомендации, библиотека…), справа — профиль (аватар и ник) и настройки;
 *  3) «назад / вперёд / перезагрузить вкладку», адрес текущей страницы на сайте и справа поле поиска (Ctrl+K)
 *     с кнопками тегов, фильтров и «случайной книги».
 * Заголовок — область перетаскивания окна. Боковой панели нет. Содержимое лежит в скруглённой панели под заголовком.
 */
import { useEffect, useMemo, useRef, useState, useSyncExternalStore, type ReactNode } from "react";
import { getRandomGalleryId } from "../api/galleries";
import logo from "../assets/logo.png";
import { BrowserTabStrip } from "../browser/TabStrip";
import { getActiveTabId, reloadTab, splitPath, useActiveRouter, useActiveTabId, useTabs } from "../browser/tabs";
import { useI18n } from "../i18n/I18nContext";
import { useBrowseFilters } from "../lib/browseFilters";
import { webUrl } from "../lib/siteUrl";
import { inTauri } from "../lib/downloads";
import { useMe } from "../lib/session";
import { getItem, setItem, subscribe } from "../lib/storage";
import { useCommunityMenu } from "../screens/CommunityScreen";
import { HOME_TAB_KEY, homeTabs, useDeskPager, type HomePagerState } from "../screens/homeTabs";
import { Icon, PageTabs } from "../ui";
import { FilterButton } from "./AppHeader";
import { useCloudState } from "../lib/cloudSync";
import { NhAvatar } from "./TabAccount";
import { setDeskBarTarget } from "./PageBar";
import { useDeskPanel } from "./deskPanel";
import { DeskSearch } from "./DeskSearch";
import { openLogin } from "./LoginModal";
import { ownProfileRoute } from "../lib/session";
import { openMlLogin } from "./MlLoginModal";
import { useMl } from "../lib/mlid";
import { UpdateButton } from "./UpdateButton";
import { isWindowRoute, WIDE_QUERY } from "./windowRoutes";


export function DesktopTitleBar() {
  const { t } = useI18n();
  const { navigate, location } = useActiveRouter();
  const { pathname } = location;
  const random = useRandomBook();
  // Профиль справа — аккаунт MoeLibre ID (аккаунт nhentai привязывается к нему)
  const { account: ml } = useMl();
  const cloud = useCloudState();
  // Панель лежит поверх экрана; прокрутили страницу вниз — сворачивается (`deskPanel.ts`)
  const stripRef = useRef<HTMLDivElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const activeId = useActiveTabId();
  const homeTab = useSyncExternalStore((cb) => subscribe((key) => key === HOME_TAB_KEY && cb()), () => getItem(HOME_TAB_KEY) ?? "latest");
  const compact = useDeskPanel(panelRef, stripRef, `${activeId}|${pathname}${location.search}|${homeTab}`);

  return (
    <header className={compact ? "dk-titlebar is-compact" : "dk-titlebar"} data-tauri-drag-region>
      {/* 1. Вкладки браузера — свои кнопки и кнопки окна */}
      <div ref={stripRef} className="dk-row dk-row-top" data-tauri-drag-region>
        <BrowserTabStrip />
        <div className="dk-drag" data-tauri-drag-region />
        <div className="dk-actions">
          <UpdateButton />
          {/* Аккаунт MoeLibre — в самом верху, у кнопок окна; облако — в его профиле */}
          <button
            type="button"
            className={pathname.startsWith("/mlid") ? "dk-mlacc is-active" : "dk-mlacc"}
            title={ml ? t("mlid.account") : t("mlid.title")}
            onClick={() => (ml ? navigate("/mlid") : openMlLogin())}
          >
            <span className="dk-mlacc-ava">
              <span className="dk-xtab-avatar">
                {ml?.avatar_url ? <img src={ml.avatar_url} alt="" referrerPolicy="no-referrer" /> : ml ? <b>{(ml.display_name || "M").charAt(0).toUpperCase()}</b> : <Icon name="user" size={14} />}
              </span>
              {/* Точка облака: зелёная — на связи, жёлтая — подключается */}
              {ml && cloud.enabled && <i className={`dk-mlacc-dot is-${cloud.status}`} aria-hidden />}
            </span>
            <span>{ml ? ml.display_name || "MoeLibre" : t("mlid.signIn")}</span>
          </button>
          {/* Настройки приложения — рядом с аккаунтом MoeLibre */}
          <button
            type="button"
            className={pathname.startsWith("/settings") ? "dk-btn dk-settings-btn is-active" : "dk-btn dk-settings-btn"}
            title={t("menu.settings")}
            aria-label={t("menu.settings")}
            onClick={() => navigate("/settings")}
          >
            <Icon name="settings" size={17} />
          </button>
        </div>
        {inTauri() && <WindowControls />}
      </div>
      {/* Панель выбранной вкладки: разделы и адрес — одного цвета с выбранной вкладкой, «вырастают» из неё */}
      <div ref={panelRef} className="dk-panel">
      {/* 2. Крупные вкладки на всю строку */}
      <div className="dk-row dk-row-nav" data-tauri-drag-region>
        <DeskTabs />
        <div className="dk-drag" data-tauri-drag-region />
      </div>
      {/* 3. Назад / вперёд / обновить — адрес страницы — поиск с тегами, фильтрами и «случайной книгой» */}
      <AddressBar>
        <div className="dk-searchbox">
          <DeskSearch />
          <button type="button" className="dk-filter" aria-label={t("menu.tags")} title={t("menu.tags")} onClick={() => navigate("/tags")}>
            <Icon name="tag" size={14} />
          </button>
          <FilterButton className="dk-filter" size={15} />
          <button type="button" className="dk-filter" aria-label={t("settings.hub.randomSub")} title={t("settings.hub.randomSub")} onClick={() => void random()}>
            <Icon name="shuffle" size={14} />
          </button>
        </div>
      </AddressBar>
      {/* 4. Панель открытой страницы (`PageBar.tsx`): «назад + заголовок» внутреннего экрана, сортировка
       *    и счётчик разделов библиотеки, действия книги. Пустая — не видна */}
      <div className="dk-row dk-row-page" ref={setDeskBarTarget} />
      </div>
    </header>
  );
}

/**
 * Адрес экрана, который сейчас открыт. Окно поверх экрана (настройки, профиль, теги) адрес не меняет —
 * пока оно открыто, возвращается адрес экрана под ним.
 */
function usePageLocation(): { pathname: string; search: string } {
  const { location } = useActiveRouter();
  const tabs = useTabs();
  const activeId = useActiveTabId();
  if (!isWindowRoute(location.pathname) || !window.matchMedia(WIDE_QUERY).matches) return location;
  // Окна поверх экрана адрес вкладки не меняют — там адрес экрана под окном
  return splitPath(tabs.find((t) => t.id === activeId)?.path ?? "/");
}


/**
 * Адресная строка, как у Steam: обновить, замок и адрес страницы на сайте. Нажатие по адресу копирует его,
 * стрелка справа открывает страницу в браузере. Для экранов, которых на сайте нет, — адрес внутри приложения.
 */
function AddressBar({ children }: { children?: ReactNode }) {
  const { t } = useI18n();
  const { navigate } = useActiveRouter();
  const { pathname, search } = usePageLocation();
  const homeTab = useSyncExternalStore((cb) => subscribe((key) => key === HOME_TAB_KEY && cb()), () => getItem(HOME_TAB_KEY) ?? "latest");
  // Фильтры (теги, страницы, дата, сортировка) меняют адрес поиска — перерисовка при их смене
  useBrowseFilters();
  const url = webUrl(pathname, search, homeTab);
  const local = `nhapp:/${pathname === "/" ? `/${homeTab}` : pathname}`;
  const [copied, setCopied] = useState(false);

  useEffect(() => setCopied(false), [url]);

  const copy = () => {
    if (!url) return;
    void navigator.clipboard?.writeText(url).then(() => {
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1500);
    });
  };

  return (
    <div className="dk-row dk-row-addr" data-tauri-drag-region>
      <div className="dk-histnav">
        <button type="button" className="dk-btn dk-btn-sm" aria-label={t("common.back")} onClick={() => navigate(-1)}>
          <Icon name="arrow-left" size={16} />
        </button>
        <button type="button" className="dk-btn dk-btn-sm" aria-label={t("common.nextPage")} onClick={() => navigate(1)}>
          <Icon name="arrow-right" size={16} />
        </button>
        <button type="button" className="dk-btn dk-btn-sm" aria-label={t("common.retry")} onClick={() => reloadTab(getActiveTabId())}>
          <Icon name="refresh-cw" size={14} />
        </button>
      </div>
      <div className={url ? "dk-url" : "dk-url is-local"}>
        <button type="button" className="dk-url-text" onClick={copy} disabled={!url} title={url ? `${url} — Copy` : undefined}>
          {url ? <Icon name={copied ? "check" : "lock"} size={12} /> : <img className="dk-url-logo" src={logo} alt="" />}
          <span>{url ?? local}</span>
        </button>
        {url && (
          <button type="button" className="dk-url-open" aria-label="Open in browser" title="Open in browser" onClick={() => window.open(url, "_blank", "noopener")}>
            <Icon name="arrow-up-right" size={14} />
          </button>
        )}
      </div>
      {children}
    </div>
  );
}

/** Неподвижная «лента» для полосы вкладок, когда главная не открыта: нажатие ведёт на главную. */
const IDLE_POSITION = { current: 0 };
const idleSubscribe = () => () => {};

/**
 * Вкладки главной в заголовке окна, как разделы в Steam. На главной управляют её лентой;
 * на других экранах ни одна не выбрана, а нажатие открывает главную на этой вкладке.
 */
function DeskTabs() {
  const { t } = useI18n();
  const { navigate } = useActiveRouter();
  const { pathname, search } = usePageLocation();
  const me = useMe();
  const live = useDeskPager();
  const communityMenu = useCommunityMenu();
  const list = homeTabs(!!me, true);
  const onHome = pathname === "/" && !new URLSearchParams(search).get("query")?.trim();
  const active = onHome && live ? live : null;

  const idle = useMemo(
    () =>
      ({
        index: -1,
        position: IDLE_POSITION,
        subscribe: idleSubscribe,
        goTo: (i: number) => {
          const tab = list[i];
          if (!tab) return;
          setItem(HOME_TAB_KEY, tab.key);
          if (!onHome) navigate("/");
        },
      }) as unknown as HomePagerState,
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [list.map((x) => x.key).join(), onHome, navigate],
  );

  return (
    <nav className="dk-tabs">
      <PageTabs
        pager={active ?? idle}
        inactive={!active}
        tabs={list.map((x) => ({ key: x.key, label: t(x.labelKey), menu: x.key === "community" ? communityMenu : undefined }))}
      />
      {/* Профиль аккаунта nhentai этой вкладки (без входа — окно входа) */}
      <button
        type="button"
        className={me && pathname === ownProfileRoute(me) ? "dk-profile-tab is-active" : "dk-profile-tab"}
        onClick={() => (me ? navigate(ownProfileRoute(me)) : openLogin())}
      >
        <NhAvatar src={me?.avatar_url} name={me?.username} size={20} />
        <span>{t("nav.profile")}</span>
      </button>
    </nav>
  );
}

/** Свернуть / развернуть (восстановить) / закрыть — окно Tauri без системной рамки. */
function WindowControls() {
  const [maximized, setMaximized] = useState(false);

  useEffect(() => {
    let off: (() => void) | undefined;
    let alive = true;
    void (async () => {
      const { getCurrentWindow } = await import("@tauri-apps/api/window");
      const win = getCurrentWindow();
      const sync = async () => alive && setMaximized(await win.isMaximized());
      await sync();
      const un = await win.onResized(() => void sync());
      if (alive) off = un;
      else un();
    })();
    return () => {
      alive = false;
      off?.();
    };
  }, []);

  // Команда приложения (src-tauri/src/window_controls.rs) — работает без разрешений core:window:*
  const call = async (action: "minimize" | "toggleMaximize" | "close") => {
    const { invoke } = await import("@tauri-apps/api/core");
    await invoke("window_control", { action }).catch((e) => console.error("window_control", action, e));
  };

  return (
    <div className="dk-window">
      <button type="button" aria-label="Minimize" onClick={() => void call("minimize")}>
        <Icon name="minus" size={18} />
      </button>
      <button type="button" aria-label="Maximize" onClick={() => void call("toggleMaximize")}>
        <Icon name={maximized ? "copy" : "square"} size={14} />
      </button>
      <button type="button" className="is-close" aria-label="Close" onClick={() => void call("close")}>
        <Icon name="x" size={18} />
      </button>
    </div>
  );
}

/** Случайная книга: открыть, не давая нажать повторно, пока идёт запрос. */
function useRandomBook() {
  const { navigate } = useActiveRouter();
  const [rolling, setRolling] = useState(false);
  return async () => {
    if (rolling) return;
    setRolling(true);
    try {
      navigate(`/book/${await getRandomGalleryId()}?random=1`);
    } catch {
      /* сеть недоступна */
    } finally {
      setRolling(false);
    }
  };
}
