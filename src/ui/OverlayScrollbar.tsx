/**
 * Своя полоса прокрутки для всего приложения: тонкая, поверх контента (места не занимает — системные
 * полосы скрыты в kit.css), появляется при прокрутке или наведении мыши и гаснет через секунду.
 * Ползунок можно тянуть. Дорожка не заходит под шапку, полосу вкладок и нижнюю навигацию —
 * отступает от тех элементов, под которыми прячется контент.
 *
 * Один экземпляр на приложение: следит за прокруткой любых блоков (событие scroll в фазе захвата).
 */
import { useEffect, useRef } from "react";

/** Отступ дорожки от краёв блока и от элементов поверх него. */
const GAP = 6;
const MIN_THUMB = 32;
const HIDE_MS = 900;
/** Блоки со своей логикой прокрутки — полосу не показываем. */
const SKIP = ".reader-list, .reader-pager, .no-overlay-scrollbar";
/** Элементы, которые лежат поверх контента сверху (шапка, полоса вкладок главной). */
const TOP_CHROME = ".ax-header, .topbar, .ax-home-tabs";

function scrollableY(el: Element): el is HTMLElement {
  if (!(el instanceof HTMLElement) || el.scrollHeight <= el.clientHeight + 1) return false;
  const oy = getComputedStyle(el).overflowY;
  return oy === "auto" || oy === "scroll";
}

function scrollParent(from: EventTarget | null): HTMLElement | null {
  let el = from instanceof Element ? from : null;
  while (el && el !== document.body) {
    if (scrollableY(el)) return el.closest(SKIP) ? null : el;
    el = el.parentElement;
  }
  return null;
}

/** Видимая часть блока: обрезана предками с overflow (окно, шторка); правые радиусы на её краях. */
function visibleBox(el: HTMLElement, r: DOMRect) {
  let top = r.top;
  let bottom = r.bottom;
  let right = r.right;
  let rt = 0;
  let rb = 0;
  for (let n: HTMLElement | null = el; n && n !== document.body; n = n.parentElement) {
    const st = styleOf(n);
    if (n !== el && !st.clip) continue;
    const nr = n.getBoundingClientRect();
    top = Math.max(top, nr.top);
    bottom = Math.min(bottom, nr.bottom);
    right = Math.min(right, nr.right);
    if (Math.abs(nr.right - right) <= 2) {
      if (Math.abs(nr.top - top) <= 2) rt = Math.max(rt, st.rt);
      if (Math.abs(nr.bottom - bottom) <= 2) rb = Math.max(rb, st.rb);
    }
  }
  return { top, bottom, right, rt, rb };
}

const styles = new WeakMap<HTMLElement, { clip: boolean; rt: number; rb: number }>();
function styleOf(n: HTMLElement) {
  let st = styles.get(n);
  if (!st) {
    const s = getComputedStyle(n);
    st = { clip: s.overflow !== "visible", rt: parseFloat(s.borderTopRightRadius) || 0, rb: parseFloat(s.borderBottomRightRadius) || 0 };
    styles.set(n, st);
  }
  return st;
}

/** Дорожка: верх, низ и правый край с учётом обрезки, скруглений и элементов, перекрывающих блок. */
function trackBounds(el: HTMLElement, r: DOMRect): [number, number, number] {
  const box = visibleBox(el, r);
  let top = box.top;
  let bottom = box.bottom;
  const layer = el.closest(".ax-layer");
  if (layer) {
    for (const c of layer.querySelectorAll(TOP_CHROME)) {
      if (el.contains(c)) continue;
      const cr = c.getBoundingClientRect();
      if (cr.height > 0 && cr.top <= top + 1 && cr.bottom > top && cr.bottom < bottom) top = cr.bottom;
    }
  }
  const nav = document.querySelector(".ax-nav");
  if (nav && !el.closest(".ui-sheet, .ax-window")) {
    const nr = nav.getBoundingClientRect();
    if (nr.height > 0 && nr.top < bottom && nr.top > top) bottom = nr.top;
  }
  // Скруглённый угол у правого края — дорожка не заезжает на закругление
  top = Math.max(top, box.top + box.rt);
  bottom = Math.min(bottom, box.bottom - box.rb);
  return [top + GAP, bottom - GAP, box.right];
}

export function OverlayScrollbar() {
  const bar = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const node = bar.current;
    if (!node) return;
    let target: HTMLElement | null = null;
    let frame = 0;
    let hideTimer = 0;
    let hover = false;
    let drag: { y: number; start: number; ratio: number } | null = null;

    const hide = () => node.classList.remove("is-on");
    const scheduleHide = () => {
      window.clearTimeout(hideTimer);
      hideTimer = window.setTimeout(() => {
        if (!hover && !drag) hide();
      }, HIDE_MS);
    };

    const paint = () => {
      frame = 0;
      const el = target;
      if (!el || !el.isConnected || el.closest(".is-exit, .is-closing") || el.scrollHeight <= el.clientHeight + 1) return hide();
      const r = el.getBoundingClientRect();
      const [top, bottom, right] = trackBounds(el, r);
      const track = bottom - top;
      if (track < MIN_THUMB * 1.5) return hide();
      const max = el.scrollHeight - el.clientHeight;
      const thumb = Math.max(MIN_THUMB, (track * el.clientHeight) / el.scrollHeight);
      const y = top + ((track - thumb) * Math.min(Math.max(el.scrollTop, 0), max)) / max;
      node.style.transform = `translate(${right - node.offsetWidth}px, ${y}px)`;
      node.style.height = `${thumb}px`;
      node.classList.add("is-on");
    };
    const show = (el: HTMLElement) => {
      target = el;
      if (!frame) frame = requestAnimationFrame(paint);
      scheduleHide();
    };

    const onScroll = (e: Event) => {
      const t = e.target;
      if (target && t === target) return show(target);
      if (t instanceof HTMLElement && !t.closest(SKIP) && scrollableY(t)) show(t);
    };
    let moveFrame = 0;
    const onMove = (e: PointerEvent) => {
      if (e.pointerType !== "mouse" || drag || moveFrame) return;
      const t = e.target;
      moveFrame = requestAnimationFrame(() => {
        moveFrame = 0;
        const el = scrollParent(t);
        if (el) show(el);
      });
    };

    const onDown = (e: PointerEvent) => {
      if (!target) return;
      e.preventDefault();
      e.stopPropagation();
      const r = target.getBoundingClientRect();
      const [top, bottom] = trackBounds(target, r);
      const free = bottom - top - node.offsetHeight;
      drag = { y: e.clientY, start: target.scrollTop, ratio: free > 0 ? (target.scrollHeight - target.clientHeight) / free : 0 };
      node.setPointerCapture(e.pointerId);
      node.classList.add("is-drag");
    };
    const onDrag = (e: PointerEvent) => {
      if (!drag || !target) return;
      target.scrollTop = drag.start + (e.clientY - drag.y) * drag.ratio;
    };
    const onUp = () => {
      drag = null;
      node.classList.remove("is-drag");
      scheduleHide();
    };
    const onEnter = () => {
      hover = true;
      window.clearTimeout(hideTimer);
    };
    const onLeave = () => {
      hover = false;
      scheduleHide();
    };

    // Переход на другой экран или нажатие мимо ползунка — полосу убрать сразу, не дожидаясь таймера
    const drop = (e?: Event) => {
      if (e && e.target instanceof Node && node.contains(e.target)) return;
      target = null;
      node.classList.remove("is-on");
    };
    window.addEventListener("hashchange", drop);
    window.addEventListener("popstate", drop);
    document.addEventListener("pointerdown", drop, { capture: true });
    document.addEventListener("scroll", onScroll, { capture: true, passive: true });
    document.addEventListener("pointermove", onMove, { passive: true });
    node.addEventListener("pointerdown", onDown);
    node.addEventListener("pointermove", onDrag);
    node.addEventListener("pointerup", onUp);
    node.addEventListener("pointercancel", onUp);
    node.addEventListener("pointerenter", onEnter);
    node.addEventListener("pointerleave", onLeave);
    return () => {
      document.removeEventListener("scroll", onScroll, { capture: true });
      window.removeEventListener("hashchange", drop);
      window.removeEventListener("popstate", drop);
      document.removeEventListener("pointerdown", drop, { capture: true });
      document.removeEventListener("pointermove", onMove);
      cancelAnimationFrame(frame);
      cancelAnimationFrame(moveFrame);
      window.clearTimeout(hideTimer);
    };
  }, []);

  return (
    <div ref={bar} className="ax-sb" aria-hidden>
      <div className="ax-sb-thumb" />
    </div>
  );
}
