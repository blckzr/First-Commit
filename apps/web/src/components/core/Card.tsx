import type { HTMLAttributes, ReactNode } from "react";
import styles from "./Card.module.css";

export interface CardProps extends HTMLAttributes<HTMLDivElement> {
  surface?: "white" | "soft" | "dark" | "inset" | "lime";
  padding?: "none" | "sm" | "md" | "lg";
  /** A 1px rule, needed only when a white card sits on white. */
  border?: boolean;
  hoverLift?: boolean;
  children: ReactNode;
}

const PADDING = { none: "padNone", sm: "padSm", md: "padMd", lg: "padLg" } as const;

export function Card({
  surface = "white",
  padding = "md",
  border,
  hoverLift,
  className,
  children,
  ...rest
}: CardProps) {
  const classes = [
    styles.card,
    styles[surface],
    styles[PADDING[padding]],
    border ? styles.bordered : "",
    hoverLift ? styles.hoverLift : "",
    className ?? "",
  ].filter(Boolean).join(" ");

  return <div {...rest} className={classes}>{children}</div>;
}
