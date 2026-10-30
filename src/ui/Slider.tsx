/**
 * Ползунок-полоса — перенос `components/uikit/Slider.tsx`.
 * Полоса 44px: заливка до значения, вертикальная риска, по краям min/max, в центре значение.
 * Перетаскивание (после сдвига на 15px) меняет значение; тап — переход к точке;
 * тап в центральную треть — ручной ввод числа (как в старом).
 */
import { useRef, useState } from "react";
import { ResetButton } from "./ResetButton";

export interface SliderProps {
  min: number;
  max: number;
  step?: number;
  value: number;
  onChange?: (value: number) => void;
  defaultValue?: number;
  label?: string;
  unit?: string;
  showValue?: boolean;
  editable?: boolean;
  disabled?: boolean;
  resetText?: string;
  description?: string;
  accessibilityLabel?: string;
}

const TAP_MOVE_THRESHOLD_PX = 15;

const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n));

function snap(n: number, step: number, min: number): number {
  if (step <= 0) return n;
  const snapped = Math.round((n - min) / step) * step + min;
  // убираем хвосты плавающей точки (0.1 + 0.2)
  const decimals = (String(step).split(".")[1] ?? "").length;
  return Number(snapped.toFixed(decimals));
}

export function Slider({
  min,
  max,
  step = 1,
  value,
  onChange,
  defaultValue,
  label,
  unit = "",
  showValue = true,
  editable = true,
  disabled = false,
  resetText = "Reset",
  description,
  accessibilityLabel,
}: SliderProps) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");
  const [dragging, setDragging] = useState(false);
  const bar = useRef<HTMLDivElement>(null);
  const drag = useRef({ startX: 0, moved: false, pointerId: -1 });

  const range = Math.max(0.00001, max - min);
  const v = clamp(value, min, max);
  const pct = ((v - min) / range) * 100;

  const commit = (n: number) => onChange?.(clamp(snap(n, step, min), min, max));

  const valueAt = (clientX: number) => {
    const rect = bar.current?.getBoundingClientRect();
    if (!rect || rect.width <= 0) return v;
    return min + clamp((clientX - rect.left) / rect.width, 0, 1) * range;
  };

  const startEdit = () => {
    if (!editable || disabled) return;
    setDraft(String(v));
    setEditing(true);
  };

  const stopEdit = (apply: boolean) => {
    if (apply) {
      const num = Number(draft.replace(",", "."));
      if (Number.isFinite(num)) commit(num);
    }
    setEditing(false);
  };

  return (
    <div className={disabled ? "ui-slider ui-disabled" : "ui-slider"}>
      {(label != null || defaultValue !== undefined) && (
        <div className="ui-label-row">
          <span className="ui-label">{label}</span>
          {defaultValue !== undefined && (
            <ResetButton visible={value !== defaultValue} text={resetText} onPress={() => onChange?.(defaultValue)} />
          )}
        </div>
      )}
      <div
        ref={bar}
        role="slider"
        tabIndex={disabled ? -1 : 0}
        aria-label={accessibilityLabel ?? label}
        aria-valuemin={min}
        aria-valuemax={max}
        aria-valuenow={v}
        aria-disabled={disabled || undefined}
        className={dragging ? "ui-slider-bar is-dragging" : "ui-slider-bar"}
        onKeyDown={(e) => {
          if (disabled || editing) return;
          if (e.key === "ArrowLeft" || e.key === "ArrowDown") commit(v - step);
          else if (e.key === "ArrowRight" || e.key === "ArrowUp") commit(v + step);
          else if (e.key === "Enter") startEdit();
          else return;
          e.preventDefault();
        }}
        onPointerDown={(e) => {
          if (disabled || editing) return;
          drag.current = { startX: e.clientX, moved: false, pointerId: e.pointerId };
          e.currentTarget.setPointerCapture(e.pointerId);
          setDragging(true);
        }}
        onPointerMove={(e) => {
          if (!dragging || e.pointerId !== drag.current.pointerId) return;
          if (Math.abs(e.clientX - drag.current.startX) > TAP_MOVE_THRESHOLD_PX) drag.current.moved = true;
          if (drag.current.moved) commit(valueAt(e.clientX));
        }}
        onPointerUp={(e) => {
          if (!dragging) return;
          setDragging(false);
          if (drag.current.moved) return;
          const rect = bar.current?.getBoundingClientRect();
          const rel = rect ? (drag.current.startX - rect.left) / rect.width : 0;
          if (rel >= 0.3 && rel <= 0.7 && editable) startEdit();
          else commit(valueAt(e.clientX));
        }}
        onPointerCancel={() => setDragging(false)}
      >
        <div className="ui-slider-fill" style={{ width: `${pct}%` }} />
        <div className="ui-slider-edge" style={{ left: `${pct}%` }} />
        <div className="ui-slider-content">
          <span className="ui-slider-limit">
            {min}
            {unit}
          </span>
          {showValue &&
            (editing ? (
              <input
                className="ui-slider-input"
                value={draft}
                inputMode="decimal"
                autoFocus
                onFocus={(e) => e.currentTarget.select()}
                onChange={(e) => setDraft(e.target.value)}
                onBlur={() => stopEdit(true)}
                onPointerDown={(e) => e.stopPropagation()}
                onKeyDown={(e) => {
                  if (e.key === "Enter") stopEdit(true);
                  if (e.key === "Escape") stopEdit(false);
                  e.stopPropagation();
                }}
              />
            ) : (
              <span className="ui-slider-value">
                {v}
                {unit ? <span className="ui-slider-unit">{unit}</span> : null}
              </span>
            ))}
          <span className="ui-slider-limit">
            {max}
            {unit}
          </span>
        </div>
      </div>
      {description ? <p className="ui-description">{description}</p> : null}
    </div>
  );
}
