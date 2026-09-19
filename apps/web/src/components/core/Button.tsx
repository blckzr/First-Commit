import type { ButtonHTMLAttributes, ReactNode } from "react";
import { Icon } from "./Icon";
import type { IconName } from "./Icon";
import styles from "./Button.module.css";

export type ButtonVariant =
  | "primary"
  | "secondary"
  | "dark"
  | "outline"
  | "ghost"
  | "destructive";

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: "sm" | "md" | "lg";
  icon?: IconName;
  iconPosition?: "left" | "right";
  fullWidth?: boolean;
  /** Label shown while an action runs, e.g. "Running tests…" (design.md §7.1). */
  loadingLabel?: string;
  loading?: boolean;
  children: ReactNode;
}

/**
 * design.md §9: one primary button per view, and the label states the action
 * ("Run tests", never "Submit"). The design system's rule is that every CTA
 * moving the learner forward trails an `arrow-right`.
 *
 * Hover and press are CSS, not React state — the original used onMouseEnter /
 * onMouseDown, which re-rendered on every interaction and gave keyboard users
 * no focus treatment at all.
 */
export function Button({
  variant = "primary",
  size = "md",
  icon,
  iconPosition = "right",
  fullWidth,
  loading,
  loadingLabel,
  disabled,
  className,
  children,
  ...rest
}: ButtonProps) {
  const classes = [
    styles.button,
    styles[variant],
    styles[size],
    fullWidth ? styles.fullWidth : "",
    className ?? "",
  ]
    .filter(Boolean)
    .join(" ");

  const iconSize = size === "sm" ? 15 : 17;

  return (
    <button
      {...rest}
      className={classes}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
    >
      {icon && iconPosition === "left" && <Icon name={icon} size={iconSize} />}
      <span>{loading && loadingLabel ? loadingLabel : children}</span>
      {icon && iconPosition === "right" && <Icon name={icon} size={iconSize} />}
    </button>
  );
}
