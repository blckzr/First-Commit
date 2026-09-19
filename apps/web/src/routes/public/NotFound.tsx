import { LinkButton } from "../../components/core/LinkButton";
import styles from "./NotFound.module.css";

/** design.md §9: errors explain and direct, without apologising or being vague. */
export function NotFound() {
  return (
    <main className={styles.page}>
      <div className={styles.card}>
        <h1 className={styles.title}>We couldn&apos;t find that page.</h1>
        <p className={styles.body}>
          Check the address, or head back to where you were learning.
        </p>
        <LinkButton to="/" variant="primary" icon="arrow-right">
          Go to First Commit
        </LinkButton>
      </div>
    </main>
  );
}
