/**
 * Нижняя шторка — перенос `components/nhModal/index.tsx`.
 * Выезжает снизу (260ms), уезжает (220ms) и только потом вызывает onClose — как в старом.
 * Шапка 52px: заголовок по центру, справа крестик и `headerRight`; под ней — подсказки с иконкой «i».
 * `sizing="wrap"` — высота по содержимому до `heightPercent` экрана, `"fixed"` — ровно `heightPercent`.
 * `className` — на корень: экран может перестроить шторку под себя (например, окном по центру на ПК).
 */
import { useEffect, useState, type CSSProperties, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { useBackHandler } from "../shell/androidBack";
import { Icon } from "./Icon";

const OPEN_MS = 260;
const CLOSE_MS = 220;

export interface NhModalProps {
  visible: boolean;
  onClose: () => void;
  title?: ReactNode;
  hint?: ReactNode | ReactNode[];
  headerRight?: ReactNode;
  heightPercent?: number;
  dimBackground?: boolean;
  backdropColor?: string;
  sizing?: "wrap" | "fixed";
  sheetStyle?: CSSProperties;
  className?: string;
  children: ReactNode;
}

export function NhModal({
  visible,
  onClose,
  title,
  hint,
  headerRight,
  heightPercent = 0.85,
  dimBackground = true,
  backdropColor = "rgba(0,0,0,0.45)",
  sizing = "wrap",
  sheetStyle,
  className,
  children,
}: NhModalProps) {
  const [mounted, setMounted] = useState(visible);
  const [shown, setShown] = useState(false);

  useEffect(() => {
    if (visible) {
      setMounted(true);
      // кадр на монтирование в нижнем положении, затем анимация вверх
      const id = requestAnimationFrame(() => requestAnimationFrame(() => setShown(true)));
      return () => cancelAnimationFrame(id);
    }
    if (mounted) {
      setShown(false);
      const t = window.setTimeout(() => setMounted(false), CLOSE_MS);
      return () => window.clearTimeout(t);
    }
    // только на смену visible: mounted читается как текущее значение
  }, [visible]);

  const requestClose = () => {
    setShown(false);
    window.setTimeout(() => {
      setMounted(false);
      onClose();
    }, CLOSE_MS);
  };

  useBackHandler(mounted && shown, requestClose);

  if (!mounted) return null;

  const hints = hint == null ? [] : Array.isArray(hint) ? hint : [hint];
  const cap = `${Math.round(Math.min(1, Math.max(0.5, heightPercent)) * 100)}dvh`;

  return createPortal(
    <div className={`ui-sheet-root${shown ? " is-shown" : ""}${className ? ` ${className}` : ""}`}>
      {dimBackground && (
        <div
          className="ui-sheet-dim"
          style={{ background: `linear-gradient(to bottom, rgba(0,0,0,0) 0%, ${backdropColor} 35%, ${backdropColor} 100%)` }}
        />
      )}
      <div className="ui-backdrop" onClick={requestClose} />
      <div
        className="ui-sheet"
        role="dialog"
        aria-modal="true"
        style={{
          ...(sizing === "fixed" ? { height: cap } : { maxHeight: cap }),
          transitionDuration: `${shown ? OPEN_MS : CLOSE_MS}ms`,
          ...sheetStyle,
        }}
      >
        {(title || hints.length > 0) && (
          <>
            <div className="ui-sheet-header">
              <div className="ui-sheet-title">{title}</div>
              {headerRight ? <div className="ui-sheet-header-right">{headerRight}</div> : null}
              <button type="button" className="ui-sheet-close" aria-label="Close" onClick={requestClose}>
                <Icon name="x" size={18} />
              </button>
            </div>
            {hints.length > 0 && (
              <div className="ui-sheet-hints">
                {hints.map((h, i) => (
                  <div key={i} className="ui-sheet-hint">
                    <Icon name="info" size={14} />
                    {typeof h === "string" ? <span>{h}</span> : h}
                  </div>
                ))}
              </div>
            )}
          </>
        )}
        <div className="ui-sheet-content">{children}</div>
      </div>
    </div>,
    document.body,
  );
}
