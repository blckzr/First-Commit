import type { ButtonHTMLAttributes, ReactNode } from "react";
import styles from "./Tag.module.css";

export interface TagProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  selected?: boolean;
  children: ReactNode;
}

/** A filter chip. Selected inverts to ink rather than tinting. */
export function Tag({ selected, className, children, ...rest }: TagProps) {
  return (
    <button
      {...rest}
      type={rest.type ?? "button"}
      aria-pressed={selected}
      className={[styles.tag, selected ? styles.selected : "", className ?? ""]
        .filter(Boolean).join(" ")}
    >
      {children}
    </button>
  );
}
