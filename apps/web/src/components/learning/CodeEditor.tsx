import { useEffect, useId, useRef } from "react";
import { EditorState, type Extension } from "@codemirror/state";
import { EditorView, keymap, lineNumbers, highlightActiveLine } from "@codemirror/view";
import { defaultKeymap, history, historyKeymap, indentWithTab } from "@codemirror/commands";
import { javascript } from "@codemirror/lang-javascript";
import { python } from "@codemirror/lang-python";
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
 */

export interface CodeEditorProps {
  value: string;
  onChange: (value: string) => void;
  /** `javascript`, `python`, `react`, `vue` — from `assessments.runtime`. */
  runtime?: string | null;
  /** Names the editor for assistive technology: "script.js, JavaScript editor". */
  label: string;
  readOnly?: boolean;
}

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

export function CodeEditor({ value, onChange, runtime, label, readOnly }: CodeEditorProps) {
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
      <div ref={host} className={styles.host} />
      <p id={hintId} className={styles.hint}>
        Tab indents inside the editor. Press Escape, then Tab, to move on.
      </p>
    </div>
  );
}
