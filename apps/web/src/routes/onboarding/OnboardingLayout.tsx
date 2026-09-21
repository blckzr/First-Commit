import type { ReactNode } from "react";
import { Icon } from "../../components/core/Icon";
import { StepIndicator } from "../../components/navigation/StepIndicator";
import styles from "./OnboardingLayout.module.css";

const STEP_LABELS = ["About you", "Target", "Placement", "Your roadmap"];

/**
 * design.md §5.4 — the onboarding chrome.
 *
 * "Onboarding pages show no app navigation. The only way out is finishing, or
 * the profile menu's Log out." So there is no `<nav>` here at all, and nothing
 * that links into `/app`.
 *
 * The step indicator shows progress but is not clickable for steps ahead —
 * `StepIndicator` renders plain list items, not links, so that holds by
 * construction.
 */
export function OnboardingLayout({
  step,
  title,
  lede,
  children,
}: {
  /** Zero-based index into STEP_LABELS. */
  step: number;
  title: string;
  lede?: string;
  children: ReactNode;
}) {
  return (
    <div className={styles.page}>
      <header className={styles.bar}>
        <span className={styles.wordmark}>
          <span className={styles.mark}><Icon name="code-xml" size={14} /></span>
          First Commit
        </span>
        <span className={styles.count}>
          Step {step + 1} of {STEP_LABELS.length}
        </span>
        <div className={styles.steps}>
          <StepIndicator steps={STEP_LABELS} current={step} />
        </div>
      </header>

      <main className={styles.main}>
        <h1 className={styles.title}>{title}</h1>
        {lede && <p className={styles.lede}>{lede}</p>}
        {children}
      </main>
    </div>
  );
}

