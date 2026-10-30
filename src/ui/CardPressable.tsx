/**
 * Нажимаемая область с подсветкой и лёгким сжатием — перенос `components/ui/CardPressable.tsx` и `IconBtn.tsx`.
 */
import type { CSSProperties, ReactNode } from "react";
import { useLongPress } from "./Button";
import { tapFeedback } from "./haptics";

export interface CardPressableProps {
  children: ReactNode;
  radius?: number;
  onPress?: () => void;
  onLongPress?: () => void;
  disabled?: boolean;
  /** Цвет подсветки при нажатии (в старом — overlayColor). */
  overlayColor?: string;
  pressedScale?: number;
  /** Вибрация при нажатии. */
  feedback?: boolean;
  accessibilityLabel?: string;
  style?: CSSProperties;
  className?: string;
}

export function CardPressable({
  children,
  radius = 14,
  onPress,
  onLongPress,
  disabled = false,
  overlayColor,
  pressedScale = 0.97,
  feedback = true,
  accessibilityLabel,
  style,
  className,
}: CardPressableProps) {
  const longPress = useLongPress(onLongPress, disabled);
  return (
    <button
      type="button"
      className={className ? `ui-pressable ${className}` : "ui-pressable"}
      disabled={disabled}
      aria-label={accessibilityLabel}
      style={
        {
          borderRadius: radius,
          "--press-scale": pressedScale,
          "--press-overlay": overlayColor ?? "rgba(255,255,255,0.10)",
          ...style,
        } as CSSProperties
      }
      onPointerDown={() => {
        if (feedback && !disabled) tapFeedback();
        longPress.start();
      }}
      onPointerUp={longPress.cancel}
      onPointerLeave={longPress.cancel}
      onClick={() => {
        if (!longPress.fired()) onPress?.();
      }}
    >
      {children}
    </button>
  );
}

export function IconBtn({
  children,
  onPress,
  onLongPress,
  size = 36,
  radius = 10,
  shape = "rounded",
  overlayColor,
  accessibilityLabel,
}: {
  children: ReactNode;
  onPress?: () => void;
  onLongPress?: () => void;
  size?: number;
  radius?: number;
  shape?: "circle" | "rounded" | "square";
  overlayColor?: string;
  accessibilityLabel?: string;
}) {
  const r = shape === "circle" ? size / 2 : shape === "square" ? 0 : radius;
  return (
    <CardPressable
      onPress={onPress}
      onLongPress={onLongPress}
      radius={r}
      overlayColor={overlayColor}
      pressedScale={0.96}
      accessibilityLabel={accessibilityLabel}
      className="ui-icon-btn"
      style={{ width: size, height: size }}
    >
      {children}
    </CardPressable>
  );
}
