/**
 * Прокрутка экранов по записям истории: ушли со страницы вперёд и вернулись назад — она там же, где была.
 * Ключ — `location.key` слоя: он свой у каждой записи истории каждой вкладки, поэтому у вкладок своя память.
 * Запоминаются все прокручиваемые блоки слоя (лента, страницы ленты главной, строки «вбок») по их месту в DOM.
 *
 * Вернулись — содержимое может появиться не сразу (лента грузится, страница книги ждёт данных): прокрутка
 * ставится, как только высоты хватает; пока не хватает — листаем в самый низ, чтобы лента подгрузила ещё.
 * Тронули страницу сами (колесо, палец, клавиши) — восстановление прекращается. Только в памяти.
 */

import { useLayoutEffect, type RefObject } from "react";
import { getItem, removeItem } from "../lib/storage";

// Прокрутка больше не уходит в облако — убрать прежние метки вкладок (и из облака тоже)
if (getItem("browser.scroll.v1") != null) removeItem("browser.scroll.v1");

type Saved = Map<string, { top: number; left: number }>;

const memory = new Map<string, Saved>();
const KEEP = 80;
/** Сколько ждём содержимое для восстановления. */
const RESTORE_MS = 8000;

function pathOf(root: Element, el: Element): string | null {
  const parts: number[] = [];
  let n: Element | null = el;
  while (n && n !== root) {
    const p: Element | null = n.parentElement;
    if (!p) return null;
    parts.push(Array.prototype.indexOf.call(p.children, n));
    n = p;
  }
  return n === root ? parts.reverse().join(".") : null;
}

function find(root: Element, path: string): Element | null {
  let n: Element | null = root;
  for (const i of path ? path.split(".") : []) {
    n = n?.children[Number(i)] ?? null;
    if (!n) return null;
  }
  return n;
}

export function useScrollMemory(ref: RefObject<HTMLElement | null>, key: string): void {
  useLayoutEffect(() => {
    const root = ref.current;
    if (!root || !key) return;
    let saved = memory.get(key);
    const pending: Saved = new Map(saved ?? []);
    if (!saved) {
      saved = new Map();
      memory.set(key, saved);
      while (memory.size > KEEP) memory.delete(memory.keys().next().value!);
    }
    const store = saved;

    let timer = 0;
    let mo: MutationObserver | null = null;
    let ro: ResizeObserver | null = null;
    const stop = () => {
      pending.clear();
      window.clearTimeout(timer);
      mo?.disconnect();
      ro?.disconnect();
      mo = ro = null;
      for (const type of ["wheel", "touchstart", "pointerdown", "keydown"]) root.removeEventListener(type, stop, true);
    };

    const restore = () => {
      for (const [path, pos] of pending) {
        const el = find(root, path);
        if (!(el instanceof HTMLElement)) continue;
        const maxTop = el.scrollHeight - el.clientHeight;
        const maxLeft = el.scrollWidth - el.clientWidth;
        if (maxTop >= pos.top - 1 && maxLeft >= pos.left - 1) {
          el.scrollTop = pos.top;
          el.scrollLeft = pos.left;
          pending.delete(path);
        } else if (maxTop > 0 && pos.top > maxTop) {
          // Не хватает высоты — вниз: лента подгрузит следующую страницу
          el.scrollTop = maxTop;
        }
      }
      if (!pending.size) stop();
    };

    const onScroll = (e: Event) => {
      const t = e.target;
      // Лента разделов главной листается своим состоянием (открытый раздел), не прокруткой
      if (!(t instanceof Element) || t.classList.contains("ax-pager")) return;
      const path = pathOf(root, t);
      // Пока восстанавливаем этот блок — его промежуточная прокрутка не в счёт
      if (path == null || pending.has(path)) return;
      store.set(path, { top: t.scrollTop, left: t.scrollLeft });
    };
    root.addEventListener("scroll", onScroll, { capture: true, passive: true });

    if (pending.size) {
      for (const type of ["wheel", "touchstart", "pointerdown", "keydown"]) root.addEventListener(type, stop, true);
      restore();
      if (pending.size) {
        mo = new MutationObserver(restore);
        mo.observe(root, { childList: true, subtree: true });
        ro = new ResizeObserver(restore);
        ro.observe(root);
        timer = window.setTimeout(stop, RESTORE_MS);
      }
    }
    return () => {
      stop();
      root.removeEventListener("scroll", onScroll, { capture: true });
    };
  }, [ref, key]);
}

