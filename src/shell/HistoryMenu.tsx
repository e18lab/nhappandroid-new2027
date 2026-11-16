/**
 * История переходов списком — куда можно прыгнуть «назад / вперёд».
 *  - ПК: правая кнопка мыши (или удержание) по стрелкам адресной строки — меню под стрелкой (`HistoryPopup`).
 *  - Телефон: удержание кнопки «назад» в верхней строке — шторка со страницами позади (`TopBar.tsx`).
 *    Каркас (`Shell.tsx`) отдаёт свою историю экранам через `BackStackContext`.
 */
import { createContext, useContext, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type { Location } from "react-router-dom";
import { useDismiss } from "../browser/TabStrip";
import { Icon, type IconName } from "../ui";

export interface HistoryItem {
  key: string;
  label: string;
  icon: IconName;
  run(): void;
}

/** Адреса позади открытого экрана (последний — открытый). */
export const BackStackContext = createContext<() => Location[]>(() => []);
export const useBackStack = () => useContext(BackStackContext);

/** Сколько страниц показывать в списке. */
export const HISTORY_MENU_MAX = 15;

/** ПК: меню истории под стрелкой. */
export function HistoryPopup({ anchor, items, onClose }: { anchor: HTMLElement; items: HistoryItem[]; onClose: () => void }) {
  const panel = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null);
  useDismiss(panel, onClose, anchor);

  useLayoutEffect(() => {
    const el = panel.current;
    if (!el) return;
    const r = anchor.getBoundingClientRect();
    setPos({
      left: Math.max(8, Math.min(r.left, window.innerWidth - el.offsetWidth - 8)),
      top: Math.min(r.bottom + 6, window.innerHeight - el.offsetHeight - 8),
    });
  }, [anchor]);

  return createPortal(
    <div ref={panel} className="dk-ctx dk-histmenu" role="menu" style={pos ?? { visibility: "hidden" }} onContextMenu={(e) => e.preventDefault()}>
      <div className="dk-ctx-group">
        {items.map((item) => (
          <button
            key={item.key}
            type="button"
            role="menuitem"
            className="dk-ctx-item"
            onClick={() => {
              onClose();
              item.run();
            }}
          >
            <Icon name={item.icon} size={16} />
            <span>{item.label}</span>
          </button>
        ))}
      </div>
    </div>,
    document.body,
  );
}
