/**
 * Каркас приложения — редизайн в духе Anixart.
 * Главные разделы (Главная, Персонажи, Настройки, свой профиль или экран гостя) — статичная шапка
 * с логотипом и поиском (`AppHeader`): она всегда сверху, не уезжает и не листается вместе с экраном.
 * Внутренние экраны — прежняя `TopBar` со стрелкой «назад», она едет вместе со своим экраном.
 * Внизу плавающая панель разделов (`BottomNav`); на книге, в читалке и в поиске её нет.
 * Сверху — полоса под статус-бар цвета шапки; под шапкой — полоса загрузки.
 *
 * Переходы — как в Anixart (анимации screen_open/close/tab из APK): экран — «слой»; при переходе старый
 * слой ещё живёт ~200 мс под своим адресом (подменённый LocationContext) и уезжает, новый въезжает.
 * Вперёд/назад — сдвиг на 7% с проявлением, между разделами нижней панели — на всю ширину.
 * Если поменялись только параметры адреса (фильтры, ?query на том же экране), слой не пересоздаётся.
 */
import { useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { UNSAFE_LocationContext, useLocation, useNavigate, useNavigationType, type Location, type NavigationType } from "react-router-dom";
import { useI18n } from "../i18n/I18nContext";
import { ownProfileRoute, useMe } from "../lib/session";
import { AppHeader } from "./AppHeader";
import { useAndroidBack } from "./androidBack";
import { BottomNav, navIndex } from "./BottomNav";
import { DownloadBanner, DownloadNotifier } from "./DownloadBanner";
import { TopBar } from "./TopBar";

/** Разделы с шапкой-логотипом и их заголовки (у главной заголовка нет). */
const ROOTS: Record<string, string | null> = { "/": null, "/characters": "nav.characters", "/settings": "menu.settings", "/me": "nav.profile" };

/** Сколько живёт уходящий слой: самая длинная анимация (180 мс) с запасом. */
const EXIT_MS = 200;

/** Где нижняя панель мешала бы: книга, читалка, поиск, комментарии, правка профиля. */
function showNav(pathname: string): boolean {
  if (/^\/(book|read|search)(\/|$)/.test(pathname)) return false;
  if (/^\/profile\/[^/]+\/[^/]+\/edit/.test(pathname)) return false;
  return true;
}

/** Заголовок раздела, если адрес — главный раздел (свой профиль тоже), иначе `undefined`. */
function rootTitle(loc: Location, own: string): string | null | undefined {
  // Результаты поиска (/?query=) открываются как внутренний экран со стрелкой «назад»
  if (new URLSearchParams(loc.search).get("query")) return undefined;
  if (own && loc.pathname === own) return "nav.profile";
  return loc.pathname in ROOTS ? ROOTS[loc.pathname] : undefined;
}

type Motion = "open" | "close" | "tab-right" | "tab-left";

/** Какой переход между двумя адресами: между разделами панели — сдвиг вбок, иначе вперёд/назад. */
function motionFor(from: Location, to: Location, type: NavigationType, own: string): Motion {
  if (rootTitle(from, own) !== undefined && rootTitle(to, own) !== undefined) {
    const a = navIndex(from.pathname, own);
    const b = navIndex(to.pathname, own);
    if (a >= 0 && b >= 0 && a !== b) return b > a ? "tab-right" : "tab-left";
  }
  return type === "POP" ? "close" : "open";
}

interface Layer {
  id: number;
  location: Location;
  className: string;
}

export function Shell({ children }: { children: ReactNode }) {
  const { t } = useI18n();
  const navigate = useNavigate();
  const location = useLocation();
  const navType = useNavigationType();
  const own = ownProfileRoute(useMe());
  const nextId = useRef(1);
  const [layers, setLayers] = useState<Layer[]>(() => [{ id: 0, location, className: "" }]);
  const reader = location.pathname.startsWith("/read/");
  const nav = showNav(location.pathname);
  const title = rootTitle(location, own);

  useAndroidBack(() => false);

  const top = layers[layers.length - 1];
  useLayoutEffect(() => {
    if (top.location.key === location.key) return;
    // Тот же экран, другие параметры (или читалка, у неё свой каркас) — без анимации, слой тот же
    if (top.location.pathname === location.pathname || reader || top.location.pathname.startsWith("/read/")) {
      setLayers([{ ...top, location, className: "" }]);
      return;
    }
    const motion = motionFor(top.location, location, navType, own);
    const id = nextId.current++;
    setLayers([
      { ...top, className: `is-exit ${motion}-exit` },
      { id, location, className: `is-enter ${motion}-enter` },
    ]);
    const timer = window.setTimeout(() => setLayers([{ id, location, className: "" }]), EXIT_MS);
    return () => window.clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [location, navType, reader]);

  if (reader)
    return (
      <div className="app app-reader">
        <DownloadNotifier />
        {children}
      </div>
    );

  return (
    <div className={nav ? "app ax-app has-nav" : "app ax-app"}>
      <div className="main">
        <div className="top-chrome" />
        {title !== undefined && <AppHeader title={title ? t(title) : undefined} />}
        <DownloadBanner />
        <DownloadNotifier />
        <div className="ax-stack">
          {layers.map((layer) => (
            <UNSAFE_LocationContext.Provider key={layer.id} value={{ location: layer.location, navigationType: navType }}>
              <ScreenLayer className={layer.className} withTopBar={rootTitle(layer.location, own) === undefined} onOpenMenu={() => navigate("/me")}>
                {children}
              </ScreenLayer>
            </UNSAFE_LocationContext.Provider>
          ))}
        </div>
        {nav && <BottomNav />}
      </div>
    </div>
  );
}

/** Один экран (с `TopBar`, если он внутренний); адрес берёт из своего LocationContext. */
function ScreenLayer({
  className,
  withTopBar,
  onOpenMenu,
  children,
}: {
  className: string;
  withTopBar: boolean;
  onOpenMenu: () => void;
  children: ReactNode;
}) {
  const { pathname } = useLocation();
  return (
    <div className={className ? `ax-layer ${className}` : "ax-layer"} aria-hidden={className.includes("is-exit") || undefined}>
      {withTopBar && !pathname.startsWith("/search") && <TopBar onOpenMenu={onOpenMenu} />}
      <div className="content">{children}</div>
    </div>
  );
}
