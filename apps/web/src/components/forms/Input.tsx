import { useId } from "react";
import type { InputHTMLAttributes } from "react";
import { Icon } from "../core/Icon";
import type { IconName } from "../core/Icon";
import styles from "./Input.module.css";

export interface InputProps extends Omit<InputHTMLAttributes<HTMLInputElement>, "size"> {
  label?: string;
  hint?: string;
  /** design.md §9: errors explain and direct — "Enter weekly hours as a
   *  number between 1 and 40", not "Invalid input". */
  error?: string;
  icon?: IconName;
  size?: "sm" | "md";
}

/**
 * design.md §12 requires visible labels and errors linked to their field, so
 * the message is wired with aria-describedby and aria-invalid rather than
 * being visual-only as it was in the design system.
 */
export function Input({
  label, hint, error, icon, size = "md", className, id, ...rest
}: InputProps) {
  const autoId = useId();
  const inputId = id ?? autoId;
  const messageId = `${inputId}-message`;
  const message = error ?? hint;

  return (
    <div className={[styles.field, className ?? ""].filter(Boolean).join(" ")}>
      {label && (
        <label className={styles.label} htmlFor={inputId}>{label}</label>
      )}
      <span className={[styles.shell, styles[size], error ? styles.invalid : ""]
        .filter(Boolean).join(" ")}>
        {icon && <Icon name={icon} size={17} />}
        <input
          {...rest}
          id={inputId}
          className={styles.control}
          aria-invalid={error ? true : undefined}
          aria-describedby={message ? messageId : undefined}
        />
      </span>
      {message && (
        <span
          id={messageId}
          className={[styles.message, error ? styles.errorMessage : ""]
            .filter(Boolean).join(" ")}
        >
          {message}
        </span>
      )}
    </div>
  );
}
