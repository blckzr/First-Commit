import type { HTMLAttributes, ReactNode } from "react";
import styles from "./Card.module.css";

export interface CardProps extends HTMLAttributes<HTMLElement> {
  /**
   * The element to render. A panel is often a list item — the technology
   * options are a `<ul>` of them — and wrapping a card in an `<li>` just to
   * satisfy the list adds an element that means nothing.
   */
  as?: "div" | "li" | "section" | "article" | "header";
  surface?: "white" | "soft" | "dark" | "inset" | "lime";
  padding?: "none" | "sm" | "md" | "lg";
  /**
   * design.md §3.4 — the radii nest: a 14px tile inside a 20px card inside a
   * 28px panel. A card that *is* a section of the page is a panel; a card
   * sitting inside one keeps the 20px default.
   */
  radius?: "card" | "panel";
  /** A 1px rule, needed only when a white card sits on white. */
  border?: boolean;
  hoverLift?: boolean;
  children: ReactNode;
}

const PADDING = { none: "padNone", sm: "padSm", md: "padMd", lg: "padLg" } as const;

export function Card({
  as: Tag = "div",
  surface = "white",
  padding = "md",
  radius = "card",
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
    radius === "panel" ? styles.panel : "",
    border ? styles.bordered : "",
    hoverLift ? styles.hoverLift : "",
    className ?? "",
  ].filter(Boolean).join(" ");

  return <Tag {...rest} className={classes}>{children}</Tag>;
}
