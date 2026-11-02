import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Badge } from "../../components/core/Badge";
import { Button } from "../../components/core/Button";
import { Card } from "../../components/core/Card";
import {
  adminBriefsApi,
  briefKey,
  briefsKey,
  type Milestone,
  type Version,
} from "../../api/adminBriefs";
import { ApiError } from "../../api/client";
import styles from "./Briefs.module.css";

/**
 * design.md §6.5 — the capstone brief editor.
 *
 * **Briefs version exactly as modules do**, so this is the module editor's
 * shape: a draft is copied from the published version, only a draft is
 * editable, and a learner part-way through finishes the version they started
 * because `capstone_projects` references it and nothing moves them.
 *
 * The one gate particular to a brief is §6.5's: **it cannot be published for a
 * technology option without a starter template**. A learner who picks Vue and
 * finds none cannot start their capstone at all, so the missing ones are named
 * at the top rather than discovered at Publish.
 */

const blankMilestone = (): Milestone => ({
  title: "",
  acceptanceCriteria: [],
  reviewChecklist: [],
  explanationQuestion: null,
  checks: [],
});

export function Briefs() {
  const { data, isPending, error } = useQuery({
    queryKey: briefsKey,
    queryFn: ({ signal }) => adminBriefsApi.list(signal),
  });

  if (isPending) {
    return (
      <p role="status" aria-live="polite" className={styles.hint}>
        Loading capstone briefs…
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

  return (
    <div className={styles.page}>
      <h1 className={styles.title}>Capstone projects</h1>
      {data.briefs.length === 0 ? (
        <Card className={styles.empty}>
          <p className={styles.emptyText}>No briefs yet.</p>
        </Card>
      ) : (
        data.briefs.map((brief) => <BriefDetail key={brief.id} briefId={brief.id} />)
      )}
    </div>
  );
}

function BriefDetail({ briefId }: { briefId: string }) {
  const client = useQueryClient();
  const [tab, setTab] = useState<"milestones" | "templates" | "history">("milestones");

  const { data, isPending, error } = useQuery({
    queryKey: briefKey(briefId),
    queryFn: ({ signal }) => adminBriefsApi.detail(briefId, signal),
  });

  const refresh = () => client.invalidateQueries({ queryKey: briefKey(briefId) });

  const startDraft = useMutation({
    mutationFn: () => adminBriefsApi.startDraft(briefId),
    onSuccess: refresh,
  });

  const publish = useMutation({
    mutationFn: (versionId: string) => adminBriefsApi.publish(briefId, versionId),
    onSuccess: refresh,
  });

  if (isPending) {
    return (
      <p role="status" aria-live="polite" className={styles.hint}>
        Loading the brief…
      </p>
    );
  }

  if (error || !data) {
    return (
      <p role="alert" className={styles.error}>
        {error instanceof ApiError ? error.message : "That did not load."}
      </p>
    );
  }

  const draft = data.versions.find((v) => v.status === "draft");
  const published = data.versions.find((v) => v.status === "published");
  const current = draft ?? published;

  return (
    <section className={styles.brief} aria-labelledby={`brief-${briefId}`}>
      <header className={styles.header}>
        <h2 id={`brief-${briefId}`} className={styles.briefTitle}>
          {current?.title ?? data.brief.slug}
        </h2>
        {draft ? (
          <Badge tone="notice">Version {draft.versionNo} (draft)</Badge>
        ) : (
          <Badge tone="neutral">No draft</Badge>
        )}
        {published && <Badge tone="verified">Published: version {published.versionNo}</Badge>}
      </header>

      {/*
        §6.5's gate, named before Publish rather than discovered at it. A
        learner who picks a technology with no template cannot start at all.
      */}
      {current && current.missingTemplates.length > 0 && (
        <Card className={styles.gate}>
          <h3 className={styles.sectionTitle}>Cannot be published yet</h3>
          <p className={styles.gateText}>
            No starter template for <strong>{current.missingTemplates.join(", ")}</strong>. A
            learner who picks it could not start the project.
          </p>
        </Card>
      )}

      <div className={styles.tabs} role="group" aria-label="What to show">
        {(["milestones", "templates", "history"] as const).map((name) => (
          <Button
            key={name}
            variant={tab === name ? "primary" : "secondary"}
            aria-pressed={tab === name}
            onClick={() => setTab(name)}
          >
            {name[0].toUpperCase() + name.slice(1)}
          </Button>
        ))}
      </div>

      {tab === "history" ? (
        <History versions={data.versions} />
      ) : tab === "templates" ? (
        <Templates
          briefId={briefId}
          version={current}
          technologies={data.technologies}
          editable={Boolean(draft)}
          onSaved={refresh}
        />
      ) : draft ? (
        <Milestones key={draft.id} briefId={briefId} draft={draft} onSaved={refresh} />
      ) : (
        <Card className={styles.panel}>
          <p className={styles.hint}>
            {published
              ? "Learners are building this. Start a draft to change it — they keep the version they started until you publish."
              : "Start a draft to write the first version."}
          </p>
          <Button onClick={() => startDraft.mutate()} disabled={startDraft.isPending}>
            {startDraft.isPending ? "Starting…" : "Start a draft"}
          </Button>
        </Card>
      )}

      {draft && (
        <div className={styles.actions}>
          <Button
            onClick={() => publish.mutate(draft.id)}
            disabled={publish.isPending || draft.missingTemplates.length > 0}
          >
            {publish.isPending ? "Publishing…" : `Publish version ${draft.versionNo}`}
          </Button>
        </div>
      )}

      {publish.error && (
        <p role="alert" className={styles.error}>
          {publish.error instanceof ApiError ? publish.error.message : "That did not publish."}
        </p>
      )}
    </section>
  );
}

function History({ versions }: { versions: Version[] }) {
  return (
    <Card className={styles.panel}>
      <ul className={styles.versions}>
        {versions.map((version) => (
          <li key={version.id} className={styles.version}>
            <span className={styles.versionNo}>v{version.versionNo}</span>
            <span>{version.title}</span>
            <Badge
              tone={
                version.status === "published"
                  ? "verified"
                  : version.status === "draft"
                    ? "notice"
                    : "neutral"
              }
            >
              {version.status}
            </Badge>
            <span className={styles.muted}>
              {version.milestones.length} milestone
              {version.milestones.length === 1 ? "" : "s"}
            </span>
          </li>
        ))}
      </ul>
      <p className={styles.hint}>
        Superseded versions are kept because learners who were building them finish them.
      </p>
    </Card>
  );
}

function Templates({
  briefId,
  version,
  technologies,
  editable,
  onSaved,
}: {
  briefId: string;
  version: Version | undefined;
  technologies: { id: string; name: string }[];
  editable: boolean;
  onSaved: () => void;
}) {
  const [repos, setRepos] = useState<Record<string, string>>(() =>
    Object.fromEntries(
      technologies.map((tech) => [
        tech.id,
        version?.templates.find((t) => t.technologyId === tech.id)?.repoFullName ?? "",
      ]),
    ),
  );

  const save = useMutation({
    mutationFn: () =>
      adminBriefsApi.saveTemplates(
        briefId,
        version!.id,
        Object.entries(repos)
          .filter(([, repo]) => repo.trim() !== "")
          .map(([technologyId, repoFullName]) => ({ technologyId, repoFullName })),
      ),
    onSuccess: onSaved,
  });

  return (
    <Card className={styles.panel}>
      <h3 className={styles.sectionTitle}>Starter templates</h3>
      <p className={styles.hint}>
        One repository per technology option. The brief cannot be published for an option without
        one.
      </p>

      {technologies.map((tech) => (
        <div key={tech.id} className={styles.field}>
          <label className={styles.label} htmlFor={`template-${tech.id}`}>
            {tech.name}
          </label>
          <input
            id={`template-${tech.id}`}
            className={styles.input}
            placeholder="owner/name"
            disabled={!editable}
            value={repos[tech.id] ?? ""}
            onChange={(event) => setRepos({ ...repos, [tech.id]: event.target.value })}
          />
        </div>
      ))}

      {editable && (
        <Button onClick={() => save.mutate()} disabled={save.isPending}>
          {save.isPending ? "Saving…" : "Save templates"}
        </Button>
      )}

      {save.error && (
        <p role="alert" className={styles.error}>
          {save.error instanceof ApiError ? save.error.message : "That did not save."}
        </p>
      )}
    </Card>
  );
}

function Milestones({
  briefId,
  draft,
  onSaved,
}: {
  briefId: string;
  draft: Version;
  onSaved: () => void;
}) {
  const [milestones, setMilestones] = useState<Milestone[]>(draft.milestones);

  const save = useMutation({
    mutationFn: () => adminBriefsApi.saveMilestones(briefId, draft.id, milestones),
    onSuccess: onSaved,
  });

  const set = (index: number, milestone: Milestone) =>
    setMilestones(milestones.map((m, i) => (i === index ? milestone : m)));

  return (
    <Card className={styles.panel}>
      <h3 className={styles.sectionTitle}>Milestones</h3>
      {milestones.length === 0 && (
        <p className={styles.hint}>A brief needs at least one milestone to be published.</p>
      )}

      <ol className={styles.milestones}>
        {milestones.map((milestone, index) => (
          <li key={index} className={styles.milestone}>
            <div className={styles.field}>
              <label className={styles.label} htmlFor={`milestone-${index}`}>
                Milestone {index + 1}
              </label>
              <input
                id={`milestone-${index}`}
                className={styles.input}
                value={milestone.title}
                onChange={(event) => set(index, { ...milestone, title: event.target.value })}
              />
            </div>

            <div className={styles.field}>
              <label className={styles.label} htmlFor={`criteria-${index}`}>
                Acceptance criteria — one per line
              </label>
              <textarea
                id={`criteria-${index}`}
                className={styles.textarea}
                rows={3}
                value={milestone.acceptanceCriteria.join("\n")}
                onChange={(event) =>
                  set(index, {
                    ...milestone,
                    acceptanceCriteria: event.target.value.split("\n").filter(Boolean),
                  })
                }
              />
            </div>

            <div className={styles.field}>
              <label className={styles.label} htmlFor={`checklist-${index}`}>
                AI review checklist — one per line
              </label>
              <textarea
                id={`checklist-${index}`}
                className={styles.textarea}
                rows={3}
                value={milestone.reviewChecklist.join("\n")}
                onChange={(event) =>
                  set(index, {
                    ...milestone,
                    reviewChecklist: event.target.value.split("\n").filter(Boolean),
                  })
                }
              />
            </div>

            <div className={styles.field}>
              <label className={styles.label} htmlFor={`question-${index}`}>
                Explanation question (optional)
              </label>
              <input
                id={`question-${index}`}
                className={styles.input}
                value={milestone.explanationQuestion ?? ""}
                onChange={(event) =>
                  set(index, {
                    ...milestone,
                    explanationQuestion: event.target.value || null,
                  })
                }
              />
            </div>

            <p className={styles.muted}>
              {milestone.checks.length} automatic check
              {milestone.checks.length === 1 ? "" : "s"}
            </p>

            <Button
              variant="ghost"
              size="sm"
              onClick={() => setMilestones(milestones.filter((_, i) => i !== index))}
            >
              Remove milestone
            </Button>
          </li>
        ))}
      </ol>

      <div className={styles.actions}>
        <Button
          variant="secondary"
          onClick={() => setMilestones([...milestones, blankMilestone()])}
        >
          Add milestone
        </Button>
        <Button onClick={() => save.mutate()} disabled={save.isPending}>
          {save.isPending ? "Saving…" : "Save milestones"}
        </Button>
      </div>

      {/*
        §6.5's check editor is not built: the checks a milestone carries are
        shown as a count and still come from the seed files.
      */}
      <p className={styles.hint}>
        Editing a milestone&rsquo;s automatic checks is not built yet — they still come from the
        seed files.
      </p>

      {save.error && (
        <p role="alert" className={styles.error}>
          {save.error instanceof ApiError ? save.error.message : "That did not save."}
        </p>
      )}
    </Card>
  );
}
