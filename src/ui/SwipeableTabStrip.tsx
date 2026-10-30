/**
 * Горизонтальная полоса вкладок-«пилюль» — перенос `components/uikit/SwipeableTabStrip.tsx`.
 * Подсветка переезжает под выбранную вкладку; выбранная прокручивается к центру;
 * по краям — затухание, когда есть что прокручивать; колесо мыши листает вбок.
 */
import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";

export interface SwipeableTabItem {
  label: string;
  icon?: (color: string) => ReactNode;
}

export function SwipeableTabStrip({
  tabs,
  selectedIndex,
  onSelectIndex,
  backgroundColor,
}: {
  tabs: SwipeableTabItem[] | string[];
  selectedIndex: number;
  onSelectIndex: (index: number) => void;
  backgroundColor?: string;
}) {
  const items = tabs.map((t) => (typeof t === "string" ? { label: t } : t));
  const scroller = useRef<HTMLDivElement>(null);
  const tabRefs = useRef<(HTMLButtonElement | null)[]>([]);
  const [pill, setPill] = useState<{ left: number; width: number } | null>(null);
  const [edges, setEdges] = useState({ left: false, right: false });

  const updateEdges = () => {
    const el = scroller.current;
    if (!el) return;
    const max = el.scrollWidth - el.clientWidth;
    setEdges({ left: el.scrollLeft > 2, right: el.scrollLeft < max - 2 });
  };

  useLayoutEffect(() => {
    const tab = tabRefs.current[selectedIndex];
    if (tab) setPill({ left: tab.offsetLeft, width: tab.offsetWidth });
  }, [selectedIndex, items.length]);

  // Первая вкладка — к началу, остальные — к центру, но без обрезки слева.
  useEffect(() => {
    const el = scroller.current;
    const tab = tabRefs.current[selectedIndex];
    if (!el || !tab) return;
    const center = tab.offsetLeft + tab.offsetWidth / 2 - el.clientWidth / 2;
    const target = selectedIndex === 0 ? 0 : center < 0 ? tab.offsetLeft : Math.max(0, Math.min(tab.offsetLeft, center));
    el.scrollTo({ left: target, behavior: "smooth" });
  }, [selectedIndex]);

  useEffect(() => {
    const el = scroller.current;
    if (!el) return;
    updateEdges();
    const onWheel = (e: WheelEvent) => {
      const delta = (e.deltaY || e.deltaX) * 0.45;
      if (!delta) return;
      el.scrollLeft += delta;
      e.preventDefault();
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    const ro = new ResizeObserver(updateEdges);
    ro.observe(el);
    return () => {
      el.removeEventListener("wheel", onWheel);
      ro.disconnect();
    };
  }, []);

  return (
    <div className="ui-tabstrip" style={backgroundColor ? { background: backgroundColor } : undefined}>
      <div ref={scroller} className="ui-tabstrip-scroll" onScroll={updateEdges} role="tablist">
        <div className="ui-tabstrip-row">
          {pill && <span className="ui-tabstrip-pill" style={{ left: pill.left, width: pill.width }} />}
          {items.map((item, i) => {
            const selected = i === selectedIndex;
            return (
              <button
                key={i}
                ref={(el) => {
                  tabRefs.current[i] = el;
                }}
                type="button"
                role="tab"
                aria-selected={selected}
                className={selected ? "ui-tab is-selected" : "ui-tab"}
                onClick={() => onSelectIndex(i)}
              >
                {item.icon ? <span className="ui-tab-icon">{item.icon("currentColor")}</span> : null}
                <span className="ui-tab-label">{item.label}</span>
              </button>
            );
          })}
        </div>
      </div>
      <span className={edges.left ? "ui-tabstrip-fade is-left is-on" : "ui-tabstrip-fade is-left"} />
      <span className={edges.right ? "ui-tabstrip-fade is-right is-on" : "ui-tabstrip-fade is-right"} />
    </div>
  );
}
