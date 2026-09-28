import type { ButtonHTMLAttributes, ComponentProps } from "react";
import { Link } from "react-router";
import { Icon } from "./Icon";
import type { IconName } from "./Icon";
import styles from "./IconButton.module.css";

export interface IconButtonProps
  extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, "children"> {
  icon: IconName;
  /** Required: the button has no visible text, so it needs an accessible name. */
  label: string;
  variant?: "soft" | "lime" | "dark" | "bare";
  size?: "sm" | "md" | "lg";
}

export function IconButton({
  icon,
  label,
  variant = "soft",
  size = "md",
  className,
  ...rest
}: IconButtonProps) {
  return (
    <button
      {...rest}
      type={rest.type ?? "button"}
      aria-label={label}
      className={[styles.iconButton, styles[variant], styles[size], className ?? ""]
        .filter(Boolean).join(" ")}
    >
      <Icon name={icon} size={size === "sm" ? 16 : 18} />
    </button>
  );
}

export interface IconLinkProps extends Omit<ComponentProps<typeof Link>, "children"> {
  icon: IconName;
  /** Required: the link has no visible text, so it needs an accessible name. */
  label: string;
  variant?: IconButtonProps["variant"];
  size?: IconButtonProps["size"];
}

/**
 * An icon-only control that navigates — the learner bar's bell. Kept apart
 * from `IconButton` for the reason `LinkButton` is kept apart from `Button`:
 * a link must be an <a>. They share one stylesheet.
 */
export function IconLink({
  icon,
  label,
  variant = "soft",
  size = "md",
  className,
  ...rest
}: IconLinkProps) {
  return (
    <Link
      {...rest}
      aria-label={label}
      className={[styles.iconButton, styles[variant], styles[size], className ?? ""]
        .filter(Boolean).join(" ")}
    >
      <Icon name={icon} size={size === "sm" ? 16 : 18} />
    </Link>
  );
}
