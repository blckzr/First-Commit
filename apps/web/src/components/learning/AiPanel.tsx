import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import { Card } from "../core/Card";
import { Button } from "../core/Button";
import { Icon } from "../core/Icon";
import { flagsApi } from "../../api/flags";
import { ApiError } from "../../api/client";
import styles from "./AiPanel.module.css";

/**
 * An AI panel: the label, the reason, and "Is this wrong?".
 *
 * AGENT.md §7 requires all three together — "All AI output is labeled as AI in
 * the UI, carries a short reason, and is flaggable by learners". Keeping them
 * in one component is what stops a screen from shipping two of the three:
 * §5.5, §5.8, and §5.11 each draw this panel, and none of them can draw it
 * without the flag control.
 *
 * **The flag needs the output row it points at.** With no `aiOutputId` there is
 * nothing to flag, so the control is not offered rather than offered broken.
 */

export interface AiPanelProps {
  /** The `ai_outputs` row this text came from. Null when it was not recorded. */
  aiOutputId: string | null;
  /** Whether this learner already flagged it. */
  flagged?: boolean;
  /** "AI" on a recommendation, "AI feedback" on a code hint (§5.11). */
  label?: string;
  children: ReactNode;
  className?: string;
}

export function AiPanel({
  aiOutputId,
  flagged = false,
  label = "AI",
  children,
  className,
}: AiPanelProps) {
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState("");
  const [done, setDone] = useState(flagged);
  const [error, setError] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  const fieldId = useId();
  const openButton = useRef<HTMLButtonElement>(null);
  const field = useRef<HTMLTextAreaElement>(null);
  const wasOpen = useRef(false);

  /**
   * §12: "focus moves into panels and dialogs and returns on close".
   *
   * Both halves happen here rather than in the handlers, because the form and
   * the button swap places: when the form closes, the button that opened it
   * has only just been mounted again, so focusing it from the click handler
   * would be focusing a node that no longer exists.
   *
   * A ref rather than `autoFocus`, which `jsx-a11y/no-autofocus` refuses — and
   * is right to, since `autoFocus` would also fire on first paint. This moves
   * focus only in response to the learner opening or closing the form.
   */
  useEffect(() => {
    if (open) field.current?.focus();
    else if (wasOpen.current) openButton.current?.focus();
    wasOpen.current = open;
  }, [open]);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (!aiOutputId || !reason.trim()) return;

    setSending(true);
    setError(null);
    try {
      await flagsApi.create(aiOutputId, reason.trim());
      setOpen(false);
      setDone(true);
    } catch (err) {
      setError(
        err instanceof ApiError
          ? err.message
          : "That didn't send. Check your connection and try again.",
      );
    } finally {
      setSending(false);
    }
  }

  function close() {
    setOpen(false);
    setError(null);
  }

  return (
    <Card
      surface="soft"
      radius="card"
      padding="md"
      className={[styles.panel, className].filter(Boolean).join(" ")}
    >
      <span className={styles.label}>{label}</span>
      <div className={styles.text}>{children}</div>

      {/* Nothing to point a flag at, so nothing is offered. */}
      {aiOutputId === null ? null : done ? (
        /*
         * §9: say what happened, not "Success!". The learner is told their
         * note landed and who looks at it — not a verdict, because a flag is
         * an opinion until an admin rules on it.
         */
        <p className={styles.thanks}>
          <Icon name="check" size={16} aria-hidden />
          You flagged this. An admin will take a look.
        </p>
      ) : open ? (
        <form className={styles.form} onSubmit={submit}>
          <label className={styles.fieldLabel} htmlFor={fieldId}>
            What is wrong with it?
          </label>
          <textarea
            id={fieldId}
            ref={field}
            className={styles.field}
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            rows={3}
            maxLength={1000}
            required
          />
          {error && (
            <p role="alert" className={styles.error}>
              {error}
            </p>
          )}
          <div className={styles.formActions}>
            <Button type="submit" size="sm" disabled={sending || !reason.trim()}>
              {sending ? "Sending…" : "Send flag"}
            </Button>
            <Button type="button" size="sm" variant="ghost" onClick={close}>
              Cancel
            </Button>
          </div>
        </form>
      ) : (
        <button
          ref={openButton}
          type="button"
          className={styles.flag}
          onClick={() => setOpen(true)}
        >
          Is this wrong?
        </button>
      )}
    </Card>
  );
}
