import { useId } from "react";
import type { InputHTMLAttributes } from "react";
import { Icon } from "../core/Icon";
import styles from "./SearchField.module.css";

export interface SearchFieldProps
  extends Omit<InputHTMLAttributes<HTMLInputElement>, "type"> {
  /** Visually hidden but read by screen readers; the field has no visible label. */
  label: string;
}

/** The search pill. The only input the system allows a pill shape. */
export function SearchField({ label, className, id, ...rest }: SearchFieldProps) {
  const autoId = useId();
  const inputId = id ?? autoId;

  return (
    <span className={[styles.shell, className ?? ""].filter(Boolean).join(" ")}>
      <Icon name="search" size={16} />
      <label htmlFor={inputId} hidden>{label}</label>
      <input {...rest} id={inputId} type="search" className={styles.control} />
    </span>
  );
}
