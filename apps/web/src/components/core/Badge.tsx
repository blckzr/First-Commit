import type { HTMLAttributes, ReactNode } from "react";
import { Icon } from "./Icon";
import type { IconName } from "./Icon";
import styles from "./Badge.module.css";

export type BadgeTone =
  | "lime" | "dark" | "violet" | "neutral" | "onDark"
  | "verified" | "error" | "notice" | "here" | "ai";

export interface BadgeProps extends HTMLAttributes<HTMLSpanElement> {
  tone?: BadgeTone;
  icon?: IconName;
  uppercase?: boolean;
  children: ReactNode;
}

/**
 * design.md §8: every status carries an icon AND text AND colour. Pass `icon`
 * whenever this badge is reporting a status rather than labelling a category.
 */
export function Badge({
  tone = "lime",
  icon,
  uppercase,
  className,
  children,
  ...rest
}: BadgeProps) {
  const classes = [
    styles.badge,
    styles[tone],
    uppercase ? styles.uppercase : "",
    className ?? "",
  ].filter(Boolean).join(" ");

  return (
    <span {...rest} className={classes}>
      {icon && <Icon name={icon} size={13} />}
      {children}
    </span>
  );
}
