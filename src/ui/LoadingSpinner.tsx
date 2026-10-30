/**
 * Индикатор загрузки — замена `ActivityIndicator` и перенос `components/LoadingSpinner.tsx`.
 */

/** Кольцо-спиннер; цвет по умолчанию — текущий цвет текста. */
export function Spinner({ size = 20, color }: { size?: number; color?: string }) {
  return (
    <span
      className="ui-spinner"
      role="progressbar"
      aria-busy="true"
      style={{ width: size, height: size, color, borderWidth: Math.max(2, Math.round(size / 10)) }}
    />
  );
}

/** Спиннер по центру области (или всего экрана) с подписью под ним. Цвет — акцент, как в старом. */
export function LoadingSpinner({
  size = "large",
  color,
  fullScreen = false,
  message,
}: {
  size?: "small" | "large";
  color?: string;
  fullScreen?: boolean;
  message?: string;
}) {
  return (
    <div className={fullScreen ? "ui-loading ui-loading-full" : "ui-loading"}>
      <Spinner size={size === "large" ? 36 : 20} color={color ?? "var(--accent)"} />
      {message ? <p className="ui-loading-message">{message}</p> : null}
    </div>
  );
}
