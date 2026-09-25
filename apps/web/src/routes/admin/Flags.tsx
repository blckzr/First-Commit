import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Badge } from "../../components/core/Badge";
import { Button } from "../../components/core/Button";
import { Card } from "../../components/core/Card";
import { Tag } from "../../components/core/Tag";
import { adminFlagsApi, type AdminFlag, type FlagFilter } from "../../api/adminFlags";
import { ApiError } from "../../api/client";
import styles from "./Flags.module.css";

/**
 * design.md §6.8 — Flagged AI feedback.
 *
 * **The first admin screen on real data**, and the other end of the learner's
 * "Is this wrong?". Until this existed every flag sat `open` with nobody able to
 * rule on it, which made the learner's control a suggestion box with no lid.
 *
 * §6.8 wants the learner's input, the results, the AI output and the learner's
 * reason side by side. Input and test results belong to the submission behind
 * the output and are not fetched yet — the output and the reason are, which is
 * what a ruling actually turns on. Recorded in docs/task-tracker.md.
 *
 * **A ruling moves no evidence** (§6 rule 10). It records that the model was
 * wrong, not that the learner was right: their score, their completions and
 * their submission all stand.
 */

const SOURCES = [
  { id: "code_feedback", label: "Code feedback" },
  { id: "roadmap_generation", label: "Roadmap explanation" },
  { id: "technology_recommendation", label: "Technology" },
  { id: "milestone_review", label: "Milestone review" },
  { id: "resume_generation", label: "Resume" },
] as const;

const STATUSES = [
  { id: "open", label: "Open" },
  { id: "confirmed_wrong", label: "Was wrong" },
  { id: "confirmed_correct", label: "Was correct" },
] as const;

const flagsKey = (filter: FlagFilter) =>
  ["admin", "flags", filter.source ?? null, filter.status ?? null] as const;

export function Flags() {
  const [filter, setFilter] = useState<FlagFilter>({ source: null, status: null });
  const { data, isPending, error } = useQuery({
    queryKey: flagsKey(filter),
    queryFn: ({ signal }) => adminFlagsApi.list(filter, signal),
  });

  const toggle = (key: keyof FlagFilter, value: string) =>
    setFilter((f) => ({ ...f, [key]: f[key] === value ? null : value }));

  return (
    <div className={styles.page}>
      <Card surface="white" radius="panel" padding="lg" className={styles.header}>
        <h1 className={styles.title}>Flagged AI feedback</h1>
        <p className={styles.lede}>
          What learners told us the model got wrong. Ruling on a flag records a judgement about
          the model — it does not change anyone&apos;s score or progress.
        </p>
        {data && <Summary counts={data.counts} />}
      </Card>

      <Card surface="white" radius="panel" padding="lg" className={styles.filters}>
        <Filter
          legend="Source"
          options={SOURCES}
          selected={filter.source}
          onToggle={(v) => toggle("source", v)}
        />
        <Filter
          legend="Status"
          options={STATUSES}
          selected={filter.status}
          onToggle={(v) => toggle("status", v)}
        />
      </Card>

      {isPending && (
        <p role="status" aria-live="polite" className={styles.muted}>
          Loading flags…
        </p>
      )}

      {error && (
        <Card surface="white" radius="panel" padding="lg">
          <p className={styles.muted}>
            {error instanceof ApiError
              ? error.message
              : "Flags aren't available right now. Try again in a moment."}
          </p>
        </Card>
      )}

      {data && data.flags.length === 0 && (
        <Card surface="white" radius="panel" padding="lg">
          <p className={styles.muted}>
            {filter.source || filter.status
              ? "No flags match that filter."
              : "No learner has flagged AI output yet."}
          </p>
        </Card>
      )}

      {data && data.flags.length > 0 && (
        <ul className={styles.list}>
          {data.flags.map((flag) => (
            <li key={flag.id}>
              <FlagCard flag={flag} filter={filter} />
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/**
 * §6.9's "share of flags confirmed as wrong", stated where the flags are.
 *
 * The denominator is **ruled-on flags, not all flags** — counting open ones
 * would make the model look better every time the queue grew, which is the
 * opposite of what the number is for.
 */
function Summary({ counts }: { counts: Record<string, number> }) {
  const open = counts.open ?? 0;
  const wrong = counts.confirmed_wrong ?? 0;
  const correct = counts.confirmed_correct ?? 0;
  const ruled = wrong + correct;

  return (
    <p className={styles.summary}>
      <Badge tone={open > 0 ? "notice" : "verified"} icon={open > 0 ? "info" : "check"}>
        {open} waiting
      </Badge>
      <span>
        {ruled === 0
          ? "Nothing ruled on yet."
          : `${wrong} of ${ruled} ruled flags were the model's fault (${Math.round(
              (wrong / ruled) * 100,
            )}%).`}
      </span>
    </p>
  );
}

function Filter({
  legend,
  options,
  selected,
  onToggle,
}: {
  legend: string;
  options: readonly { id: string; label: string }[];
  selected: string | null | undefined;
  onToggle: (value: string) => void;
}) {
  return (
    <fieldset className={styles.filterGroup}>
      <legend className={styles.legend}>{legend}</legend>
      <div className={styles.chips}>
        {options.map((option) => (
          <Tag
            key={option.id}
            selected={selected === option.id}
            onClick={() => onToggle(option.id)}
          >
            {option.label}
          </Tag>
        ))}
      </div>
    </fieldset>
  );
}

const SOURCE_LABEL = new Map<string, string>(SOURCES.map((s) => [s.id, s.label]));

function FlagCard({ flag, filter }: { flag: AdminFlag; filter: FlagFilter }) {
  const client = useQueryClient();
  const [notes, setNotes] = useState("");
  const open = flag.status === "open";

  const rule = useMutation({
    mutationFn: (status: "confirmed_wrong" | "confirmed_correct") =>
      adminFlagsApi.rule(flag.id, status, notes.trim() || undefined),
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: ["admin", "flags"] });
      void client.invalidateQueries({ queryKey: flagsKey(filter) });
    },
  });

  return (
    <Card surface="white" radius="card" padding="lg" className={styles.card}>
      <div className={styles.cardHead}>
        <h2 className={styles.cardTitle}>
          {SOURCE_LABEL.get(flag.source) ?? flag.source}
        </h2>
        {/* §8: status is icon + text + colour, never colour alone. */}
        {open ? (
          <Badge tone="notice" icon="info">
            Open
          </Badge>
        ) : flag.status === "confirmed_wrong" ? (
          <Badge tone="error" icon="x">
            Was wrong
          </Badge>
        ) : (
          <Badge tone="verified" icon="check">
            Was correct
          </Badge>
        )}
      </div>

      <p className={styles.meta}>
        Flagged by {flag.learner.fullName} · {new Date(flag.createdAt).toLocaleDateString()}
      </p>

      <section className={styles.block}>
        <h3 className={styles.blockTitle}>What the learner said</h3>
        <blockquote className={styles.quote}>{flag.reason}</blockquote>
      </section>

      <section className={styles.block}>
        <h3 className={styles.blockTitle}>What the model wrote</h3>
        {/*
          The whole output, formatted but not filtered. §6 rule 2 keeps a rubric
          from learners; judging the model means reading all of it, and that is
          why this screen is admin-only.
        */}
        <pre className={styles.output}>{JSON.stringify(flag.output, null, 2)}</pre>
      </section>

      {open ? (
        <section className={styles.block}>
          <h3 className={styles.blockTitle}>Your ruling</h3>
          <label className={styles.notesLabel} htmlFor={`notes-${flag.id}`}>
            Notes (optional — they go in the activity log)
          </label>
          <textarea
            id={`notes-${flag.id}`}
            className={styles.notes}
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            rows={2}
            maxLength={2000}
          />
          {rule.isError && (
            <p role="alert" className={styles.error}>
              {rule.error instanceof ApiError
                ? rule.error.message
                : "That didn't save. Try again in a moment."}
            </p>
          )}
          <div className={styles.rulingActions}>
            {/* §9: buttons say what happens. */}
            <Button
              variant="destructive"
              onClick={() => rule.mutate("confirmed_wrong")}
              disabled={rule.isPending}
            >
              Feedback was wrong
            </Button>
            <Button
              variant="secondary"
              onClick={() => rule.mutate("confirmed_correct")}
              disabled={rule.isPending}
            >
              Feedback was correct
            </Button>
          </div>
        </section>
      ) : (
        <section className={styles.block}>
          <h3 className={styles.blockTitle}>Ruled on</h3>
          <p className={styles.meta}>
            {flag.reviewedBy ?? "An admin"}
            {flag.reviewedAt ? ` · ${new Date(flag.reviewedAt).toLocaleDateString()}` : ""}
          </p>
          {flag.adminNotes && <blockquote className={styles.quote}>{flag.adminNotes}</blockquote>}
          {/*
            No "reopen". A ruling is in admin_activity_log, which is append-only
            (§6 rule 9) — undoing the row would leave the log describing a
            decision the flag no longer reflects. A change of mind is a new
            entry, once there is a screen for one.
          */}
        </section>
      )}
    </Card>
  );
}
