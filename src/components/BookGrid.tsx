/**
 * Сетка карточек — перенос сетки `components/BookList.tsx` + `config/gridConfig.ts` (`grid_config_map_v2`).
 * Колонки по профилю экрана (телефон/планшет × портрет/альбом), поля и промежуток из настроек сетки.
 */
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import type { Book } from "../api/book";
import { useEnrichedBooks } from "../lib/bookEnrich";
import { IS_DESKTOP } from "../lib/platform";
import { KEYS, getJSON, setJSON } from "../lib/storage";
import { BookCard } from "./BookCard";

export interface GridConfig {
  numColumns: number;
  paddingHorizontal: number;
  columnGap: number;
  minColumnWidth?: number;
  /** ПК: желаемая ширина карточки — колонок столько, сколько таких карточек влезает в окно. */
  cardWidth?: number;
}

const MAX_COLUMNS = 16;

export type GridProfile = "phonePortrait" | "phoneLandscape" | "tabletPortrait" | "tabletLandscape" | "desktop";

export const DEFAULT_GRID: Record<GridProfile, GridConfig> = {
  phonePortrait: { numColumns: 2, paddingHorizontal: 10, columnGap: 5, minColumnWidth: 80 },
  phoneLandscape: { numColumns: 4, paddingHorizontal: 10, columnGap: 5, minColumnWidth: 80 },
  tabletPortrait: { numColumns: 3, paddingHorizontal: 10, columnGap: 5, minColumnWidth: 80 },
  tabletLandscape: { numColumns: 5, paddingHorizontal: 10, columnGap: 5, minColumnWidth: 80 },
  desktop: { numColumns: 0, paddingHorizontal: 16, columnGap: 12, cardWidth: 230 },
};



const GRID_EVENT = "nh-grid-config";

export function loadGridConfig(): Record<GridProfile, GridConfig> {
  return { ...DEFAULT_GRID, ...getJSON<Partial<Record<GridProfile, GridConfig>>>(KEYS.gridConfig, {}) };
}

/** Сохранить настройки сетки — открытые сетки (лента, предпросмотр) сразу перестраиваются. */
export function saveGridConfig(map: Record<GridProfile, GridConfig>) {
  setJSON(KEYS.gridConfig, map);
  window.dispatchEvent(new Event(GRID_EVENT));
}

/** Профиль экрана: ПК; иначе телефон или планшет (меньшая сторона от 600), портрет или ландшафт. */
export function gridProfileFor(width: number, height: number): GridProfile {
  // У окна на ПК нет «портрета» и «планшета» — сетка подстраивается под ширину
  if (IS_DESKTOP) return "desktop";
  const tablet = Math.min(width, height) >= 600;
  const landscape = width > height;
  return tablet ? (landscape ? "tabletLandscape" : "tabletPortrait") : landscape ? "phoneLandscape" : "phonePortrait";
}

function gridFor(width: number, height: number): GridConfig {
  return loadGridConfig()[gridProfileFor(width, height)];
}

/**
 * Ширина карточки. На ПК (`cardWidth`) — колонок столько, сколько карточек такой ширины влезает:
 * на мониторе 2K их больше, на ноутбуке меньше, а сама карточка почти одного размера.
 * На телефоне и планшете — сколько задано, но не больше, чем влезает при minColumnWidth (как в BookList).
 */
export function gridLayout(containerW: number, cfg: GridConfig) {
  const pad = cfg.paddingHorizontal ?? 0;
  const gap = cfg.columnGap ?? 0;
  const avail = Math.max(0, containerW - pad * 2);
  const cols = cfg.cardWidth
    ? Math.max(1, Math.min(MAX_COLUMNS, Math.round((avail + gap) / (cfg.cardWidth + gap))))
    : Math.max(1, Math.min(cfg.numColumns, Math.floor((avail + gap) / ((cfg.minColumnWidth ?? 80) + gap))));
  return { cols, cardWidth: (avail - gap * (cols - 1)) / cols, pad, gap };
}

/** Размеры сетки для контейнера: колонки, ширина карточки, поля и промежуток (как в BookList). */
export function useGridMetrics() {
  const host = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ w: 0, h: window.innerHeight });

  useLayoutEffect(() => {
    const el = host.current;
    if (!el) return;
    // clientWidth округляет дробную ширину вверх (393,85 → 394 при плотности 3,25), и ряд не влезает
    const update = () => setSize({ w: Math.floor(el.getBoundingClientRect().width), h: window.innerHeight });
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  useEffect(() => {
    const onResize = () => setSize((s) => ({ ...s, h: window.innerHeight }));
    window.addEventListener("resize", onResize);
    window.addEventListener(GRID_EVENT, onResize);
    return () => {
      window.removeEventListener("resize", onResize);
      window.removeEventListener(GRID_EVENT, onResize);
    };
  }, []);

  return { host, ready: size.w > 0, ...gridLayout(size.w, gridFor(window.innerWidth, size.h)) };
}

export function BookGrid({ books, onPress }: { books: Book[]; onPress: (book: Book) => void }) {
  const { host, ready, cardWidth, pad, gap } = useGridMetrics();
  const enriched = useEnrichedBooks(books);

  return (
    <div ref={host} className="book-grid" style={{ padding: `${pad / 2}px ${pad}px`, gap }}>
      {ready && enriched.map((b) => <BookCard key={b.id} book={b} cardWidth={cardWidth} onPress={onPress} />)}
    </div>
  );
}
