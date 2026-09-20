import { Card } from "../components/core/Card";
import styles from "./Placeholder.module.css";

export interface PlaceholderProps {
  title: string;
  /** The design.md section that specifies this screen, e.g. "section 5.12". */
  section: string;
  /** One line on what the screen is for, taken from that section. */
  purpose?: string;
  /** Renders its own page wrapper, for routes that sit outside a shell. */
  standalone?: boolean;
}

/**
 * A named stand-in for a screen that is specified but not built.
 *
 * Every route the navigation offers resolves to something — a dead link is a
 * worse review experience than an honest "not built yet", and it makes the
 * whole app walkable while the shells are being reviewed. Each one names the
 * `design.md` section that specifies it, so the next person knows where to look.
 */
export function Placeholder({ title, section, purpose, standalone }: PlaceholderProps) {
  const content = (
    <>
      <h1 className={styles.title}>{title}</h1>
      <Card surface="inset" padding="lg" className={standalone ? styles.card : undefined}>
        <p className={styles.body}>
          {purpose ?? "This screen is specified but not built yet."}
        </p>
        <p className={styles.ref}>
          Specified in <code>design.md</code> {section}. Tracked in{" "}
          <code>docs/task-tracker.md</code>.
        </p>
      </Card>
    </>
  );

  if (standalone) {
    return (
      <main className={styles.page}>
        <div className={styles.card}>{content}</div>
      </main>
    );
  }

  return <div>{content}</div>;
}
