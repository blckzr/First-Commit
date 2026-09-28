import { useEffect, useId, useRef } from "react";
import { EditorState, type Extension } from "@codemirror/state";
import { EditorView, keymap, lineNumbers, highlightActiveLine } from "@codemirror/view";
import { defaultKeymap, history, historyKeymap, indentWithTab } from "@codemirror/commands";
import { javascript } from "@codemirror/lang-javascript";
import { python } from "@codemirror/lang-python";
import { HighlightStyle, syntaxHighlighting } from "@codemirror/language";
import { tags } from "@lezer/highlight";
import styles from "./CodeEditor.module.css";

/**
 * The code editor for §5.11.
 *
 * **CodeMirror 6, not Monaco** (design.md §13.1): it behaves on touch and at
 * small widths, which matters because §11 commits to one layout that works at
 * 320px rather than a desktop-only exercise screen.
 *
 * `indentWithTab` is bound deliberately and it is a trade: Tab indents instead
 * of moving focus. §12 requires a keyboard route past every control, so Escape
 * then Tab leaves the editor, and the hint below the editor says so — an
 * editor nobody can tab out of is a keyboard trap, which is a WCAG failure,
 * not a preference.
 *
 * **Drawn as First Commit v2.dc.html draws it**: the design system's ink code
 * block — a bar naming the file and the language, line numbers, and the same
 * syntax tones as `CodeBlock` — made editable.
 */

export interface CodeEditorProps {
  value: string;
  onChange: (value: string) => void;
  /** `javascript`, `python`, `react`, `vue` — from `assessments.runtime`. */
  runtime?: string | null;
  /** Names the editor for assistive technology: "script.js, JavaScript editor". */
  label: string;
  readOnly?: boolean;
  /** Shown in the bar above the code: "script.js". */
  filename?: string;
}

/** The bar's language name, from the runtime. */
const LANGUAGE: Record<string, string> = {
  javascript: "JavaScript",
  python: "Python",
  react: "React",
  vue: "Vue",
};

/**
 * CodeBlock's tones, as classes rather than colours, so every colour stays a
 * token in CSS (AGENT.md §8) and the two surfaces cannot drift apart.
 */
const tones = HighlightStyle.define([
  { tag: [tags.keyword, tags.controlKeyword, tags.definitionKeyword, tags.moduleKeyword], class: styles.key },
  { tag: [tags.string, tags.special(tags.string), tags.number, tags.bool], class: styles.str },
  { tag: [tags.comment, tags.lineComment, tags.blockComment], class: styles.com },
  { tag: [tags.tagName, tags.typeName, tags.className], class: styles.tag },
]);

function languageFor(runtime: string | null | undefined): Extension[] {
  switch (runtime) {
    case "python":
      return [python()];
    case "react":
      return [javascript({ jsx: true })];
    case "vue":
    case "javascript":
      return [javascript()];
    default:
      return [];
  }
}

export function CodeEditor({
  value,
  onChange,
  runtime,
  label,
  readOnly,
  filename,
}: CodeEditorProps) {
  const host = useRef<HTMLDivElement>(null);
  const view = useRef<EditorView | null>(null);
  const latest = useRef(onChange);
  const hintId = useId();

  /**
   * CodeMirror's update listener is captured when the view is built, so it
   * would otherwise keep calling the first `onChange` it ever saw. The ref is
   * refreshed in an effect rather than during render — writing to a ref while
   * rendering is what `react-hooks/refs` refuses, and it is right to.
   */
  useEffect(() => {
    latest.current = onChange;
  }, [onChange]);

  /**
   * Built once per runtime. `value` is deliberately not a dependency: rebuilding
   * the editor on every keystroke would lose the cursor, the selection, and the
   * undo history. Outside changes are pushed in by the effect below instead.
   */
  useEffect(() => {
    if (!host.current) return;

    const state = EditorState.create({
      doc: value,
      extensions: [
        lineNumbers(),
        highlightActiveLine(),
        history(),
        keymap.of([...defaultKeymap, ...historyKeymap, indentWithTab]),
        ...languageFor(runtime),
        syntaxHighlighting(tones),
        EditorView.lineWrapping,
        EditorState.readOnly.of(Boolean(readOnly)),
        EditorView.updateListener.of((update) => {
          if (update.docChanged) latest.current(update.state.doc.toString());
        }),
        EditorView.contentAttributes.of({
          "aria-label": label,
          "aria-describedby": hintId,
        }),
      ],
    });

    const created = new EditorView({ state, parent: host.current });
    view.current = created;
    return () => {
      created.destroy();
      view.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [runtime, readOnly, label, hintId]);

  /** "Reset code", or reopening a past attempt: replace the document, keep the view. */
  useEffect(() => {
    const current = view.current;
    if (!current || current.state.doc.toString() === value) return;
    current.dispatch({
      changes: { from: 0, to: current.state.doc.length, insert: value },
    });
  }, [value]);

  return (
    <div className={styles.editor}>
      {(filename || (runtime && LANGUAGE[runtime])) && (
        <div className={styles.head}>
          <span>{filename}</span>
          <span>{runtime ? LANGUAGE[runtime] : ""}</span>
        </div>
      )}
      <div ref={host} className={styles.host} />
      <p id={hintId} className={styles.hint}>
        Tab indents inside the editor. Press Escape, then Tab, to move on.
      </p>
    </div>
  );
}
