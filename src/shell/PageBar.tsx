/**
 * Панель страницы — её элементы управления живут в верхней панели, а не в ленте: «N всего» и сортировка
 * разделов библиотеки, поиск в онлайн-избранном, действия книги…
 *  - ПК: строка в панели заголовка окна под адресом (`DesktopChrome.tsx`); внутренние экраны кладут туда же
 *    строку «назад + заголовок» (`TopBar`), а их действия — справа в ней;
 *  - телефон: на главной — строка под вкладками разделов, на внутренних экранах — строка под заголовком.
 * Экран пишет `<PageBar>…</PageBar>`: содержимое уходит порталом в слот, пока экран открыт (выбранная вкладка
 * браузера, верхний слой, открытая страница ленты главной). Контекст (роутер, i18n) сохраняется.
 */
import { createContext, useContext, useSyncExternalStore, type ReactNode } from "react";
import { createPortal } from "react-dom";

interface Slot {
  /** Куда класть; null — слот ещё не смонтирован или его нет. */
  target: HTMLElement | null;
  /** Слой открыт (не уходящий, не под окном, вкладка выбрана). */
  active: boolean;
}

const SlotContext = createContext<Slot>({ target: null, active: false });
/** Открыта ли страница ленты главной (лента перерисовывает страницы только при смене открытой). */
const PageActiveContext = createContext(true);

export const PageBarSlot = SlotContext.Provider;
export const PageBarPageActive = PageActiveContext.Provider;
export const usePageBarSlot = () => useContext(SlotContext);

export function PageBar({ children }: { children: ReactNode }) {
  const { target, active } = useContext(SlotContext);
  const pageActive = useContext(PageActiveContext);
  return target && active && pageActive ? createPortal(children, target) : null;
}

// ─── ПК: строка в панели заголовка окна ───────────────────────────────────────

let deskTarget: HTMLElement | null = null;
const listeners = new Set<() => void>();

export function setDeskBarTarget(el: HTMLElement | null): void {
  if (el === deskTarget) return;
  deskTarget = el;
  for (const fn of listeners) fn();
}

export function useDeskBarTarget(): HTMLElement | null {
  return useSyncExternalStore(
    (cb) => {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
    () => deskTarget,
  );
}
