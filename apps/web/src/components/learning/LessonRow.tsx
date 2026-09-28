import { Link } from "react-router";
import { Icon } from "../core/Icon";
import styles from "./LessonRow.module.css";

export type LessonState = "todo" | "done" | "locked";

export interface LessonRowProps {
  /** The number in the disc. The quiz and the exercise continue the count. */
  index: number;
  title: string;
  /** The right-hand caption: a duration in the prototype, "5 questions" here. */
  meta?: string;
  state?: LessonState;
  /** It is the row open in the reading column. */
  current?: boolean;
  /** What "done" is called, for screen readers: a lesson is read, a quiz passed. */
  doneWord?: string;
  /** A row that changes what is beside it. */
  onClick?: () => void;
  /** A row that leaves the page — the quiz and the exercise. */
  to?: string;
}

/**
 * A row in a module's lesson rail (design.md §5.9, §7), as First Commit
 * v2.dc.html draws it: a numbered disc, the title, and a caption on the right.
 * Lessons, the quiz, and the exercise are all rows in the same list, which is
 * what §5.9's sketch shows too.
 *
 * **Read and current are separate props, not one state.** The design system's
 * row models `todo | active | done`, which is right for a video course. A First
 * Commit lesson is read by pressing "Mark as read" and stays open afterwards, so
 * it is routinely both, and one value would drop the tick from the row the
 * learner is standing on (design-source.md §3.5).
 *
 * The source's contrast is corrected here: the current disc is violet-600, not
 * violet-500 (white on it 5.65:1, not 3.98:1), and the unread number and the
 * caption are --text-muted, not --text-faint. The source's play glyph on the
 * current row is left out — nothing here plays.
 */
const WORD: Record<LessonState, string> = {
  todo: "Not started",
  done: "Read",
  locked: "Locked",
};

export function LessonRow({
  index,
  title,
  meta,
  state = "todo",
  current,
  doneWord = "Read",
  onClick,
  to,
}: LessonRowProps) {
  const classes = [styles.row, styles[state], current ? styles.current : ""]
    .filter(Boolean)
    .join(" ");

  const content = (
    <>
      <span className={styles.disc} aria-hidden="true">
        {state === "done" ? (
          <Icon name="check" size={13} />
        ) : state === "locked" ? (
          <Icon name="lock" size={12} />
        ) : (
          index
        )}
      </span>
      <span className={styles.title}>{title}</span>
      {meta && <span className={styles.meta}>{meta}</span>}
      {/* §8: icon + text + colour. The word is here for anyone the colour
          and the glyph never reach. */}
      <span className={styles.srOnly}>{state === "done" ? doneWord : WORD[state]}</span>
    </>
  );

  if (to) {
    return (
      <Link to={to} className={classes}>
        {content}
      </Link>
    );
  }

  if (!onClick) return <div className={classes}>{content}</div>;

  return (
    <button
      type="button"
      className={classes}
      aria-current={current ? "true" : undefined}
      onClick={onClick}
    >
      {content}
    </button>
  );
}
