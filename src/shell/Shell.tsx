/**
 * Каркас приложения — редизайн в духе Anixart.
 * Главные разделы (Главная, Персонажи, свой профиль или экран гостя) — шапка с логотипом и поиском
 * (`AppHeader`): не уезжает при прокрутке и не листается при переключении разделов. В настройках шапки нет.
 * Внутренние экраны — прежняя `TopBar` со стрелкой «назад».
 * Внизу плавающая панель разделов (`BottomNav`); на книге, в читалке и в поиске её нет.
 * Сверху — полоса под статус-бар цвета шапки; под шапкой — полоса загрузки.
 *
 * Переходы — как в Telegram: экран со своей шапкой — «слой». Вперёд — новый экран выезжает справа
 * и накрывает текущий, а тот чуть сдвигается влево и темнеет; назад — верхний уезжает вправо и открывает
 * предыдущий. Между разделами нижней панели содержимое листается вбок на всю ширину (screen_tab из APK
 * Anixart), а шапка стоит на месте.
 * Уходящий слой живёт до конца анимации под своим адресом (подменённый LocationContext).
 * Внутренний экран можно смахнуть вправо пальцем (`useSwipeBack`): под ним монтируется предыдущий экран
 * из запомненной истории адресов, после свайпа он становится текущим без повторной анимации.
 * Если поменялись только параметры адреса (фильтры, ?query на том же экране), слой не пересоздаётся.
 *
 * Планшет и ПК (ширина от 720px): настройки, профиль и аккаунт открываются окном поверх текущего экрана,
 * как настройки Telegram на планшете, — иначе их содержимое растягивается на всю ширину. Экран под окном
 * («основа») остаётся смонтированным и не меняется; переходы между страницами окна идут внутри него.
 * Закрывается окно стрелкой/крестиком, нажатием по затемнению или «Назад».
 */
import { useEffect, useLayoutEffect, useRef, useState, type ReactNode, type RefObject } from "react";
import { UNSAFE_LocationContext, useLocation, useNavigate, useNavigationType, type Location, type NavigationType } from "react-router-dom";
import { useI18n } from "../i18n/I18nContext";
import { ownProfileRoute, useMe } from "../lib/session";
import { AppHeader } from "./AppHeader";
import { Icon, OverlayScrollbar } from "../ui";
import { useAndroidBack } from "./androidBack";
import { BottomNav, navIndex } from "./BottomNav";
import { DownloadBanner, DownloadNotifier } from "./DownloadBanner";
import { useSwipeBack } from "./swipeBack";
import { TopBar } from "./TopBar";

/** Главные разделы и заголовки их шапки (у главной заголовка нет, у настроек нет самой шапки). */
const ROOTS: Record<string, string | null> = { "/": null, "/characters": "nav.characters", "/settings": "menu.settings", "/me": "nav.profile" };

/** Сколько живёт уходящий слой: самая длинная анимация (300 мс) с запасом. */
const EXIT_MS = 320;

/** Где нижняя панель мешала бы: книга, читалка, поиск, комментарии, правка профиля по старому адресу. */
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

/** С какой ширины окна страницы-«окна» открываются поверх экрана, а не на весь экран. */
const WIDE_QUERY = "(min-width: 720px)";

function useWide(): boolean {
  const [wide, setWide] = useState(() => window.matchMedia(WIDE_QUERY).matches);
  useEffect(() => {
    const mq = window.matchMedia(WIDE_QUERY);
    const on = () => setWide(mq.matches);
    mq.addEventListener("change", on);
    return () => mq.removeEventListener("change", on);
  }, []);
  return wide;
}

/** Страницы, которые на широком экране открываются окном: настройки, профили, экран гостя. */
function isWindowRoute(pathname: string): boolean {
  return /^\/(settings|profile|me)(\/|$)/.test(pathname);
}

type Motion = "open" | "close" | "tab-right" | "tab-left";

/**
 * Какой переход: между разделами панели — сдвиг вбок в сторону раздела; во внутренний экран — «открыть»;
 * назад или из внутреннего экрана в раздел (кнопкой панели) — «закрыть».
 */
function motionFor(from: Location, to: Location, type: NavigationType, own: string): Motion {
  const fromRoot = rootTitle(from, own) !== undefined;
  const toRoot = rootTitle(to, own) !== undefined;
  if (fromRoot && toRoot) {
    const a = navIndex(from.pathname, own);
    const b = navIndex(to.pathname, own);
    if (a !== b) return b > a ? "tab-right" : "tab-left";
  }
  if (type === "POP" || (toRoot && !fromRoot)) return "close";
  return "open";
}

interface Layer {
  id: number;
  location: Location;
  className: string;
}

export function Shell({ children }: { children: ReactNode }) {
  const navigate = useNavigate();
  const location = useLocation();
  const navType = useNavigationType();
  const own = ownProfileRoute(useMe());
  const nextId = useRef(1);
  const [layers, setLayers] = useState<Layer[]>(() => [{ id: 0, location, className: "" }]);
  const [under, setUnder] = useState<Layer | null>(null);
  // Экран под окном (широкий экран): тот же слой, что был до открытия окна
  const [base, setBase] = useState<Layer | null>(null);
  const wide = useWide();
  const inWindow = (loc: Location) => wide && isWindowRoute(loc.pathname);
  const history = useRef<Location[]>([location]);
  const stack = useRef<HTMLDivElement>(null);
  const reader = location.pathname.startsWith("/read/");
  const nav = showNav(location.pathname);

  useAndroidBack(() => false);

  // История адресов приложения — чтобы при свайпе показать, что под текущим экраном
  useLayoutEffect(() => {
    const h = history.current;
    if (h[h.length - 1]?.key === location.key) return;
    const at = h.findIndex((l) => l.key === location.key);
    if (navType === "POP" && at >= 0) h.length = at + 1;
    else if (navType === "REPLACE") h[h.length - 1] = location;
    else if (navType === "PUSH") h.push(location);
    else history.current = [location];
  }, [location, navType]);

  // Текущий слой — последний не уходящий (при закрытии окна уходящее окно стоит в конце)
  const top = [...layers].reverse().find((l) => !l.className.includes("is-exit")) ?? layers[layers.length - 1];
  const prev = history.current[history.current.length - 2];
  const canSwipe = layers.length === 1 && !!prev && rootTitle(top.location, own) === undefined && !inWindow(top.location);

  useSwipeBack({
    stack,
    enabled: canSwipe,
    onStart: () => prev && setUnder({ id: nextId.current++, location: prev, className: "is-under" }),
    onCommit: () => navigate(-1),
    onCancel: () => setUnder(null),
  });

  useLayoutEffect(() => {
    if (top.location.key === location.key) return;
    // Свайп «назад» уже показал предыдущий экран — он и становится текущим, без анимации
    if (under && under.location.key === location.key) {
      setLayers([{ ...under, className: "" }]);
      setUnder(null);
      return;
    }
    // Тот же экран, другие параметры (или читалка, у неё свой каркас) — без анимации, слой тот же
    if (top.location.pathname === location.pathname || reader || top.location.pathname.startsWith("/read/")) {
      setLayers([{ ...top, location, className: "" }]);
      return;
    }
    const id = nextId.current++;
    const fromWindow = inWindow(top.location);
    const toWindow = inWindow(location);
    // Открыть окно: текущий экран становится основой и не двигается, окно появляется поверх
    if (!fromWindow && toWindow) {
      setBase({ ...top, className: "" });
      setLayers([{ id, location, className: "" }]);
      return;
    }
    // Закрыть окно: назад к основе — она снова текущая; в другой раздел — новый экран сразу, окно гаснет
    if (fromWindow && !toWindow) {
      const next = base && base.location.key === location.key ? { ...base, location, className: "" } : { id, location, className: "" };
      setBase(null);
      setLayers([next, { ...top, className: "is-exit window-exit" }]);
      const timer = window.setTimeout(() => setLayers([next]), EXIT_MS);
      return () => window.clearTimeout(timer);
    }
    const motion = motionFor(top.location, location, navType, own);
    setLayers([
      { ...top, className: `is-exit ${motion}-exit` },
      { id, location, className: `is-enter ${motion}-enter` },
    ]);
    const timer = window.setTimeout(() => setLayers([{ id, location, className: "" }]), EXIT_MS);
    return () => window.clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [location, navType, reader]);

  // Закрыть окно: назад по истории до основы (она останется тем же экраном, с прокруткой), иначе на главную
  const closeWindow = () => {
    const h = history.current;
    const at = base ? h.findIndex((l) => l.key === base.location.key) : -1;
    if (at >= 0) navigate(at - (h.length - 1));
    else if (base) navigate(base.location.pathname + base.location.search);
    else navigate("/");
  };

  const renderLayer = (layer: Layer, className: string, windowed = false) => (
    <UNSAFE_LocationContext.Provider key={layer.id} value={{ location: layer.location, navigationType: navType }}>
      <ScreenLayer
        className={className}
        title={rootTitle(layer.location, own)}
        onOpenMenu={() => navigate("/me")}
        onClose={windowed ? closeWindow : undefined}
      >
        {children}
      </ScreenLayer>
    </UNSAFE_LocationContext.Provider>
  );
  const plain = layers.filter((l) => !inWindow(l.location));
  const windowLayers = layers.filter((l) => inWindow(l.location));
  const windowClosing = windowLayers.length > 0 && windowLayers.every((l) => l.className.includes("is-exit"));

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
        <DownloadBanner />
        <DownloadNotifier />
        <div ref={stack} className="ax-stack">
          {[...(wide && base ? [base] : []), ...(under ? [under] : []), ...plain].map((layer) =>
            renderLayer(layer, layer === base ? "is-base" : layer === top && layers.length === 1 ? "is-top" : layer.className),
          )}
          {windowLayers.length > 0 && (
            <div key="window" className={windowClosing ? "ax-window-host is-closing" : "ax-window-host"}>
              <div className="ax-window-dim" onClick={closeWindow} />
              <div className="ax-window" role="dialog">
                {windowLayers.map((layer) => renderLayer(layer, layer.className.replace("window-exit", ""), true))}
              </div>
            </div>
          )}
        </div>
        {nav && <BottomNav />}
        <OverlayScrollbar />
      </div>
    </div>
  );
}

/** Один экран со своей шапкой: у разделов — `AppHeader` (кроме настроек), у внутренних — `TopBar`. */
function ScreenLayer({
  className,
  title,
  onOpenMenu,
  onClose,
  children,
}: {
  className: string;
  title: string | null | undefined;
  onOpenMenu: () => void;
  /** Есть — экран открыт окном: у разделов вместо шапки с логотипом крестик «закрыть». */
  onClose?: () => void;
  children: ReactNode;
}) {
  const { t } = useI18n();
  const { pathname } = useLocation();
  const root = title !== undefined;
  // Какая шапка у слоя: «app» — шапка раздела, «top» — строка с «назад», null — без шапки
  const head = root ? (onClose || pathname === "/settings" ? null : "app") : pathname.startsWith("/search") ? null : "top";
  const ref = useRef<HTMLDivElement>(null);
  useScrollHead(ref, head !== null, pathname === "/");
  const header = root ? (
    onClose ? (
      <button type="button" className="ax-window-close" aria-label={t("common.close")} onClick={onClose}>
        <Icon name="x" size={22} />
      </button>
    ) : (
      pathname !== "/settings" && <AppHeader title={title ? t(title) : undefined} />
    )
  ) : (
    !pathname.startsWith("/search") && <TopBar onOpenMenu={onOpenMenu} />
  );
  const cls = ["ax-layer", className, head && "has-head", head === "app" && "head-app"].filter(Boolean).join(" ");
  return (
    <div ref={ref} className={cls} aria-hidden={className.includes("is-exit") || undefined}>
      {header}
      <div className="content">{children}</div>
    </div>
  );
}

/** Сколько надо прокрутить в одну сторону, чтобы шапка главной спряталась или вернулась. */
const HEAD_TURN = 24;

/**
 * Шапка лежит поверх контента. Как только страница прокручена, она становится полупрозрачной с размытием
 * (`is-scrolled`, как в Telegram); на главной при прокрутке вниз уезжает вверх, при прокрутке вверх
 * возвращается (`head-hidden`). Классы ставятся прямо на слой, без перерисовки React.
 */
function useScrollHead(ref: RefObject<HTMLDivElement | null>, enabled: boolean, hideOnScroll: boolean) {
  useEffect(() => {
    const el = ref.current;
    if (!el || !enabled) return;
    const last = new WeakMap<Element, number>();
    let acc = 0;
    let hidden = false;
    const setHidden = (h: boolean) => {
      if (h === hidden) return;
      hidden = h;
      el.classList.toggle("head-hidden", h);
    };
    const onScroll = (e: Event) => {
      const t = e.target;
      if (!(t instanceof HTMLElement)) return;
      const y = t.scrollTop;
      const prev = last.get(t) ?? 0;
      last.set(t, y);
      if (y === prev) {
        // Листание вкладок главной — шапку показать
        if (t.classList.contains("ax-pager")) setHidden(false);
        return;
      }
      el.classList.toggle("is-scrolled", y > 2);
      if (!hideOnScroll) return;
      const d = y - prev;
      acc = Math.sign(acc) === Math.sign(d) ? acc + d : d;
      if (y < 64) setHidden(false);
      else if (acc > HEAD_TURN) setHidden(true);
      else if (acc < -HEAD_TURN) setHidden(false);
    };
    el.addEventListener("scroll", onScroll, { capture: true, passive: true });
    return () => {
      el.removeEventListener("scroll", onScroll, { capture: true });
      el.classList.remove("is-scrolled", "head-hidden");
    };
  }, [ref, enabled, hideOnScroll]);
}
