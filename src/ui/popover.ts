/**
 * Расчёт положения выпадающей панели относительно кнопки — общий для Select и FilterDropdown.
 * Логика старого кита: открываться вниз, если снизу хватает места (или снизу места больше, чем сверху),
 * иначе вверх; не вылезать за края экрана с отступом 12px.
 */
export const SCREEN_MARGIN = 12;

export interface Anchor {
  x: number;
  y: number;
  w: number;
  h: number;
}

export function measure(el: Element | null): Anchor {
  const r = el?.getBoundingClientRect();
  return r ? { x: r.left, y: r.top, w: r.width, h: r.height } : { x: 0, y: 0, w: 200, h: 40 };
}

export function placePanel(opts: {
  anchor: Anchor;
  width: number;
  estimatedHeight: number;
  maxHeight: number;
  gap: number;
}): { top: number; left: number; maxHeight: number; opensBelow: boolean } {
  const { anchor, width, estimatedHeight, maxHeight, gap } = opts;
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  const spaceBelow = vh - anchor.y - anchor.h - SCREEN_MARGIN;
  const spaceAbove = anchor.y - SCREEN_MARGIN;
  const wanted = Math.min(estimatedHeight, maxHeight);
  const opensBelow = spaceBelow >= wanted || spaceBelow >= spaceAbove;

  const room = Math.max((opensBelow ? spaceBelow : spaceAbove) - gap, 100);
  const height = Math.min(maxHeight, room);
  const top = opensBelow
    ? anchor.y + anchor.h + gap
    : Math.max(SCREEN_MARGIN, anchor.y - Math.min(wanted, height) - gap);

  let left = anchor.x;
  if (left + width > vw - SCREEN_MARGIN) left = vw - width - SCREEN_MARGIN;
  if (left < SCREEN_MARGIN) left = SCREEN_MARGIN;

  return { top, left, maxHeight: height, opensBelow };
}
