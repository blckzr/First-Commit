import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Button } from "../../components/core/Button";
import { Card } from "../../components/core/Card";
import { Icon } from "../../components/core/Icon";
import { Input } from "../../components/forms/Input";
import { ProgressBar } from "../../components/learning/ProgressBar";
import { AiPanel } from "../../components/learning/AiPanel";
import {
  capstoneApi,
  capstoneKey,
  milestonesKey,
  type Check,
  type CapstoneState,
  type Milestone,
} from "../../api/capstone";
import { ApiError } from "../../api/client";
import styles from "./MilestoneTracker.module.css";

/**
 * design.md §5.14 stage 3 — the milestone tracker.
 *
 * ### Status is icon, text and colour — never colour alone
 *
 * §8 requires all three, and this screen is where it matters most: a learner
 * scanning five milestones for the one that needs attention is exactly the
 * person a colour-only signal fails. Every status carries a word.
 *
 * ### Pending is its own state, and reads like one
 *
 * A check that has not finished is not a check that failed. §5.14 shows
 * "Running checks on commit a1b2c3d…" and that distinction is kept all the way
 * from `checks.ts` to here — a learner who pushed a moment ago is told the
 * tests are still running, not that their code is wrong.
 *
 * ### No AI review panel
 *
 * §5.14 draws one. `milestone_review` is still a stub in the worker, so there is
 * nothing to show and no `ai_outputs` row to flag — and an AI panel with
 * invented content would break §7's labelling rules. It arrives with the job.
 */

const STATUS: Record<Milestone["status"], { label: string; icon: "check" | "x" | "circle-dot" | "circle" }> = {
  complete: { label: "Complete", icon: "check" },
  failed: { label: "Not passing yet", icon: "x" },
  checking: { label: "Checks running", icon: "circle-dot" },
  "not-started": { label: "Not started", icon: "circle" },
};

export function MilestoneTracker({
  roadmapId,
  project,
}: {
  roadmapId: string;
  project: NonNullable<CapstoneState["project"]>;
}) {
  const [selectedId, setSelectedId] = useState<string>();

  const { data, isPending, error } = useQuery({
    queryKey: milestonesKey(roadmapId),
    queryFn: ({ signal }) => capstoneApi.milestones(roadmapId, signal),
  });

  if (isPending) {
    return (
      <p role="status" aria-live="polite" className={styles.loading}>
        Checking your project…
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

  const { milestones } = data;
  const complete = milestones.filter((m) => m.status === "complete").length;

  // The one being worked on, unless the learner picked another to read.
  const current = milestones.find((m) => m.status !== "complete") ?? milestones[milestones.length - 1];
  const selected = milestones.find((m) => m.id === selectedId) ?? current;

  const finished = milestones.length > 0 && complete === milestones.length;

  return (
    <section aria-labelledby="tracker-heading" className={styles.tracker}>
      <header className={styles.header}>
        <h2 id="tracker-heading" className={styles.title}>
          {project.briefTitle}
        </h2>
        {project.repoFullName && (
          <a
            className={styles.repoLink}
            href={`https://github.com/${project.repoFullName}`}
            target="_blank"
            rel="noreferrer noopener"
          >
            <code className={styles.repo}>{project.repoFullName}</code>
            <Icon name="external-link" aria-hidden />
            <span className={styles.visuallyHidden}>Opens GitHub in a new tab</span>
          </a>
        )}
      </header>

      <div className={styles.progress}>
        <p className={styles.progressText}>
          {complete} of {milestones.length} milestones complete
        </p>
        {/*
          `hideLabel` because the sentence above is the bar's text and §7 never
          allows a bare bar — the label stays as the accessible name.
        */}
        <ProgressBar
          value={milestones.length ? (complete / milestones.length) * 100 : 0}
          label={`${complete} of ${milestones.length} milestones complete`}
          hideLabel
        />
      </div>

      {finished && (
        <Card className={styles.done}>
          <Icon name="award" aria-hidden />
          <p className={styles.doneText}>
            Every milestone is complete. Your Project Certificate is ready, and this project is on
            your resume.
          </p>
        </Card>
      )}

      <div className={styles.columns}>
        <nav aria-label="Milestones" className={styles.list}>
          <ol className={styles.steps}>
            {milestones.map((milestone) => {
              const status = STATUS[milestone.status];
              const isSelected = milestone.id === selected?.id;
              return (
                <li key={milestone.id}>
                  <button
                    type="button"
                    className={[styles.step, isSelected ? styles.stepSelected : ""]
                      .filter(Boolean)
                      .join(" ")}
                    aria-current={isSelected ? "true" : undefined}
                    onClick={() => setSelectedId(milestone.id)}
                  >
                    <Icon name={status.icon} aria-hidden className={styles[milestone.status]} />
                    <span className={styles.stepTitle}>
                      {milestone.sortOrder + 1}. {milestone.title}
                    </span>
                    {/* §8: the word, not only the colour and the icon. */}
                    <span className={styles.stepStatus}>{status.label}</span>
                  </button>
                </li>
              );
            })}
          </ol>
        </nav>

        {selected && (
          <MilestonePanel
            key={selected.id}
            roadmapId={roadmapId}
            milestone={selected}
            demoUrlNeeded={selected.checks.some((c) => c.detail.includes("live address"))}
          />
        )}
      </div>
    </section>
  );
}

function MilestonePanel({
  roadmapId,
  milestone,
  demoUrlNeeded,
}: {
  roadmapId: string;
  milestone: Milestone;
  demoUrlNeeded: boolean;
}) {
  const client = useQueryClient();
  const [answer, setAnswer] = useState(milestone.explanationAnswer ?? "");
  const [demoUrl, setDemoUrl] = useState("");

  const refresh = () =>
    Promise.all([
      client.invalidateQueries({ queryKey: milestonesKey(roadmapId) }),
      client.invalidateQueries({ queryKey: capstoneKey }),
    ]);

  const saveAnswer = useMutation({
    mutationFn: () => capstoneApi.answerExplanation(roadmapId, milestone.id, answer),
    onSuccess: refresh,
  });

  const saveDemoUrl = useMutation({
    mutationFn: () => capstoneApi.setDemoUrl(roadmapId, demoUrl),
    onSuccess: refresh,
  });

  return (
    <Card className={styles.panel}>
      <h3 className={styles.panelTitle}>
        Milestone {milestone.sortOrder + 1}: {milestone.title}
      </h3>

      <section aria-labelledby={`criteria-${milestone.id}`}>
        <h4 id={`criteria-${milestone.id}`} className={styles.sectionTitle}>
          Acceptance criteria
        </h4>
        <ul className={styles.criteria}>
          {milestone.acceptanceCriteria.map((criterion) => (
            <li key={criterion} className={styles.criterion}>
              {criterion}
            </li>
          ))}
        </ul>
      </section>

      {milestone.modules.length > 0 && (
        <section aria-labelledby={`modules-${milestone.id}`}>
          <h4 id={`modules-${milestone.id}`} className={styles.sectionTitle}>
            Related modules
          </h4>
          <ul className={styles.modules}>
            {milestone.modules.map((module) => (
              <li key={module.id}>
                <a className={styles.moduleLink} href={`/app/module/${module.id}`}>
                  {module.title}
                </a>
              </li>
            ))}
          </ul>
        </section>
      )}

      <section aria-labelledby={`checks-${milestone.id}`}>
        <h4 id={`checks-${milestone.id}`} className={styles.sectionTitle}>
          Checks
        </h4>
        {milestone.commitSha && (
          <p className={styles.commit}>
            On commit <code className={styles.repo}>{milestone.commitSha.slice(0, 7)}</code>
          </p>
        )}
        {milestone.checks.length === 0 ? (
          <p className={styles.hint}>Push your changes to see checks for this milestone.</p>
        ) : (
          /*
            A polite live region: §12 requires test results to arrive politely,
            and these update under the learner as the workflow finishes.
          */
          <ul className={styles.checks} aria-live="polite">
            {milestone.checks.map((check) => (
              <CheckRow key={check.checkId} check={check} />
            ))}
          </ul>
        )}
      </section>

      {/*
        §7: all AI output is labelled as AI, carries a short reason, and is
        flaggable. `AiPanel` carries all three together, so a screen cannot ship
        two of the three — which is why the review goes through it rather than
        being drawn here.
      */}
      {milestone.review && (
        <AiPanel aiOutputId={milestone.review.outputId} label="AI review">
          <p className={styles.reviewSummary}>{milestone.review.summary}</p>

          {milestone.review.checklist.length > 0 && (
            <ul className={styles.reviewChecklist}>
              {milestone.review.checklist.map((item) => (
                <li key={item.criterion} className={styles.reviewItem}>
                  <Icon
                    name={item.met ? "check" : "x"}
                    aria-hidden
                    className={item.met ? styles.passed : styles.failed}
                  />
                  <span>
                    <strong>{item.criterion}</strong>
                    {/* The word as well as the icon and the colour (§8). */}
                    <span className={styles.reviewMet}>{item.met ? " — met" : " — not yet"}</span>
                    <br />
                    {item.note}
                  </span>
                </li>
              ))}
            </ul>
          )}

          <p className={styles.reviewNext}>
            <strong>Next:</strong> {milestone.review.nextStep}
          </p>
        </AiPanel>
      )}

      {demoUrlNeeded && (
        <section aria-labelledby={`demo-${milestone.id}`} className={styles.form}>
          <h4 id={`demo-${milestone.id}`} className={styles.sectionTitle}>
            Your live address
          </h4>
          <Input
            label="Where the app is deployed"
            name="demoUrl"
            type="url"
            placeholder="https://task-tracker.example.com"
            value={demoUrl}
            onChange={(event) => setDemoUrl(event.target.value)}
            error={saveDemoUrl.error instanceof ApiError ? saveDemoUrl.error.message : undefined}
          />
          <Button onClick={() => saveDemoUrl.mutate()} disabled={!demoUrl || saveDemoUrl.isPending}>
            {saveDemoUrl.isPending ? "Checking…" : "Check my live address"}
          </Button>
        </section>
      )}

      {milestone.explanationQuestion && (
        <section aria-labelledby={`explain-${milestone.id}`} className={styles.form}>
          <h4 id={`explain-${milestone.id}`} className={styles.sectionTitle}>
            One question
          </h4>
          <label className={styles.label} htmlFor={`answer-${milestone.id}`}>
            {milestone.explanationQuestion}
          </label>
          <textarea
            id={`answer-${milestone.id}`}
            className={styles.textarea}
            rows={4}
            value={answer}
            onChange={(event) => setAnswer(event.target.value)}
          />
          <Button
            onClick={() => saveAnswer.mutate()}
            disabled={!answer.trim() || saveAnswer.isPending}
          >
            {saveAnswer.isPending ? "Saving…" : "Save answer"}
          </Button>
          {saveAnswer.isSuccess && (
            <p role="status" className={styles.saved}>
              Saved.
            </p>
          )}
        </section>
      )}
    </Card>
  );
}

function CheckRow({ check }: { check: Check }) {
  const icon = check.state === "passed" ? "check" : check.state === "failed" ? "x" : "circle-dot";

  return (
    <li className={styles.check}>
      <Icon name={icon} aria-hidden className={styles[check.state]} />
      <span className={styles.checkName}>{check.name}</span>
      {/*
        The word as well as the icon and the colour (§8). "Still running" is
        what keeps a pending check from reading as a failure.
      */}
      <span className={styles.checkState}>
        {check.state === "passed" ? "Passed" : check.state === "failed" ? "Not passing" : "Still running"}
      </span>
      <span className={styles.checkDetail}>{check.detail}</span>
    </li>
  );
}
