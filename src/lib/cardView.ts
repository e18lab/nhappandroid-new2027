/**
 * Вид карточек книг (Настройки → Карточки): как показывать книги в ленте и в библиотеке и что на них писать.
 *  - `list` — строкой: обложка слева, справа название, язык/страницы/лайки и теги (как список в Anixart);
 *  - `compact` — строкой поменьше, без тегов: больше книг на экране;
 *  - `grid` — плиткой-постером (как карточка релиза в Anixart), колонки — из настроек сетки;
 *  - `classic` — карточка 1.3.1 с цветными чипами тегов.
 * Хранится в `ui.cards.v1`; меняется сразу во всех открытых лентах.
 */
import { useSyncExternalStore } from "react";
import { KEYS, getJSON, setJSON, subscribe } from "./storage";

export type CardViewKind = "list" | "compact" | "grid" | "classic";

export interface CardShow {
  /** Теги под названием (в строке) */
  tags: boolean;
  /** Язык, страницы, лайки */
  meta: boolean;
  /** Метка «Новое» у загруженных за 2 часа */
  newBadge: boolean;
  /** Дата загрузки */
  date: boolean;
}

export interface CardView {
  view: CardViewKind;
  show: CardShow;
}

export const CARD_VIEWS: CardViewKind[] = ["list", "compact", "grid", "classic"];

const DEFAULT: CardView = { view: "list", show: { tags: true, meta: true, newBadge: true, date: false } };

let cached: { raw: string; value: CardView } | null = null;

function read(): CardView {
  const stored = getJSON<Partial<CardView> | null>(KEYS.cardView, null);
  const raw = JSON.stringify(stored);
  if (cached && cached.raw === raw) return cached.value;
  const value: CardView = {
    view: stored?.view && CARD_VIEWS.includes(stored.view) ? stored.view : DEFAULT.view,
    show: { ...DEFAULT.show, ...(stored?.show ?? {}) },
  };
  cached = { raw, value };
  return value;
}

export function getCardView(): CardView {
  return read();
}

export function setCardView(patch: { view?: CardViewKind; show?: Partial<CardShow> }): void {
  const cur = read();
  setJSON(KEYS.cardView, { view: patch.view ?? cur.view, show: { ...cur.show, ...(patch.show ?? {}) } });
}

/** Текущий вид карточек; компонент перерисуется, когда его поменяют в настройках. */
export function useCardView(): CardView {
  return useSyncExternalStore(
    (cb) => subscribe((key) => key === KEYS.cardView && cb()),
    read,
  );
}
