/**
 * Каркас ПК-версии (как AnixApp на ПК, в стиле нашего кита): окно без системной рамки.
 * Сверху заголовок окна — логотип и версия, «назад / вперёд / обновить», у поиска (Ctrl+K) слева «главная»,
 * внутри справа теги и фильтры, за ним «случайная книга»;
 * справа облако, аватар, настройки и кнопки окна (свернуть, развернуть, закрыть). Заголовок — область
 * перетаскивания окна. Боковой панели нет — разделы (персонажи, закладки, история…) вкладками главной.
 * Содержимое лежит в скруглённой панели под заголовком.
 */
import { useEffect, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { version } from "../../package.json";
import { getRandomGalleryId } from "../api/galleries";
import logo from "../assets/logo.png";
import { avatarUrl } from "../components/CommentCard";
import { useI18n } from "../i18n/I18nContext";
import { inTauri } from "../lib/downloads";
import { ownProfileRoute, useMe } from "../lib/session";
import { Icon } from "../ui";
import { FilterButton } from "./AppHeader";
import { CloudButton } from "./CloudButton";
import { UpdateButton } from "./UpdateButton";


export function DesktopTitleBar() {
  const { t } = useI18n();
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const random = useRandomBook();
  const me = useMe();
  const own = ownProfileRoute(me);
  const avatar = me?.avatar_url ? avatarUrl(me.avatar_url) : "";

  // Ctrl+K (⌘K) — поиск
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        navigate("/search");
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [navigate]);

  return (
    <header className="dk-titlebar" data-tauri-drag-region>
      <div className="dk-brand" data-tauri-drag-region>
        <img src={logo} alt="" />
        <b data-tauri-drag-region>NHApp</b>
        <span data-tauri-drag-region>v{version}</span>
      </div>
      <div className="dk-histnav">
        <button type="button" className="dk-btn" aria-label={t("common.back")} onClick={() => navigate(-1)}>
          <Icon name="arrow-left" size={18} />
        </button>
        <button type="button" className="dk-btn" aria-label={t("common.nextPage")} onClick={() => navigate(1)}>
          <Icon name="arrow-right" size={18} />
        </button>
        <button type="button" className="dk-btn" aria-label={t("common.retry")} onClick={() => window.location.reload()}>
          <Icon name="refresh-cw" size={17} />
        </button>
      </div>
      <div className="dk-drag" data-tauri-drag-region />
      <button type="button" className="dk-btn dk-round" aria-label={t("nav.home")} onClick={() => pathname !== "/" && navigate("/")}>
        <Icon name="home" size={18} />
      </button>
      <div className="dk-searchbox">
        <button type="button" className="dk-search" onClick={() => navigate("/search")}>
          <Icon name="search" size={17} />
          <span>{t("desk.search")}</span>
          <kbd>Ctrl+K</kbd>
        </button>
        <button type="button" className="dk-filter" aria-label={t("menu.tags")} onClick={() => navigate("/tags")}>
          <Icon name="tag" size={16} />
        </button>
        <FilterButton className="dk-filter" size={17} />
      </div>
      <button type="button" className="dk-btn dk-round" aria-label={t("settings.hub.randomSub")} onClick={() => void random()}>
        <Icon name="shuffle" size={18} />
      </button>
      <div className="dk-drag" data-tauri-drag-region />
      <div className="dk-actions">
        <UpdateButton />
        {me && <CloudButton />}
        <button type="button" className="dk-avatar" aria-label={t("nav.profile")} onClick={() => navigate(own || "/me")}>
          {avatar ? <img src={avatar} alt="" /> : <Icon name="user" size={18} />}
        </button>
        <button type="button" className="dk-btn" aria-label={t("menu.settings")} onClick={() => navigate("/settings")}>
          <Icon name="settings" size={19} />
        </button>
      </div>
      {inTauri() && <WindowControls />}
    </header>
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
  const navigate = useNavigate();
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
