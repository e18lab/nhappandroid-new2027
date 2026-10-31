/**
 * Новый кит (редизайн в духе Anixart): страницы, которые листаются свайпом вбок, и полоса вкладок над ними.
 *
 * `Pager` — горизонтальная лента со scroll-snap: каждая страница во всю ширину и со своей вертикальной
 * прокруткой. Страница монтируется, когда до неё дошли, и дальше не размонтируется (сохраняет прокрутку).
 * `PageTabs` — как FloatingTabsBar в Anixart: плашка по ширине вкладок; выделение-«пилюля» едет за пальцем
 * по доле прокрутки ленты, выбранная вкладка подкручивается в видимую часть полосы, края полосы гаснут
 * только с той стороны, где есть что прокрутить. Слева — необязательная кнопка (фильтры).
 * У вкладки может быть меню (`menu`, на ПК): стрелка у подписи, по наведению или нажатию — панель с выбором
 * страницы внутри вкладки, как выпадающие меню на сайтах.
 */
import { useCallback, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
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

/** Состояние ленты: какая страница выбрана и где сейчас прокрутка (дробный индекс). */
export function usePager(count: number, initial = 0) {
  const [index, setIndex] = useState(() => Math.min(Math.max(0, initial), Math.max(0, count - 1)));
  const [position, setPosition] = useState(index);
  const track = useRef<HTMLDivElement>(null);

  const goTo = useCallback((i: number, smooth = true) => {
    const el = track.current;
    if (!el) return;
    el.scrollTo({ left: i * el.clientWidth, behavior: smooth ? "smooth" : "auto" });
  }, []);

  return { index, setIndex, position, setPosition, track, goTo };
}

type PagerState = ReturnType<typeof usePager>;

export function Pager({
  pager,
  count,
  render,
  onIndexChange,
}: {
  pager: PagerState;
  count: number;
  render: (index: number, active: boolean) => ReactNode;
  onIndexChange?: (index: number) => void;
}) {
  const { track, index, setIndex, setPosition, goTo } = pager;
  const [mounted, setMounted] = useState<Set<number>>(() => new Set([index]));

  // Стартовая страница без анимации; при повороте экрана — остаёмся на той же
  useLayoutEffect(() => {
    goTo(index, false);
    const el = track.current;
    if (!el) return;
    const ro = new ResizeObserver(() => goTo(pager.index, false));
    ro.observe(el);
    return () => ro.disconnect();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const onScroll = () => {
    const el = track.current;
    if (!el || !el.clientWidth) return;
    const pos = el.scrollLeft / el.clientWidth;
    setPosition(pos);
    // Соседние страницы готовим заранее, чтобы при свайпе они уже были
    const near = [Math.floor(pos), Math.ceil(pos)].filter((i) => i >= 0 && i < count);
    setMounted((prev) => (near.every((i) => prev.has(i)) ? prev : new Set([...prev, ...near])));
    const next = Math.round(pos);
    if (next !== pager.index && Math.abs(pos - next) < 0.02) {
      setIndex(next);
      onIndexChange?.(next);
    }
  };

  return (
    <div ref={track} className="ax-pager" onScroll={onScroll}>
      {Array.from({ length: count }, (_, i) => (
        <section key={i} className="ax-pager-page" aria-hidden={i !== index}>
          {mounted.has(i) ? render(i, i === index) : null}
        </section>
      ))}
    </div>
  );
}

export function PageTabs({
  tabs,
  pager,
  leading,
}: {
  tabs: PagerTab[];
  pager: PagerState;
  leading?: ReactNode;
}) {
  const strip = useRef<HTMLDivElement>(null);
  const buttons = useRef<(HTMLButtonElement | null)[]>([]);
  const [pill, setPill] = useState<{ left: number; width: number } | null>(null);
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

  // Пилюля между двумя вкладками — по дробной позиции ленты
  useLayoutEffect(() => {
    const pos = Math.min(Math.max(pager.position, 0), tabs.length - 1);
    const a = buttons.current[Math.floor(pos)];
    const b = buttons.current[Math.ceil(pos)] ?? a;
    if (!a || !b) return;
    const f = pos - Math.floor(pos);
    setPill({ left: a.offsetLeft + (b.offsetLeft - a.offsetLeft) * f, width: a.offsetWidth + (b.offsetWidth - a.offsetWidth) * f });
  }, [pager.position, tabs.length]);

  // Выбранная вкладка — в видимую часть полосы
  useEffect(() => {
    const el = strip.current;
    const btn = buttons.current[pager.index];
    if (!el || !btn) return;
    const target = btn.offsetLeft - (el.clientWidth - btn.offsetWidth) / 2;
    el.scrollTo({ left: Math.max(0, target), behavior: "smooth" });
  }, [pager.index]);

  return (
    <div className="ax-tabs">
      {leading && <div className="ax-tabs-leading">{leading}</div>}
      <div
        ref={strip}
        className={`ax-tabs-strip${fade.start ? " fade-start" : ""}${fade.end ? " fade-end" : ""}`}
        role="tablist"
        onScroll={updateFade}
      >
        {pill && <span className="ax-tabs-pill" style={{ transform: `translateX(${pill.left}px)`, width: pill.width }} />}
        {tabs.map((tab, i) => (
          <button
            key={tab.key}
            ref={(el) => {
              buttons.current[i] = el;
            }}
            type="button"
            role="tab"
            aria-selected={i === pager.index}
            className={`${Math.round(pager.position) === i ? "ax-tab is-active" : "ax-tab"}${tab.menu ? " has-menu" : ""}${menuAt === i ? " is-open" : ""}`}
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
          current={pager.index === menuAt}
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
