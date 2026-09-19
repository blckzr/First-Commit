import { useId } from "react";
import type { SelectHTMLAttributes } from "react";
import { Icon } from "../core/Icon";
import styles from "./Select.module.css";

export interface SelectOption {
  value: string;
  label: string;
}

export interface SelectProps extends SelectHTMLAttributes<HTMLSelectElement> {
  label?: string;
  options: SelectOption[];
}

export function Select({ label, options, className, id, ...rest }: SelectProps) {
  const autoId = useId();
  const selectId = id ?? autoId;

  return (
    <div className={[styles.field, className ?? ""].filter(Boolean).join(" ")}>
      {label && <label className={styles.label} htmlFor={selectId}>{label}</label>}
      <span className={styles.shell}>
        <select {...rest} id={selectId} className={styles.control}>
          {options.map((o) => (
            <option key={o.value} value={o.value}>{o.label}</option>
          ))}
        </select>
        <Icon name="chevron-down" size={16} />
      </span>
    </div>
  );
}
