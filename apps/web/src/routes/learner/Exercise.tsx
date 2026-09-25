import { useMemo, useState } from "react";
import { useParams } from "react-router";
import { Badge } from "../../components/core/Badge";
import { Button } from "../../components/core/Button";
import { Card } from "../../components/core/Card";
import { Icon } from "../../components/core/Icon";
import { LinkButton } from "../../components/core/LinkButton";
import { AiPanel } from "../../components/learning/AiPanel";
import { CodeEditor } from "../../components/learning/CodeEditor";
import { ApiError } from "../../api/client";
import type { Exercise as ExerciseData, Submission, TestResult } from "../../api/exercises";
import { useExercise, useSubmission, useSubmitExercise } from "../../features/exercise/useExercise";
import styles from "./Exercise.module.css";

/**
 * design.md §5.11 — the coding exercise.
 *
 * **Only the server's run counts** (AGENT.md §6 rule 4). "Submit" sends files
 * and nothing else; the pass, the results, and the module completion behind
 * them are all written by the worker from tests it ran itself. Nothing on this
 * screen computes an outcome, which is why there is no "Run tests" button yet:
 * §5.11's in-browser run is Sandpack practice for React and Vue, and Sandpack
 * is not installed. Recorded in docs/task-tracker.md.
 *
 * §5.11's ordering is deliberate and kept: **test results appear before AI
 * feedback, because they are the source of truth** (§7).
 */
export function Exercise() {
  const { id } = useParams();
  const { data, isPending, error } = useExercise(id);

  if (isPending) {
    return (
      <p role="status" aria-live="polite" className={styles.loading}>
        Loading the exercise…
      </p>
    );
  }

  if (error || !data) {
    const notFound = error instanceof ApiError && error.status === 404;
    return (
      <Card surface="white" radius="panel" padding="lg" className={styles.empty}>
        <h1 className={styles.title}>
          {notFound ? "We couldn't find that exercise" : "That exercise isn't available right now"}
        </h1>
        <p className={styles.lede}>
          {notFound
            ? "It may belong to a module that isn't published yet."
            : "This is usually temporary. Your work is safe — try again in a moment."}
        </p>
        <LinkButton to="/app/roadmaps" icon="arrow-right">
          See your roadmaps
        </LinkButton>
      </Card>
    );
  }

  return <ExerciseView exercise={data} />;
}

type Tab = "instructions" | "results";

function ExerciseView({ exercise }: { exercise: ExerciseData }) {
  /** The starter files, or their own last attempt — §5.11 reopens where they left it. */
  const opening = useMemo(
    () => exercise.lastSubmission?.files ?? exercise.starterFiles,
    [exercise],
  );

  const [code, setCode] = useState(opening[0]?.content ?? "");
  /** Null until the learner picks a tab themselves; the default is derived. */
  const [picked, setPicked] = useState<Tab | null>(null);
  const [submissionId, setSubmissionId] = useState<string | null>(
    exercise.lastSubmission?.id ?? null,
  );

  const submit = useSubmitExercise(exercise.id);
  const { data: polled } = useSubmission(submissionId ?? undefined);
  const submission = polled ?? exercise.lastSubmission ?? null;

  const path = opening[0]?.path ?? "script.js";
  const running = submission?.status === "queued" || submission?.status === "running";

  /**
   * §5.11 puts results in front of the learner the moment there are any.
   *
   * **Derived, not synchronised.** An effect calling `setTab` when results
   * land would be a cascading render, and would also fight a learner who had
   * deliberately gone back to the instructions. `picked` records that choice
   * and wins; everything else falls out of whether there is a finished run.
   */
  const tab: Tab = picked ?? (submission && !running ? "results" : "instructions");

  function send() {
    submit.mutate([{ path, content: code }], {
      onSuccess: (created) => {
        setSubmissionId(created.id);
        setPicked("results");
      },
    });
  }

  return (
    <div className={styles.page}>
      <Card surface="white" radius="panel" padding="lg" className={styles.header}>
        <LinkButton
          variant="ghost"
          size="sm"
          to={`/app/module/${exercise.moduleId}`}
          icon="arrow-left"
          iconPosition="left"
        >
          Back to {exercise.moduleTitle}
        </LinkButton>
        <h1 className={styles.title}>Exercise: {exercise.title}</h1>
      </Card>

      <div className={styles.split}>
        <Card surface="white" radius="panel" padding="lg" className={styles.editorPane}>
          <h2 className={styles.fileName}>{path}</h2>
          <CodeEditor
            value={code}
            onChange={setCode}
            runtime={exercise.runtime}
            label={`${path}, code editor`}
          />
        </Card>

        <Card surface="white" radius="panel" padding="lg" className={styles.sidePane}>
          <div className={styles.tabs} role="tablist" aria-label="Exercise panels">
            <Tabbed id="instructions" tab={tab} onSelect={setPicked}>
              Instructions
            </Tabbed>
            <Tabbed id="results" tab={tab} onSelect={setPicked}>
              Results
            </Tabbed>
          </div>

          {tab === "instructions" ? (
            <div id="panel-instructions" role="tabpanel" aria-labelledby="tab-instructions">
              <p className={styles.instructions}>{exercise.instructions}</p>
              {exercise.visibleTests.length > 0 && (
                <>
                  <h3 className={styles.subhead}>What is checked</h3>
                  <ul className={styles.checkList}>
                    {exercise.visibleTests.map((t) => (
                      <li key={t.id}>{t.name}</li>
                    ))}
                  </ul>
                </>
              )}
            </div>
          ) : (
            <div id="panel-results" role="tabpanel" aria-labelledby="tab-results">
              <Results submission={submission} running={running} />
            </div>
          )}
        </Card>
      </div>

      <Card surface="white" radius="panel" padding="lg" className={styles.actions}>
        <Button variant="ghost" onClick={() => setCode(exercise.starterFiles[0]?.content ?? "")}>
          Reset code
        </Button>
        <div className={styles.rightActions}>
          {submit.isError && (
            <p role="alert" className={styles.error}>
              {submit.error instanceof ApiError
                ? submit.error.message
                : "That didn't send. Check your connection and try again."}
            </p>
          )}
          <Button onClick={send} disabled={submit.isPending || running}>
            {submit.isPending ? "Submitting…" : running ? "Running…" : "Submit"}
          </Button>
        </div>
      </Card>
    </div>
  );
}

function Tabbed({
  id,
  tab,
  onSelect,
  children,
}: {
  id: Tab;
  tab: Tab;
  onSelect: (tab: Tab) => void;
  children: string;
}) {
  const selected = tab === id;
  return (
    <button
      type="button"
      role="tab"
      id={`tab-${id}`}
      aria-selected={selected}
      aria-controls={`panel-${id}`}
      className={[styles.tab, selected ? styles.tabOn : ""].filter(Boolean).join(" ")}
      onClick={() => onSelect(id)}
    >
      {children}
    </button>
  );
}

/**
 * §5.11's results panel.
 *
 * **Every state arrives in a polite live region** (§12), because a learner who
 * submitted and looked away should be told the run finished rather than
 * discovering it.
 */
function Results({ submission, running }: { submission: Submission | null; running: boolean }) {
  if (!submission) {
    return (
      <p className={styles.muted}>
        Submit your code and the tests run on the server. Only a server run counts.
      </p>
    );
  }

  if (running) {
    return (
      <p role="status" aria-live="polite" className={styles.muted}>
        Running your tests…
      </p>
    );
  }

  const results = submission.testResults;

  /** The worker could not run it at all — §9: explain and direct, don't apologise. */
  if (results && !Array.isArray(results)) {
    return (
      <div role="status" aria-live="polite" className={styles.results}>
        <p className={styles.runError}>
          <Icon name="info" size={16} aria-hidden />
          {results.error}
        </p>
      </div>
    );
  }

  const cases = results ?? [];
  const passed = cases.filter((c) => c.passed).length;
  const all = cases.length > 0 && passed === cases.length;

  return (
    <div className={styles.results}>
      <div role="status" aria-live="polite">
        {/* §8: status is icon + text + colour. §5.11: "All 4 tests passed." */}
        {all ? (
          <Badge tone="verified" icon="check">
            All {cases.length} tests passed. Module exercise complete.
          </Badge>
        ) : (
          <p className={styles.tally}>
            {passed} of {cases.length} tests passed
          </p>
        )}
      </div>

      <ul className={styles.caseList}>
        {cases.map((c, i) => (
          <CaseRow key={c.testCaseId ?? `${c.name}-${i}`} result={c} />
        ))}
      </ul>

      <FeedbackPanel submission={submission} />
    </div>
  );
}

function CaseRow({ result }: { result: TestResult }) {
  return (
    <li className={result.passed ? styles.casePass : styles.caseFail}>
      <span className={styles.caseHead}>
        {/*
         * §8: never colour alone. The icon and the words "Passed"/"Failed"
         * carry the outcome for anyone who cannot see the colour.
         */}
        <Icon name={result.passed ? "check" : "x"} size={16} aria-hidden />
        <span className={styles.hiddenText}>{result.passed ? "Passed: " : "Failed: "}</span>
        {result.name}
      </span>
      {/*
       * A hidden case reports its name and outcome and nothing else — the
       * worker redacts its values, so a learner learns that one failed without
       * learning what it checked.
       */}
      {!result.passed && result.expected !== undefined && (
        <span className={styles.caseDetail}>
          Expected {result.expected}, got {result.actual}
        </span>
      )}
      {!result.passed && result.hidden && (
        <span className={styles.caseDetail}>This is one of the hidden checks.</span>
      )}
    </li>
  );
}

/**
 * §5.11's AI feedback, under the results.
 *
 * §7: the model explains a run that already happened. It never arrives before
 * the results, and there is none on a pass — a learner who passed does not
 * need a hint.
 */
function FeedbackPanel({ submission }: { submission: Submission }) {
  if (submission.feedback) {
    const { feedback } = submission;
    return (
      <AiPanel
        aiOutputId={feedback.aiOutputId}
        flagged={feedback.flagged}
        label="AI feedback"
        className={styles.feedback}
      >
        <p>{feedback.summary}</p>
        {feedback.issues.map((issue, i) => (
          <p key={i}>
            {issue.line !== null && <strong>Line {issue.line}: </strong>}
            {issue.problem} {issue.hint}
          </p>
        ))}
        {feedback.encouragement && <p>{feedback.encouragement}</p>}
      </AiPanel>
    );
  }

  /** §5.11's two waiting messages, word for word. */
  if (submission.feedbackStatus === "running") {
    return (
      <p role="status" aria-live="polite" className={styles.muted}>
        Writing feedback on your test results…
      </p>
    );
  }
  if (submission.feedbackStatus === "queued") {
    return (
      <p role="status" aria-live="polite" className={styles.muted}>
        Feedback is queued. Your test results are ready below.
      </p>
    );
  }
  if (submission.feedbackStatus === "failed") {
    /* §9's own sentence for this exact case. */
    return (
      <p role="status" aria-live="polite" className={styles.muted}>
        Feedback isn&apos;t available right now. Your test results are above, and you can try
        feedback again in a minute.
      </p>
    );
  }
  return null;
}
