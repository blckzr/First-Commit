import type { InputHTMLAttributes, ReactNode } from "react";
import styles from "./RadioOption.module.css";

export interface RadioOptionProps
  extends Omit<InputHTMLAttributes<HTMLInputElement>, "type"> {
  label: ReactNode;
}

/**
 * Group these inside a <fieldset> with a <legend> — design.md §12 announces the
 * decision node's options as a radio group, and the recommendation must be read
 * as text, not shown only as a visual label.
 */
export function RadioOption({ label, className, ...rest }: RadioOptionProps) {
  return (
    <label className={[styles.wrapper, className ?? ""].filter(Boolean).join(" ")}>
      <input {...rest} type="radio" className={styles.control} />
      <span className={styles.dot} aria-hidden="true">
        <span className={styles.pip} />
      </span>
      <span className={styles.text}>{label}</span>
    </label>
  );
}
