import { Icon } from "../core/Icon";
import type { IconName } from "../core/Icon";
import styles from "./LessonRow.module.css";

export type LessonState = "todo" | "done" | "locked";

export interface LessonRowProps {
  /** The row's whole label, numbered by the caller: "2 Props", or "Quiz". */
  label: string;
  state?: LessonState;
  /** It is the row open in the reading column. */
  current?: boolean;
  onClick?: () => void;
}

/**
 * A row in a module's lesson rail (design.md §5.9, §7).
 *
 * The prototype's rail is a flat list: the label on the left, a status icon on
 * the right, and a violet tint on the row being read. Lessons, the quiz, and
 * the exercise are all rows in the same list, which is what §5.9's sketch
 * shows too.
 *
 * **Read and current are separate props, not one state.** A First Commit
 * lesson is read by pressing "Mark as read" and stays open afterwards, so it
 * is routinely both, and one value would drop the tick from the row the
 * learner is standing on.
 */
const ICON: Record<LessonState, IconName> = {
  todo: "circle",
  done: "check",
  locked: "lock",
};

const WORD: Record<LessonState, string> = {
  todo: "Not started",
  done: "Read",
  locked: "Locked",
};

export function LessonRow({ label, state = "todo", current, onClick }: LessonRowProps) {
  const classes = [styles.row, styles[state], current ? styles.current : ""]
    .filter(Boolean)
    .join(" ");

  const content = (
    <>
      <span className={styles.label}>{label}</span>
      <span className={styles.status}>
        <Icon name={ICON[state]} size={15} />
        {/* §8: icon + text + colour. The word is here for anyone the colour
            and the glyph never reach. */}
        <span className={styles.srOnly}>{WORD[state]}</span>
      </span>
    </>
  );

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
