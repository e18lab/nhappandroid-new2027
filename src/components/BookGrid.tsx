/**
 * Сетка карточек — перенос сетки `components/BookList.tsx` + `config/gridConfig.ts` (`grid_config_map_v2`).
 * Колонки по профилю экрана (телефон/планшет × портрет/альбом), поля и промежуток из настроек сетки.
 */
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import type { Book } from "../api/book";
import { useEnrichedBooks } from "../lib/bookEnrich";
import { KEYS, getJSON } from "../lib/storage";
import { BookCard } from "./BookCard";

export interface GridConfig {
  numColumns: number;
  paddingHorizontal: number;
  columnGap: number;
  minColumnWidth?: number;
}

type GridProfile = "phonePortrait" | "phoneLandscape" | "tabletPortrait" | "tabletLandscape";

export const DEFAULT_GRID: Record<GridProfile, GridConfig> = {
  phonePortrait: { numColumns: 2, paddingHorizontal: 10, columnGap: 5, minColumnWidth: 80 },
  phoneLandscape: { numColumns: 4, paddingHorizontal: 10, columnGap: 5, minColumnWidth: 80 },
  tabletPortrait: { numColumns: 3, paddingHorizontal: 10, columnGap: 5, minColumnWidth: 80 },
  tabletLandscape: { numColumns: 5, paddingHorizontal: 10, columnGap: 5, minColumnWidth: 80 },
};

function gridFor(width: number, height: number): GridConfig {
  const map = { ...DEFAULT_GRID, ...getJSON<Partial<Record<GridProfile, GridConfig>>>(KEYS.gridConfig, {}) };
  const tablet = Math.min(width, height) >= 600;
  const landscape = width > height;
  const profile: GridProfile = tablet
    ? landscape
      ? "tabletLandscape"
      : "tabletPortrait"
    : landscape
      ? "phoneLandscape"
      : "phonePortrait";
  return map[profile];
}

/** Ширина карточки: колонок не больше, чем влезает при minColumnWidth (как в старом BookList). */
function layout(containerW: number, cfg: GridConfig) {
  const pad = cfg.paddingHorizontal ?? 0;
  const gap = cfg.columnGap ?? 0;
  const minW = cfg.minColumnWidth ?? 80;
  const avail = Math.max(0, containerW - pad * 2);
  const cols = Math.max(1, Math.min(cfg.numColumns, Math.floor((avail + gap) / (minW + gap))));
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
    return () => window.removeEventListener("resize", onResize);
  }, []);

  return { host, ready: size.w > 0, ...layout(size.w, gridFor(window.innerWidth, size.h)) };
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
