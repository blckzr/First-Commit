import type { InputHTMLAttributes, ReactNode } from "react";
import { Icon } from "../core/Icon";
import styles from "./Checkbox.module.css";

export interface CheckboxProps
  extends Omit<InputHTMLAttributes<HTMLInputElement>, "type"> {
  label: ReactNode;
}

/**
 * The native input stays in the DOM and drives the visual box through CSS
 * sibling selectors, so keyboard focus, the space key, and form submission all
 * work without JavaScript.
 */
export function Checkbox({ label, className, ...rest }: CheckboxProps) {
  return (
    <label className={[styles.wrapper, className ?? ""].filter(Boolean).join(" ")}>
      <input {...rest} type="checkbox" className={styles.control} />
      <span className={styles.box} aria-hidden="true">
        <Icon name="check" size={13} className={styles.check} />
      </span>
      <span className={styles.text}>{label}</span>
    </label>
  );
}
