import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Badge } from "../../components/core/Badge";
import { Button } from "../../components/core/Button";
import { Card } from "../../components/core/Card";
import {
  adminExercisesApi,
  exerciseKey,
  RUNTIMES,
  type Criterion,
  type Exercise,
  type File,
  type TestCase,
} from "../../api/adminExercises";
import { ApiError } from "../../api/client";
import styles from "./ExerciseEditor.module.css";

/**
 * design.md §6.3's Test cases and Rubric tabs.
 *
 * **The screen cannot declare an exercise verified.** §6.3 blocks publishing
 * when the reference solution fails its tests, and the sandbox is in the
 * worker — so this asks for a run and waits. Saving always un-verifies, and the
 * banner says so, because an author who edited after a green run needs to know
 * the green is gone before they go looking for Publish.
 *
 * `is_visible` is the control worth getting right: a hidden case exists so a
 * solution that special-cases the visible inputs does not pass (§6 rule 2), and
 * an author who cannot see which are hidden cannot write that trap.
 */

const POLL_MS = 2000;

const blankCase = (): TestCase => ({ name: "", code: "", visible: true });
const blankFile = (): File => ({ path: "", content: "" });

export function ExerciseEditor({
  moduleId,
  versionId,
}: {
  moduleId: string;
  versionId: string;
}) {
  const client = useQueryClient();

  const { data, isPending, error } = useQuery({
    queryKey: exerciseKey(moduleId, versionId),
    queryFn: ({ signal }) => adminExercisesApi.get(moduleId, versionId, signal),
    /*
     * Polled only while a run is outstanding. The worker writes the result from
     * another process, so there is nothing to push it here — and polling
     * forever would keep an idle editor talking to the API all day.
     */
    refetchInterval: (query) => {
      const status = query.state.data?.lastRun?.status;
      return status === "queued" || status === "running" ? POLL_MS : false;
    },
  });

  if (isPending) {
    return (
      <p role="status" aria-live="polite" className={styles.hint}>
        Loading the exercise…
      </p>
    );
  }

  if (error || !data) {
    return (
      <p role="alert" className={styles.error}>
        {error instanceof ApiError ? error.message : "That did not load. Try again in a moment."}
      </p>
    );
  }

  if (!data.editable) {
    return (
      <Card className={styles.panel}>
        <h2 className={styles.sectionTitle}>Exercise</h2>
        {data.exercise ? (
          <>
            <p className={styles.hint}>
              Learners are working on this. Start a draft to change it.
            </p>
            <p className={styles.meta}>
              {data.exercise.title} · {data.exercise.testCases.length} test cases ·{" "}
              {data.exercise.runtime}
            </p>
          </>
        ) : (
          <p className={styles.hint}>This version has no exercise.</p>
        )}
      </Card>
    );
  }

  return (
    <Editor
      key={versionId}
      moduleId={moduleId}
      versionId={versionId}
      initial={data.exercise}
      lastRun={data.lastRun}
      onChanged={() => client.invalidateQueries({ queryKey: exerciseKey(moduleId, versionId) })}
    />
  );
}

type LastRun = NonNullable<
  Awaited<ReturnType<typeof adminExercisesApi.get>>["lastRun"]
>;

function Editor({
  moduleId,
  versionId,
  initial,
  lastRun,
  onChanged,
}: {
  moduleId: string;
  versionId: string;
  initial: Exercise | null;
  lastRun: LastRun | null;
  onChanged: () => void;
}) {
  const [title, setTitle] = useState(initial?.title ?? "");
  const [instructions, setInstructions] = useState(initial?.instructions ?? "");
  const [runtime, setRuntime] = useState(initial?.runtime ?? "javascript");
  const [starterFiles, setStarterFiles] = useState<File[]>(
    initial?.starterFiles.length ? initial.starterFiles : [blankFile()],
  );
  const [referenceSolution, setReferenceSolution] = useState<File[]>(
    initial?.referenceSolution.length ? initial.referenceSolution : [blankFile()],
  );
  const [testCases, setTestCases] = useState<TestCase[]>(initial?.testCases ?? []);
  const [rubric, setRubric] = useState<Criterion[]>(initial?.rubric ?? []);
  const [dirty, setDirty] = useState(false);

  const verified = Boolean(initial?.verifiedAt) && !dirty;

  const touch = <T,>(set: (value: T) => void) => (value: T) => {
    set(value);
    setDirty(true);
  };

  const save = useMutation({
    mutationFn: () =>
      adminExercisesApi.save(moduleId, versionId, {
        title,
        instructions,
        passingScore: initial?.passingScore ?? 100,
        runtime,
        starterFiles,
        referenceSolution,
        testCases,
        rubric,
      }),
    onSuccess: () => {
      setDirty(false);
      onChanged();
    },
  });

  const verify = useMutation({
    mutationFn: () => adminExercisesApi.verify(moduleId, versionId),
    onSuccess: onChanged,
  });

  const running = lastRun?.status === "queued" || lastRun?.status === "running";

  return (
    <Card className={styles.panel}>
      {/*
        §6.3's gate, stated. An author who edited after a green run needs to
        know the green is gone before they go looking for Publish.
      */}
      <div className={styles.verifyBar}>
        {verified ? (
          <Badge tone="verified">Verified</Badge>
        ) : (
          <Badge tone="notice">Not verified</Badge>
        )}
        <p className={styles.hint}>
          {verified
            ? "The reference solution passes every test case. This version can be published."
            : "Run the tests against the reference solution. A version with an unverified exercise cannot be published."}
        </p>
        <Button
          variant="secondary"
          onClick={() => verify.mutate()}
          disabled={running || verify.isPending || dirty}
        >
          {running ? "Running…" : "Run tests"}
        </Button>
      </div>

      {dirty && (
        <p role="status" aria-live="polite" className={styles.hint}>
          Save your changes before running the tests.
        </p>
      )}

      {lastRun?.result && !running && <RunResult result={lastRun.result} />}

      <div className={styles.field}>
        <label className={styles.label} htmlFor="exercise-title">
          Exercise title
        </label>
        <input
          id="exercise-title"
          className={styles.input}
          value={title}
          onChange={(event) => touch(setTitle)(event.target.value)}
        />
      </div>

      <div className={styles.field}>
        <label className={styles.label} htmlFor="exercise-instructions">
          Instructions
        </label>
        <textarea
          id="exercise-instructions"
          className={styles.textarea}
          rows={3}
          value={instructions}
          onChange={(event) => touch(setInstructions)(event.target.value)}
        />
      </div>

      <div className={styles.field}>
        <label className={styles.label} htmlFor="exercise-runtime">
          Runtime
        </label>
        <select
          id="exercise-runtime"
          className={styles.select}
          value={runtime}
          onChange={(event) => touch(setRuntime)(event.target.value)}
        >
          {RUNTIMES.map((option) => (
            <option key={option} value={option}>
              {option}
            </option>
          ))}
        </select>
      </div>

      <Files
        legend="Starter files — what the learner begins with"
        files={starterFiles}
        onChange={touch(setStarterFiles)}
        idPrefix="starter"
      />

      <Files
        legend="Reference solution — admin-only, never sent to a learner"
        files={referenceSolution}
        onChange={touch(setReferenceSolution)}
        idPrefix="solution"
      />

      <h2 className={styles.sectionTitle}>Test cases</h2>
      {testCases.length === 0 && (
        <p className={styles.hint}>An exercise needs at least one test case.</p>
      )}

      <ol className={styles.cases}>
        {testCases.map((test, index) => (
          <li key={index} className={styles.case}>
            <div className={styles.field}>
              <label className={styles.label} htmlFor={`case-name-${index}`}>
                Case {index + 1} name
              </label>
              <input
                id={`case-name-${index}`}
                className={styles.input}
                value={test.name}
                onChange={(event) =>
                  touch(setTestCases)(
                    testCases.map((c, i) =>
                      i === index ? { ...c, name: event.target.value } : c,
                    ),
                  )
                }
              />
            </div>

            <div className={styles.field}>
              <label className={styles.label} htmlFor={`case-code-${index}`}>
                Assertion
              </label>
              <textarea
                id={`case-code-${index}`}
                className={styles.code}
                rows={3}
                value={test.code}
                onChange={(event) =>
                  touch(setTestCases)(
                    testCases.map((c, i) =>
                      i === index ? { ...c, code: event.target.value } : c,
                    ),
                  )
                }
              />
            </div>

            {/*
              §6 rule 2: a hidden case exists so a solution that special-cases
              the visible inputs does not pass. An author who cannot see which
              are hidden cannot write that trap.
            */}
            <div className={styles.visible}>
              <input
                type="checkbox"
                id={`case-visible-${index}`}
                checked={test.visible}
                onChange={(event) =>
                  touch(setTestCases)(
                    testCases.map((c, i) =>
                      i === index ? { ...c, visible: event.target.checked } : c,
                    ),
                  )
                }
              />
              <label htmlFor={`case-visible-${index}`}>
                Learners can see this case{" "}
                <span className={styles.muted}>
                  {test.visible ? "" : "— hidden, so a hard-coded answer fails here"}
                </span>
              </label>
            </div>

            <Button
              variant="ghost"
              size="sm"
              onClick={() => touch(setTestCases)(testCases.filter((_, i) => i !== index))}
            >
              Remove case
            </Button>
          </li>
        ))}
      </ol>

      <Button variant="secondary" onClick={() => touch(setTestCases)([...testCases, blankCase()])}>
        Add test case
      </Button>

      <h2 className={styles.sectionTitle}>Rubric</h2>
      <p className={styles.hint}>
        Read by the Code Review AI. Admin-only — never sent to a learner.
      </p>
      <ol className={styles.cases}>
        {rubric.map((criterion, index) => (
          <li key={index} className={styles.case}>
            <div className={styles.field}>
              <label className={styles.label} htmlFor={`rubric-name-${index}`}>
                Criterion {index + 1}
              </label>
              <input
                id={`rubric-name-${index}`}
                className={styles.input}
                value={criterion.name}
                onChange={(event) =>
                  touch(setRubric)(
                    rubric.map((c, i) =>
                      i === index ? { ...c, name: event.target.value } : c,
                    ),
                  )
                }
              />
            </div>
            <div className={styles.field}>
              <label className={styles.label} htmlFor={`rubric-desc-${index}`}>
                What it means
              </label>
              <textarea
                id={`rubric-desc-${index}`}
                className={styles.textarea}
                rows={2}
                value={criterion.description}
                onChange={(event) =>
                  touch(setRubric)(
                    rubric.map((c, i) =>
                      i === index ? { ...c, description: event.target.value } : c,
                    ),
                  )
                }
              />
            </div>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => touch(setRubric)(rubric.filter((_, i) => i !== index))}
            >
              Remove criterion
            </Button>
          </li>
        ))}
      </ol>
      <Button
        variant="secondary"
        onClick={() => touch(setRubric)([...rubric, { name: "", description: "" }])}
      >
        Add criterion
      </Button>

      <div className={styles.actions}>
        <Button onClick={() => save.mutate()} disabled={save.isPending}>
          {save.isPending ? "Saving…" : "Save exercise"}
        </Button>
      </div>

      {(save.error || verify.error) && (
        <p role="alert" className={styles.error}>
          {(save.error ?? verify.error) instanceof ApiError
            ? (save.error ?? verify.error)!.message
            : "That did not save. Try again in a moment."}
        </p>
      )}
    </Card>
  );
}

/** What the worker said, including the hidden cases an author wrote. */
function RunResult({
  result,
}: {
  result: { verified: boolean; outcomes: { name: string; passed: boolean; expected?: string; actual?: string }[]; error?: string };
}) {
  return (
    <div className={styles.runResult} role="status" aria-live="polite">
      <h3 className={styles.sectionTitle}>Last run</h3>
      {result.error && <p className={styles.error}>{result.error}</p>}
      <ul className={styles.outcomes}>
        {result.outcomes.map((outcome, i) => (
          <li key={i} className={styles.outcome}>
            {/* §8: a status is a word, not only a colour. */}
            <span className={outcome.passed ? styles.pass : styles.fail}>
              {outcome.passed ? "Passed" : "Failed"}
            </span>
            <span>{outcome.name}</span>
            {outcome.expected !== undefined && (
              <span className={styles.muted}>
                expected {outcome.expected}, got {outcome.actual}
              </span>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}

function Files({
  legend,
  files,
  onChange,
  idPrefix,
}: {
  legend: string;
  files: File[];
  onChange: (files: File[]) => void;
  idPrefix: string;
}) {
  return (
    <fieldset className={styles.files}>
      <legend className={styles.label}>{legend}</legend>

      {files.map((file, index) => (
        <div key={index} className={styles.file}>
          <label className={styles.visuallyHidden} htmlFor={`${idPrefix}-path-${index}`}>
            File {index + 1} path
          </label>
          <input
            id={`${idPrefix}-path-${index}`}
            className={styles.input}
            placeholder="script.js"
            value={file.path}
            onChange={(event) =>
              onChange(files.map((f, i) => (i === index ? { ...f, path: event.target.value } : f)))
            }
          />

          <label className={styles.visuallyHidden} htmlFor={`${idPrefix}-content-${index}`}>
            File {index + 1} contents
          </label>
          <textarea
            id={`${idPrefix}-content-${index}`}
            className={styles.code}
            rows={5}
            value={file.content}
            onChange={(event) =>
              onChange(
                files.map((f, i) => (i === index ? { ...f, content: event.target.value } : f)),
              )
            }
          />

          <Button
            variant="ghost"
            size="sm"
            disabled={files.length <= 1}
            onClick={() => onChange(files.filter((_, i) => i !== index))}
          >
            Remove file
          </Button>
        </div>
      ))}

      <Button variant="ghost" size="sm" onClick={() => onChange([...files, blankFile()])}>
        Add file
      </Button>
    </fieldset>
  );
}
