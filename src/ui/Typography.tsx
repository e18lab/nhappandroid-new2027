/**
 * Типографика — перенос `components/uikit/Typography.tsx` (те же размеры, начертания, межбуквенные интервалы)
 * и `components/ui/Section.tsx` (заголовок раздела с разделителем).
 */
import type { CSSProperties, ElementType, ReactNode } from "react";

export type TypographyVariant =
  | "h1"
  | "h2"
  | "h3"
  | "h4"
  | "body"
  | "bodySmall"
  | "caption"
  | "label"
  | "overline";

const TAGS: Record<TypographyVariant, ElementType> = {
  h1: "h1",
  h2: "h2",
  h3: "h3",
  h4: "h4",
  body: "p",
  bodySmall: "p",
  caption: "span",
  label: "span",
  overline: "span",
};

export function Typography({
  variant = "body",
  muted = false,
  as,
  children,
  style,
}: {
  variant?: TypographyVariant;
  /** Вторичный цвет (`--sub`). */
  muted?: boolean;
  as?: ElementType;
  children: ReactNode;
  style?: CSSProperties;
}) {
  const Tag = as ?? TAGS[variant];
  return (
    <Tag className={`ui-type ui-type-${variant}${muted ? " ui-muted" : ""}`} style={style}>
      {children}
    </Tag>
  );
}

export function Section({
  title,
  color,
  dividerColor,
  dense = false,
  style,
}: {
  title?: string;
  color?: string;
  dividerColor?: string;
  dense?: boolean;
  style?: CSSProperties;
}) {
  return (
    <div className="ui-section" style={style}>
      {title ? (
        <div className={dense ? "ui-section-title ui-section-dense" : "ui-section-title"} style={{ color }}>
          {title}
        </div>
      ) : null}
      <div className="ui-section-divider" style={{ background: dividerColor }} />
    </div>
  );
}
