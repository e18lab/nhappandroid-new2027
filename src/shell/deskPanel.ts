/**
 * ПК: панель заголовка окна (разделы, адрес, панель страницы) лежит поверх экрана — лента прокручивается под ней.
 *  - Размеры — CSS-переменными на `<html>`: `--dk-top` (полоса вкладок браузера: с неё начинается экран) и
 *    `--dk-panel-h` (высота развёрнутой панели: отступ сверху у ленты). Во время сворачивания высота не меняется —
 *    иначе лента прыгала бы на высоту строки разделов.
 *  - Свёрнутая («компактная»): страницу прокрутили вниз — строка разделов прячется, панель полупрозрачная.
 *    У верха страницы, при смене страницы или вкладки — снова развёрнута.
 */
import { useEffect, useLayoutEffect, useState, type RefObject } from "react";

/** Высота строки разделов (`.dk-row-nav`), когда она видна. */
const NAV_H = 46;
/** Свернуть, когда прокрутили дальше; развернуть — ближе к верху. */
const COLLAPSE_AT = 56;
const EXPAND_AT = 16;

/** Прокручиваемый по вертикали предок (в выбранной вкладке, не во всплывающем окне). */
function scrollerOf(el: Element | null): HTMLElement | null {
  for (let n = el instanceof HTMLElement ? el : el?.parentElement ?? null; n; n = n.parentElement) {
    if (n.matches(".ax-window-host, .is-hidden-tab")) return null;
    if (n.classList.contains("main")) return null;
    const oy = getComputedStyle(n).overflowY;
    if ((oy === "auto" || oy === "scroll") && n.scrollHeight - n.clientHeight > 1) return n;
  }
  return null;
}

const inActiveTab = (el: HTMLElement) => !!el.closest(".ax-desk > .main:not(.is-hidden-tab)") && !el.closest(".ax-window-host");

export function useDeskPanel(panel: RefObject<HTMLElement | null>, strip: RefObject<HTMLElement | null>, pageKey: string): boolean {
  const [compact, setCompact] = useState(false);

  useLayoutEffect(() => {
    const p = panel.current;
    const s = strip.current;
    if (!p || !s) return;
    const root = document.documentElement;
    const nav = p.querySelector<HTMLElement>(".dk-row-nav");
    const measure = () => {
      // Развёрнутая высота: строка разделов — всегда полной высоты, даже пока она сворачивается
      const h = p.offsetHeight - (nav?.offsetHeight ?? 0) + (nav ? NAV_H : 0);
      root.style.setProperty("--dk-panel-h", `${h}px`);
      root.style.setProperty("--dk-top", `${s.offsetHeight}px`);
    };
    const ro = new ResizeObserver(measure);
    ro.observe(p);
    ro.observe(s);
    measure();
    return () => ro.disconnect();
  }, [panel, strip]);

  useEffect(() => {
    let timer = 0;
    // Что сейчас под панелью — та лента и решает (после смены страницы, листания разделов главной)
    const recheck = () => {
      window.clearTimeout(timer);
      timer = window.setTimeout(() => {
        const p = panel.current;
        if (!p) return;
        const r = p.getBoundingClientRect();
        const sc = scrollerOf(document.elementFromPoint(r.left + r.width / 2, r.bottom + 48));
        setCompact(!!sc && inActiveTab(sc) && sc.scrollTop > EXPAND_AT);
      }, 340);
    };
    const onScroll = (e: Event) => {
      const t = e.target;
      if (!(t instanceof HTMLElement) || !inActiveTab(t)) return;
      // Листание разделов главной вбок — у новой страницы своя прокрутка
      if (t.classList.contains("ax-pager")) return recheck();
      if (t.scrollHeight - t.clientHeight < 120) return;
      const y = t.scrollTop;
      setCompact((c) => (c ? y > EXPAND_AT : y > COLLAPSE_AT));
    };
    document.addEventListener("scroll", onScroll, { capture: true, passive: true });
    recheck();
    return () => {
      window.clearTimeout(timer);
      document.removeEventListener("scroll", onScroll, { capture: true });
    };
  }, [panel, pageKey]);

  return compact;
}
