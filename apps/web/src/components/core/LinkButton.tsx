import { Link } from "react-router";
import type { ComponentProps, ReactNode } from "react";
import { Icon } from "./Icon";
import type { IconName } from "./Icon";
import type { ButtonVariant } from "./Button";
import styles from "./Button.module.css";

export interface LinkButtonProps extends Omit<ComponentProps<typeof Link>, "children"> {
  variant?: ButtonVariant;
  size?: "sm" | "md" | "lg";
  icon?: IconName;
  iconPosition?: "left" | "right";
  fullWidth?: boolean;
  children: ReactNode;
}

/**
 * A navigation control that looks like a button.
 *
 * Kept separate from `Button` because the two are different elements with
 * different semantics — a link navigates and must be an <a>, a button acts.
 * Nesting one inside the other is invalid HTML and breaks keyboard behaviour.
 * They share Button.module.css so there is still one set of button styles.
 */
export function LinkButton({
  variant = "primary",
  size = "md",
  icon,
  iconPosition = "right",
  fullWidth,
  className,
  children,
  ...rest
}: LinkButtonProps) {
  const classes = [
    styles.button,
    styles[variant],
    styles[size],
    fullWidth ? styles.fullWidth : "",
    className ?? "",
  ].filter(Boolean).join(" ");

  const iconSize = size === "sm" ? 15 : 17;

  return (
    <Link {...rest} className={classes}>
      {icon && iconPosition === "left" && <Icon name={icon} size={iconSize} />}
      <span>{children}</span>
      {icon && iconPosition === "right" && <Icon name={icon} size={iconSize} />}
    </Link>
  );
}
