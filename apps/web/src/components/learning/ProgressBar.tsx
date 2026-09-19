import styles from "./ProgressBar.module.css";

export interface ProgressBarProps {
  /** 0-100. */
  value: number;
  /** design.md §7: a progress bar is always paired with text ("6 of 16 passed"). */
  label: string;
  showValue?: boolean;
  height?: number;
  onDark?: boolean;
  className?: string;
}

export function ProgressBar({
  value, label, showValue, height = 8, onDark, className,
}: ProgressBarProps) {
  const clamped = Math.max(0, Math.min(100, value));

  return (
    <div className={[onDark ? styles.onDark : "", className ?? ""]
      .filter(Boolean).join(" ")}>
      <div className={styles.header}>
        <span>{label}</span>
        {showValue && <span className={styles.value}>{Math.round(clamped)}%</span>}
      </div>
      <div
        className={styles.track}
        style={{ height }}
        role="progressbar"
        aria-valuenow={Math.round(clamped)}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-label={label}
      >
        <div className={styles.fill} style={{ width: `${clamped}%` }} />
      </div>
    </div>
  );
}
