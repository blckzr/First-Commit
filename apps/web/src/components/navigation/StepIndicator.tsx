import { Fragment } from "react";
import styles from "./StepIndicator.module.css";

export interface StepIndicatorProps {
  steps: string[];
  /** Zero-based index of the step the person is on. */
  current: number;
  className?: string;
}

/**
 * design.md §7: used only for true sequences — onboarding and capstone stages.
 * Steps ahead are not links; §5.4 sends a learner back to the first unfinished
 * step if they try to skip.
 */
export function StepIndicator({ steps, current, className }: StepIndicatorProps) {
  return (
    <ol
      className={[styles.list, className ?? ""].filter(Boolean).join(" ")}
      aria-label={`Step ${current + 1} of ${steps.length}`}
    >
      {steps.map((step, i) => {
        const done = i < current;
        const isCurrent = i === current;
        return (
          <Fragment key={step}>
            <li
              className={[styles.step, done ? styles.done : "", isCurrent ? styles.current : ""]
                .filter(Boolean).join(" ")}
              aria-current={isCurrent ? "step" : undefined}
            >
              <span className={styles.marker} aria-hidden="true" />
              {step}
            </li>
            {i < steps.length - 1 && <span className={styles.rule} aria-hidden="true" />}
          </Fragment>
        );
      })}
    </ol>
  );
}
