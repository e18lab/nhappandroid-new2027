/**
 * Кнопка — перенос `components/uikit/Button.tsx`.
 * Варианты: primary (залитая акцентом), secondary, outline, ghost, chip; compact; loading; progress (кольцо).
 * Иконки получают цвет `currentColor` — он совпадает с цветом подписи варианта.
 */
import { useEffect, useRef, type CSSProperties, type ReactNode } from "react";
import { tapFeedback } from "./haptics";
import { Spinner } from "./LoadingSpinner";

export type ButtonVariant = "primary" | "secondary" | "outline" | "ghost" | "chip";
type IconProp = ReactNode | ((color: string) => ReactNode);

export interface ButtonProps {
  title: string;
  onPress?: () => void;
  onLongPress?: () => void;
  variant?: ButtonVariant;
  disabled?: boolean;
  compact?: boolean;
  loading?: boolean;
  loadingLabel?: string;
  /** 0…1 — вместо подписи кольцо прогресса; при 1 подпись появляется под кольцом. */
  progress?: number;
  leftIcon?: IconProp;
  rightIcon?: IconProp;
  iconGap?: number;
  iconOnly?: boolean;
  fullWidth?: boolean;
  accessibilityLabel?: string;
  style?: CSSProperties;
  className?: string;
}

const RING = 28;
const RING_STROKE = 3;
const RING_R = (RING - RING_STROKE) / 2;
const RING_LEN = 2 * Math.PI * RING_R;
const LONG_PRESS_MS = 400;

function renderIcon(icon: IconProp | undefined): ReactNode {
  return typeof icon === "function" ? icon("currentColor") : icon;
}

export function Button({
  title,
  onPress,
  onLongPress,
  variant = "primary",
  disabled = false,
  compact = false,
  loading = false,
  loadingLabel,
  progress,
  leftIcon,
  rightIcon,
  iconGap = 8,
  iconOnly = false,
  fullWidth = false,
  accessibilityLabel,
  style,
  className,
}: ButtonProps) {
  const busy = disabled || loading;
  const showProgress = progress !== undefined && progress >= 0;
  const left = renderIcon(leftIcon);
  const right = renderIcon(rightIcon);
  const iconOnlyMode = iconOnly || (!!(left || right) && !title);
  const small = variant === "ghost" || variant === "chip";
  const pct = Math.min(1, Math.max(0, progress ?? 0));
  const longPress = useLongPress(onLongPress, busy);

  const classes = [
    "ui-btn",
    `ui-btn-${variant}`,
    small ? "ui-btn-small" : compact ? "ui-btn-compact" : "",
    iconOnlyMode ? "ui-btn-icon-only" : "",
    fullWidth ? "ui-btn-full" : "",
    disabled ? "ui-btn-disabled" : "",
    className ?? "",
  ]
    .filter(Boolean)
    .join(" ");

  let content: ReactNode;
  if (showProgress) {
    content = (
      <span className="ui-btn-progress">
        <svg width={RING} height={RING} aria-hidden="true">
          <circle cx={RING / 2} cy={RING / 2} r={RING_R} className="ui-ring-track" strokeWidth={RING_STROKE} fill="none" />
          <circle
            cx={RING / 2}
            cy={RING / 2}
            r={RING_R}
            className="ui-ring-value"
            strokeWidth={RING_STROKE}
            fill="none"
            strokeDasharray={`${RING_LEN} ${RING_LEN}`}
            strokeDashoffset={RING_LEN - pct * RING_LEN}
            strokeLinecap="round"
            transform={`rotate(-90 ${RING / 2} ${RING / 2})`}
          />
        </svg>
        {pct >= 1 && title ? <span className="ui-btn-label">{title}</span> : null}
      </span>
    );
  } else if (loading) {
    content = (
      <span className="ui-btn-row" style={{ gap: iconGap }}>
        <Spinner size={18} />
        {!iconOnlyMode && <span className="ui-btn-label">{loadingLabel ?? title}</span>}
      </span>
    );
  } else if (iconOnlyMode) {
    content = (
      <span className="ui-btn-row" style={{ gap: iconGap }}>
        {left}
        {right}
      </span>
    );
  } else {
    content = (
      <span className="ui-btn-row" style={{ gap: iconGap }}>
        {left}
        {title ? <span className="ui-btn-label">{title}</span> : null}
        {right}
      </span>
    );
  }

  return (
    <button
      type="button"
      className={classes}
      style={style}
      disabled={busy}
      aria-busy={loading || undefined}
      aria-label={accessibilityLabel ?? (iconOnlyMode ? undefined : title)}
      onPointerDown={() => {
        if (!busy) tapFeedback();
        longPress.start();
      }}
      onPointerUp={longPress.cancel}
      onPointerLeave={longPress.cancel}
      onClick={() => {
        if (longPress.fired()) return;
        onPress?.();
      }}
    >
      {content}
    </button>
  );
}

/** Долгое нажатие без библиотек: таймер на pointerdown, отмена на up/leave, клик после него игнорируется. */
export function useLongPress(handler: (() => void) | undefined, disabled = false) {
  const timer = useRef<number | null>(null);
  const fired = useRef(false);
  const latest = useRef(handler);
  latest.current = handler;

  useEffect(
    () => () => {
      if (timer.current !== null) window.clearTimeout(timer.current);
    },
    [],
  );

  return {
    start() {
      fired.current = false;
      if (!latest.current || disabled) return;
      timer.current = window.setTimeout(() => {
        fired.current = true;
        latest.current?.();
      }, LONG_PRESS_MS);
    },
    cancel() {
      if (timer.current !== null) window.clearTimeout(timer.current);
      timer.current = null;
    },
    fired() {
      const f = fired.current;
      fired.current = false;
      return f;
    },
  };
}
