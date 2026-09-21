import type { ReactNode } from "react";
import { Icon } from "../core/Icon";
import type { LessonBlock } from "../../api/modules";
import styles from "./LessonBody.module.css";

/**
 * Renders a lesson's block list (design.md §13.3 `LessonContent`).
 *
 * The `switch` is exhaustive on `type`, so a block type added to the format
 * without a renderer here is a compile error rather than a silent gap in the
 * middle of someone's lesson.
 *
 * **Nothing here renders HTML from content.** `text` is plain, with backticks
 * marking inline code, and that is the whole inline grammar — which is why the
 * format has no escape hatch and this file has no `dangerouslySetInnerHTML`.
 */
export function LessonBody({ blocks }: { blocks: LessonBlock[] }) {
  return (
    <div className={styles.body}>
      {blocks.map((block, i) => (
        <Block key={i} block={block} />
      ))}
    </div>
  );
}

function Block({ block }: { block: LessonBlock }) {
  switch (block.type) {
    case "paragraph":
      return <p className={styles.paragraph}>{inline(block.text)}</p>;

    case "heading":
      // h3 because the page's h1 is the module and h2 is the lesson title.
      return <h3 className={styles.heading}>{inline(block.text)}</h3>;

    case "list":
      return block.ordered ? (
        <ol className={styles.list}>
          {block.items.map((item, i) => (
            <li key={i}>{inline(item)}</li>
          ))}
        </ol>
      ) : (
        <ul className={styles.list}>
          {block.items.map((item, i) => (
            <li key={i}>{inline(item)}</li>
          ))}
        </ul>
      );

    case "code":
      return (
        <figure className={styles.codeFigure}>
          <pre className={styles.code}>
            <code>{block.code}</code>
          </pre>
          {block.caption && <figcaption className={styles.caption}>{block.caption}</figcaption>}
        </figure>
      );

    case "callout":
      return (
        <aside className={[styles.callout, styles[block.tone]].join(" ")}>
          {/* §8: never colour alone — the icon and the word carry it too. */}
          <Icon name={block.tone === "notice" ? "flag" : "info"} size={16} />
          <span className={styles.calloutLabel}>
            {block.tone === "notice" ? "Watch out" : "Note"}
          </span>
          <span>{inline(block.text)}</span>
        </aside>
      );

    default:
      return assertNever(block);
  }
}

/**
 * Splits on backticks and renders the odd segments as inline code.
 *
 * A text node, never markup — an unclosed backtick renders as a literal, not as
 * a broken page, and nothing a lesson author writes can escape into the DOM.
 */
function inline(text: string): ReactNode {
  const parts = text.split("`");
  if (parts.length === 1) return text;

  return parts.map((part, i) =>
    i % 2 === 1 ? (
      <code key={i} className={styles.inlineCode}>
        {part}
      </code>
    ) : (
      part
    ),
  );
}

function assertNever(value: never): never {
  throw new Error(`Unhandled lesson block: ${JSON.stringify(value)}`);
}
