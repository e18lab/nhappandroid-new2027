/**
 * Новый кит (редизайн в духе Anixart): страницы, которые листаются свайпом вбок, и полоса вкладок над ними.
 *
 * `Pager` — горизонтальная лента со scroll-snap: каждая страница во всю ширину и со своей вертикальной
 * прокруткой. Страница монтируется, когда до неё дошли, и дальше не размонтируется (сохраняет прокрутку),
 * но дальние страницы браузер не считает и не рисует, сколько бы их ни было открыто.
 * `PageTabs` — как FloatingTabsBar в Anixart: плашка по ширине вкладок; выделение-«пилюля» едет за пальцем
 * по доле прокрутки ленты, выбранная вкладка подкручивается в видимую часть полосы, края полосы гаснут
 * только с той стороны, где есть что прокрутить. Слева — необязательная кнопка (фильтры).
 * У вкладки может быть меню (`menu`, на ПК): стрелка у подписи, по наведению или нажатию — панель с выбором
 * страницы внутри вкладки, как выпадающие меню на сайтах.
 */
import { memo, startTransition, useCallback, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { Icon, type IconName } from "./Icon";

export interface TabMenuItem {
  key: string;
  label: string;
  description?: string;
  icon: IconName;
}

export interface TabMenu {
  title: string;
  items: TabMenuItem[];
  value: string;
  onSelect: (key: string) => void;
}

export interface PagerTab {
  key: string;
  label: string;
  menu?: TabMenu;
}

/**
 * Состояние ленты: какая страница выбрана и какие уже смонтированы.
 * Дробная позиция прокрутки — не состояние React: она меняется каждый кадр, и перерисовка на каждый кадр
 * заново считала бы все открытые страницы. Кому она нужна (полоса вкладок), подписывается через `subscribe`.
 */
export function usePager(count: number, initial = 0) {
  const [index, setIndexState] = useState(() => Math.min(Math.max(0, initial), Math.max(0, count - 1)));
  const [mounted, setMounted] = useState<ReadonlySet<number>>(() => new Set([index]));
  const track = useRef<HTMLDivElement>(null);
  const indexRef = useRef(index);
  const position = useRef<number>(index);
  const listeners = useRef(new Set<(pos: number) => void>());

  const setIndex = useCallback((i: number) => {
    indexRef.current = i;
    setIndexState(i);
  }, []);

  const setPosition = useCallback((pos: number) => {
    position.current = pos;
    for (const l of listeners.current) l(pos);
  }, []);

  const subscribe = useCallback((l: (pos: number) => void) => {
    listeners.current.add(l);
    return () => {
      listeners.current.delete(l);
    };
  }, []);

  const mount = useCallback((pages: number[]) => {
    setMounted((prev) => (pages.every((i) => prev.has(i)) ? prev : new Set([...prev, ...pages])));
  }, []);

  const goTo = useCallback(
    (i: number, smooth = true) => {
      const el = track.current;
      if (!el) return;
      mount([i]);
      // К дальней вкладке — сразу: плавная прокрутка протащила бы через все страницы между ними
      const near = Math.abs(i - position.current) <= 1;
      el.scrollTo({ left: i * el.clientWidth, behavior: smooth && near ? "smooth" : "auto" });
    },
    [mount],
  );

  return { index, indexRef, setIndex, position, setPosition, subscribe, mounted, mount, track, goTo };
}

type PagerState = ReturnType<typeof usePager>;

/**
 * Страница перерисовывается, только когда стала открытой или перестала: `render` намеренно не сравнивается
 * (у родителя он новый на каждую отрисовку), поэтому не должен зависеть от состояния родителя.
 * Своё состояние, контексты и подписки у страницы работают как обычно.
 */
const PagerPage = memo(
  function PagerPage({ index, active, render }: { index: number; active: boolean; render: (index: number, active: boolean) => ReactNode }) {
    return render(index, active);
  },
  (a, b) => a.index === b.index && a.active === b.active,
);

/** Страницы дальше этого расстояния браузер не считает и не рисует (см. `.is-far` в kit.css). */
const FAR_PAGES = 2;

export function Pager({
  pager,
  count,
  render,
  onIndexChange,
}: {
  pager: PagerState;
  count: number;
  /** Содержимое страницы; не должно зависеть от состояния родителя (см. `PagerPage`). */
  render: (index: number, active: boolean) => ReactNode;
  onIndexChange?: (index: number) => void;
}) {
  const { track, index, indexRef, setIndex, setPosition, mounted, mount, goTo } = pager;
  const pages = useRef<(HTMLElement | null)[]>([]);

  const markFar = useCallback((pos: number) => {
    pages.current.forEach((el, i) => el?.classList.toggle("is-far", Math.abs(i - pos) >= FAR_PAGES));
  }, []);

  // Стартовая страница без анимации; при повороте экрана — остаёмся на той же
  useLayoutEffect(() => {
    goTo(index, false);
    markFar(index);
    const el = track.current;
    if (!el) return;
    const ro = new ResizeObserver(() => goTo(indexRef.current, false));
    ro.observe(el);
    return () => ro.disconnect();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const onScroll = () => {
    const el = track.current;
    if (!el || !el.clientWidth) return;
    const pos = el.scrollLeft / el.clientWidth;
    setPosition(pos);
    markFar(pos);
    // Новая страница монтируется низким приоритетом, чтобы не задерживать сам свайп
    const near = [Math.floor(pos), Math.ceil(pos)].filter((i) => i >= 0 && i < count);
    if (!near.every((i) => mounted.has(i))) startTransition(() => mount(near));
    const next = Math.round(pos);
    if (next !== indexRef.current && Math.abs(pos - next) < 0.02) {
      setIndex(next);
      onIndexChange?.(next);
    }
  };

  return (
    <div ref={track} className="ax-pager" onScroll={onScroll}>
      {Array.from({ length: count }, (_, i) => (
        <section
          key={i}
          ref={(el) => {
            pages.current[i] = el;
          }}
          className="ax-pager-page"
          aria-hidden={i !== index}
        >
          {mounted.has(i) ? <PagerPage index={i} active={i === index} render={render} /> : null}
        </section>
      ))}
    </div>
  );
}

export function PageTabs({
  tabs,
  pager,
  leading,
  inactive = false,
}: {
  tabs: PagerTab[];
  pager: PagerState;
  leading?: ReactNode;
  /** Ни одна вкладка не выбрана (заголовок окна ПК, когда открыта не главная): без «пилюли». */
  inactive?: boolean;
}) {
  const strip = useRef<HTMLDivElement>(null);
  const buttons = useRef<(HTMLButtonElement | null)[]>([]);
  const pill = useRef<HTMLSpanElement>(null);
  const { position, subscribe } = pager;
  const [current, setCurrent] = useState(() => Math.round(position.current));
  const [fade, setFade] = useState({ start: false, end: false });
  const [menuAt, setMenuAt] = useState<number | null>(null);
  const closeTimer = useRef<number | undefined>(undefined);

  const openMenu = (i: number) => {
    window.clearTimeout(closeTimer.current);
    setMenuAt(i);
  };
  const closeMenuSoon = () => {
    window.clearTimeout(closeTimer.current);
    closeTimer.current = window.setTimeout(() => setMenuAt(null), 180);
  };
  useEffect(() => () => window.clearTimeout(closeTimer.current), []);

  const updateFade = useCallback(() => {
    const el = strip.current;
    if (!el) return;
    const start = el.scrollLeft > 1;
    const end = el.scrollLeft + el.clientWidth < el.scrollWidth - 1;
    setFade((f) => (f.start === start && f.end === end ? f : { start, end }));
  }, []);

  useLayoutEffect(() => {
    updateFade();
    const el = strip.current;
    if (!el) return;
    const ro = new ResizeObserver(updateFade);
    ro.observe(el);
    return () => ro.disconnect();
  }, [updateFade, tabs.length]);

  // Пилюля между двумя вкладками — по дробной позиции ленты, прямо в DOM: она едет каждый кадр
  useLayoutEffect(() => {
    const paint = (raw: number) => {
      const pos = Math.min(Math.max(raw, 0), tabs.length - 1);
      const a = buttons.current[Math.floor(pos)];
      const b = buttons.current[Math.ceil(pos)] ?? a;
      if (!a || !b || !pill.current) return;
      const f = pos - Math.floor(pos);
      pill.current.style.transform = `translateX(${a.offsetLeft + (b.offsetLeft - a.offsetLeft) * f}px)`;
      pill.current.style.width = `${a.offsetWidth + (b.offsetWidth - a.offsetWidth) * f}px`;
      setCurrent(Math.round(pos));
    };
    paint(position.current);
    const stop = subscribe(paint);
    // Ширина вкладок меняется после загрузки шрифта и смены языка
    const ro = new ResizeObserver(() => paint(position.current));
    if (strip.current) ro.observe(strip.current);
    return () => {
      stop();
      ro.disconnect();
    };
  }, [position, subscribe, tabs.length]);

  // Выбранная вкладка — в видимую часть полосы
  useEffect(() => {
    const el = strip.current;
    const btn = buttons.current[pager.index];
    if (!el || !btn) return;
    const target = btn.offsetLeft - (el.clientWidth - btn.offsetWidth) / 2;
    el.scrollTo({ left: Math.max(0, target), behavior: "smooth" });
  }, [pager.index]);

  return (
    <div className={inactive ? "ax-tabs is-idle" : "ax-tabs"}>
      {leading && <div className="ax-tabs-leading">{leading}</div>}
      <div
        ref={strip}
        className={`ax-tabs-strip${fade.start ? " fade-start" : ""}${fade.end ? " fade-end" : ""}`}
        role="tablist"
        onScroll={updateFade}
      >
        <span ref={pill} className="ax-tabs-pill" />
        {tabs.map((tab, i) => (
          <button
            key={tab.key}
            ref={(el) => {
              buttons.current[i] = el;
            }}
            type="button"
            role="tab"
            aria-selected={!inactive && i === pager.index}
            className={`${current === i && !inactive ? "ax-tab is-active" : "ax-tab"}${tab.menu ? " has-menu" : ""}${menuAt === i ? " is-open" : ""}`}
            aria-haspopup={tab.menu ? "menu" : undefined}
            aria-expanded={tab.menu ? menuAt === i : undefined}
            onClick={() => {
              pager.goTo(i);
              if (tab.menu) setMenuAt((m) => (m === i ? null : i));
            }}
            onMouseEnter={tab.menu ? () => openMenu(i) : undefined}
            onMouseLeave={tab.menu ? closeMenuSoon : undefined}
          >
            {tab.label}
            {tab.menu && <Icon name="chevron-down" size={14} className="ax-tab-chevron" />}
          </button>
        ))}
      </div>
      {menuAt != null && tabs[menuAt]?.menu && (
        <TabMenuPanel
          anchor={buttons.current[menuAt]}
          menu={tabs[menuAt].menu!}
          current={!inactive && pager.index === menuAt}
          onPick={() => pager.goTo(menuAt)}
          onEnter={() => openMenu(menuAt)}
          onLeave={closeMenuSoon}
          onClose={() => setMenuAt(null)}
        />
      )}
    </div>
  );
}

/** Панель меню вкладки — под вкладкой, поверх всего (полоса вкладок обрезает то, что за её краем). */
function TabMenuPanel({
  anchor,
  menu,
  current,
  onPick,
  onEnter,
  onLeave,
  onClose,
}: {
  anchor: HTMLElement | null;
  menu: TabMenu;
  /** Вкладка открыта — тогда выбранная страница подсвечивается. */
  current: boolean;
  /** Выбран пункт — открыть саму вкладку (меню можно открыть и с другой вкладки). */
  onPick: () => void;
  onEnter: () => void;
  onLeave: () => void;
  onClose: () => void;
}) {
  const panel = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null);

  useLayoutEffect(() => {
    if (!anchor || !panel.current) return;
    const a = anchor.getBoundingClientRect();
    const w = panel.current.offsetWidth;
    const left = Math.min(Math.max(8, a.left + a.width / 2 - w / 2), window.innerWidth - w - 8);
    setPos({ left, top: a.bottom + 8 });
  }, [anchor]);

  useEffect(() => {
    const onDown = (e: PointerEvent) => {
      const target = e.target as Node;
      if (!panel.current?.contains(target) && !anchor?.contains(target)) onClose();
    };
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("pointerdown", onDown, true);
    window.addEventListener("keydown", onKey);
    window.addEventListener("resize", onClose);
    return () => {
      window.removeEventListener("pointerdown", onDown, true);
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("resize", onClose);
    };
  }, [anchor, onClose]);

  return createPortal(
    <div
      ref={panel}
      className="ax-tabmenu"
      role="menu"
      style={pos ? { left: pos.left, top: pos.top } : { visibility: "hidden" }}
      onMouseEnter={onEnter}
      onMouseLeave={onLeave}
    >
      <div className="ax-tabmenu-title">{menu.title}</div>
      {menu.items.map((item) => {
        const active = current && item.key === menu.value;
        return (
        <button
          key={item.key}
          type="button"
          role="menuitemradio"
          aria-checked={active}
          className={active ? "ax-tabmenu-item is-active" : "ax-tabmenu-item"}
          onClick={() => {
            menu.onSelect(item.key);
            onPick();
            onClose();
          }}
        >
          <Icon name={item.icon} size={20} />
          <span className="ax-tabmenu-text">
            <span className="ax-tabmenu-label">{item.label}</span>
            {item.description && <span className="ax-tabmenu-desc">{item.description}</span>}
          </span>
        </button>
        );
      })}
    </div>,
    document.body,
  );
}
