import styles from "./CodeBlock.module.css";

export type CodeTone = "plain" | "key" | "str" | "com" | "tag";

export interface CodeLine {
  text: string;
  tone?: CodeTone;
}

export interface CodeBlockProps {
  lines: CodeLine[];
  filename?: string;
  language?: string;
  showLineNumbers?: boolean;
  className?: string;
}

/**
 * Read-only code display for lessons and feedback. The editable exercise
 * surface is CodeMirror 6, not this (design.md §13.1).
 *
 * Comment tone is --gray-500 rather than the design system's --gray-600:
 * on ink, 600 measures under 4.5:1 while 500 clears it.
 */
export function CodeBlock({
  lines, filename, language, showLineNumbers = true, className,
}: CodeBlockProps) {
  return (
    <div className={[styles.block, className ?? ""].filter(Boolean).join(" ")}>
      {(filename || language) && (
        <div className={styles.head}>
          <span>{filename}</span>
          <span>{language}</span>
        </div>
      )}
      <pre className={styles.pre}>
        <code>
          {lines.map((line, i) => (
            <div key={i} className={styles.line}>
              {showLineNumbers && <span className={styles.lineNo}>{i + 1}</span>}
              <span className={[styles.text, styles[line.tone ?? "plain"]].join(" ")}>
                {line.text}
              </span>
            </div>
          ))}
        </code>
      </pre>
    </div>
  );
}
