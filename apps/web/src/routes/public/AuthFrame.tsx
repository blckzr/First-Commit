import type { ReactNode } from "react";
import styles from "./Auth.module.css";

/**
 * The page around sign up, log in, forgot password and reset password: the
 * wordmark, then one white panel. First Commit v2.dc.html draws all four this
 * way, so they share it rather than each carrying a copy.
 */
export function AuthFrame({ children }: { children: ReactNode }) {
  return (
    <div className={styles.page}>
      <div className={styles.column}>
        <span className={styles.wordmark}>
          First <span className={styles.accent}>Commit</span>
        </span>
        <div className={styles.card}>{children}</div>
      </div>
    </div>
  );
}
