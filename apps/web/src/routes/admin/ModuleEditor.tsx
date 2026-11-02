import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useParams } from "react-router";
import { Badge } from "../../components/core/Badge";
import { Button } from "../../components/core/Button";
import { Card } from "../../components/core/Card";
import {
  adminModuleKey,
  adminModulesApi,
  impactKey,
  type BlockType,
  type Lesson,
  type LessonBlock,
  type Version,
} from "../../api/adminModules";
import { ApiError } from "../../api/client";
import { QuizEditor } from "../../features/admin/QuizEditor";
import { ExerciseEditor } from "../../features/admin/ExerciseEditor";
import styles from "./ModuleEditor.module.css";

/**
 * design.md §6.3's module editor, with §6.4's impact preview.
 *
 * **What a learner is reading never changes while you type.** Editing only ever
 * touches a draft; the published version is read-only here and stays exactly as
 * it is until Publish. That is not a nicety — §6 rule 6 says progress points at
 * the exact version taken, and the API has no endpoint that would move it.
 *
 * So the screen's job is to make the distinction impossible to miss: a draft is
 * editable and labelled, a published version is shown and cannot be touched,
 * and Publish goes through a dialog that counts who it affects before it
 * happens.
 *
 * §6.3's Assessment, Test cases and Rubric tabs are not built yet — the
 * assessment editors are the next piece — so the tab strip shows Content and
 * History, and says plainly what is missing rather than offering a dead tab.
 */

const BLOCK_LABELS: Record<BlockType, string> = {
  paragraph: "Paragraph",
  heading: "Heading",
  list: "List",
  code: "Code",
  callout: "Callout",
};

const emptyBlock = (type: BlockType): LessonBlock => {
  switch (type) {
    case "paragraph":
      return { type: "paragraph", text: "" };
    case "heading":
      return { type: "heading", text: "" };
    case "list":
      return { type: "list", items: [""] };
    case "code":
      return { type: "code", language: "javascript", code: "" };
    case "callout":
      return { type: "callout", tone: "info", text: "" };
  }
};

export function ModuleEditor() {
  const { moduleId = "" } = useParams();
  const client = useQueryClient();
  const [tab, setTab] = useState<"content" | "assessment" | "exercise" | "history">("content");
  const [confirming, setConfirming] = useState(false);

  const { data, isPending, error } = useQuery({
    queryKey: adminModuleKey(moduleId),
    queryFn: ({ signal }) => adminModulesApi.detail(moduleId, signal),
    enabled: Boolean(moduleId),
  });

  const refresh = () => client.invalidateQueries({ queryKey: adminModuleKey(moduleId) });

  const startDraft = useMutation({
    mutationFn: () => adminModulesApi.startDraft(moduleId),
    onSuccess: refresh,
  });

  if (isPending) {
    return (
      <p role="status" aria-live="polite" className={styles.hint}>
        Loading the module…
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

  const draft = data.versions.find((v) => v.status === "draft");
  const published = data.versions.find((v) => v.status === "published");

  return (
    <div className={styles.page}>
      <header className={styles.header}>
        <p className={styles.breadcrumb}>
          <Link to="/admin/modules" className={styles.link}>
            Modules
          </Link>
        </p>
        <h1 className={styles.title}>
          {published?.title ?? draft?.title ?? data.module.slug}
        </h1>
        <p className={styles.meta}>
          <code className={styles.code}>{data.module.slug}</code>{" "}
          <span className={styles.muted}>
            {data.module.kind}
            {data.module.technologyName ? ` · ${data.module.technologyName}` : ""} ·{" "}
            {data.module.skillName}
          </span>
        </p>

        {/* §6.3's header line: the draft and the published version are both facts. */}
        <div className={styles.statuses}>
          {draft ? (
            <Badge tone="notice">Version {draft.versionNo} (draft)</Badge>
          ) : (
            <Badge tone="neutral">No draft</Badge>
          )}
          {published ? (
            <Badge tone="verified">Published: version {published.versionNo}</Badge>
          ) : (
            <Badge tone="neutral">Never published</Badge>
          )}
        </div>
      </header>

      <div className={styles.tabs} role="group" aria-label="What to show">
        <Button
          variant={tab === "content" ? "primary" : "secondary"}
          aria-pressed={tab === "content"}
          onClick={() => setTab("content")}
        >
          Content
        </Button>
        <Button
          variant={tab === "assessment" ? "primary" : "secondary"}
          aria-pressed={tab === "assessment"}
          onClick={() => setTab("assessment")}
        >
          Assessment
        </Button>
        <Button
          variant={tab === "exercise" ? "primary" : "secondary"}
          aria-pressed={tab === "exercise"}
          onClick={() => setTab("exercise")}
        >
          Exercise
        </Button>
        <Button
          variant={tab === "history" ? "primary" : "secondary"}
          aria-pressed={tab === "history"}
          onClick={() => setTab("history")}
        >
          History
        </Button>
      </div>

      {tab === "history" ? (
        <History versions={data.versions} />
      ) : tab === "exercise" ? (
        <ExerciseEditor moduleId={moduleId} versionId={(draft ?? published)?.id ?? ""} />
      ) : tab === "assessment" ? (
        /*
         * The quiz belongs to a version, and the draft is the one being
         * written. With no draft the published version's quiz is shown, which
         * the editor renders read-only.
         */
        <QuizEditor moduleId={moduleId} versionId={(draft ?? published)?.id ?? ""} />
      ) : draft ? (
        <DraftEditor
          // Remount on a different draft; see the note in DraftEditor.
          key={draft.id}
          moduleId={moduleId}
          draft={draft}
          onChanged={refresh}
          onPublish={() => setConfirming(true)}
        />
      ) : (
        <Card className={styles.readOnly}>
          <h2 className={styles.sectionTitle}>
            {published ? `Version ${published.versionNo}, published` : "Nothing written yet"}
          </h2>
          <p className={styles.hint}>
            {published
              ? "Learners are reading this. Start a draft to change it — they keep reading this version until you publish."
              : "Start a draft to write the first version."}
          </p>

          {published && <ReadOnlyLessons lessons={published.lessons} />}

          <Button onClick={() => startDraft.mutate()} disabled={startDraft.isPending}>
            {startDraft.isPending ? "Starting…" : "Start a draft"}
          </Button>
          {startDraft.error && (
            <p role="alert" className={styles.error}>
              {startDraft.error instanceof ApiError
                ? startDraft.error.message
                : "That did not start. Try again in a moment."}
            </p>
          )}
        </Card>
      )}

      {/*
        §6.3's note about what this screen cannot do yet. A dead tab would
        promise an editor that does not exist.
      */}
      {confirming && draft && (
        <ImpactDialog
          moduleId={moduleId}
          draft={draft}
          onClose={() => setConfirming(false)}
          onPublished={() => {
            setConfirming(false);
            void refresh();
          }}
        />
      )}
    </div>
  );
}

/** §6.3's History tab. A superseded version is kept: learners may still be on it. */
function History({ versions }: { versions: Version[] }) {
  return (
    <Card className={styles.panel}>
      <h2 className={styles.sectionTitle}>Versions</h2>
      <ul className={styles.versions}>
        {versions.map((version) => (
          <li key={version.id} className={styles.version}>
            <span className={styles.versionNo}>v{version.versionNo}</span>
            <span className={styles.versionTitle}>{version.title}</span>
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
              {version.lessons.length} lesson{version.lessons.length === 1 ? "" : "s"}
              {version.publishedAt
                ? ` · published ${new Date(version.publishedAt).toLocaleDateString()}`
                : ""}
            </span>
          </li>
        ))}
      </ul>
      <p className={styles.hint}>
        Superseded versions are kept because learners who were partway through them finish them,
        and learners who passed keep the credit.
      </p>
    </Card>
  );
}

function ReadOnlyLessons({ lessons }: { lessons: Lesson[] }) {
  if (lessons.length === 0) return <p className={styles.hint}>No lessons.</p>;

  return (
    <ol className={styles.readOnlyLessons}>
      {lessons.map((lesson, i) => (
        <li key={lesson.id ?? i}>
          <strong>{lesson.title}</strong>{" "}
          <span className={styles.muted}>
            {lesson.blocks.length} block{lesson.blocks.length === 1 ? "" : "s"}
          </span>
        </li>
      ))}
    </ol>
  );
}

/**
 * The draft, and the only editable thing on this screen.
 *
 * Lessons are held in local state and saved as a whole list, which matches what
 * the endpoint takes: `lessons` is keyed by `(version, sort_order)`, so saving
 * one at a time would collide with itself mid-reorder. An author reordering
 * three lessons made one edit, not three.
 */
function DraftEditor({
  moduleId,
  draft,
  onChanged,
  onPublish,
}: {
  moduleId: string;
  draft: Version;
  onChanged: () => void;
  onPublish: () => void;
}) {
  /*
   * The draft is copied into local state once, on mount.
   *
   * **The caller keys this component on `draft.id`**, so a different draft
   * remounts it with fresh values rather than syncing them in an effect. That
   * is not only the lint rule — syncing would also overwrite what an author is
   * typing every time the query refetched, since a save triggers a refetch of
   * the very thing being edited.
   */
  const [title, setTitle] = useState(draft.title);
  const [lessons, setLessons] = useState<Lesson[]>(draft.lessons);
  const [saved, setSaved] = useState(false);

  const save = useMutation({
    mutationFn: async () => {
      await adminModulesApi.saveVersion(moduleId, draft.id, { title });
      await adminModulesApi.saveLessons(moduleId, draft.id, lessons);
    },
    onSuccess: () => {
      setSaved(true);
      onChanged();
    },
  });

  const discard = useMutation({
    mutationFn: () => adminModulesApi.discard(moduleId, draft.id),
    onSuccess: onChanged,
  });

  const change = (next: Lesson[]) => {
    setLessons(next);
    setSaved(false);
  };

  return (
    <Card className={styles.panel}>
      <div className={styles.field}>
        <label className={styles.label} htmlFor="version-title">
          Title
        </label>
        <input
          id="version-title"
          className={styles.input}
          value={title}
          onChange={(event) => {
            setTitle(event.target.value);
            setSaved(false);
          }}
        />
      </div>

      <h2 className={styles.sectionTitle}>Lessons</h2>
      {lessons.length === 0 && (
        <p className={styles.hint}>
          No lessons yet. A version needs at least one before it can be published.
        </p>
      )}

      <ol className={styles.lessons}>
        {lessons.map((lesson, index) => (
          <li key={index} className={styles.lesson}>
            <LessonEditor
              lesson={lesson}
              index={index}
              total={lessons.length}
              onChange={(next) =>
                change(lessons.map((l, i) => (i === index ? next : l)))
              }
              onRemove={() => change(lessons.filter((_, i) => i !== index))}
              onMove={(by) => {
                const target = index + by;
                if (target < 0 || target >= lessons.length) return;
                const next = [...lessons];
                [next[index], next[target]] = [next[target], next[index]];
                change(next);
              }}
            />
          </li>
        ))}
      </ol>

      <Button
        variant="secondary"
        onClick={() => change([...lessons, { title: "New lesson", blocks: [] }])}
      >
        Add lesson
      </Button>

      <div className={styles.actions}>
        <Button onClick={() => save.mutate()} disabled={save.isPending}>
          {save.isPending ? "Saving…" : "Save draft"}
        </Button>
        <Button variant="secondary" onClick={onPublish} disabled={lessons.length === 0}>
          Publish
        </Button>
        <Button
          variant="destructive"
          onClick={() => discard.mutate()}
          disabled={discard.isPending}
        >
          {discard.isPending ? "Discarding…" : "Discard draft"}
        </Button>
      </div>

      {/* A polite region, so "Saved" is announced rather than only seen (§12). */}
      <p role="status" aria-live="polite" className={styles.hint}>
        {saved ? "Draft saved." : "Unsaved changes stay on this screen until you save."}
      </p>

      {(save.error || discard.error) && (
        <p role="alert" className={styles.error}>
          {(save.error ?? discard.error) instanceof ApiError
            ? (save.error ?? discard.error)!.message
            : "That did not save. Try again in a moment."}
        </p>
      )}
    </Card>
  );
}

function LessonEditor({
  lesson,
  index,
  total,
  onChange,
  onRemove,
  onMove,
}: {
  lesson: Lesson;
  index: number;
  total: number;
  onChange: (lesson: Lesson) => void;
  onRemove: () => void;
  onMove: (by: number) => void;
}) {
  const setBlock = (i: number, block: LessonBlock) =>
    onChange({ ...lesson, blocks: lesson.blocks.map((b, j) => (j === i ? block : b)) });

  return (
    <div className={styles.lessonBody}>
      <div className={styles.lessonHead}>
        <label className={styles.visuallyHidden} htmlFor={`lesson-${index}`}>
          Lesson {index + 1} title
        </label>
        <input
          id={`lesson-${index}`}
          className={styles.input}
          value={lesson.title}
          onChange={(event) => onChange({ ...lesson, title: event.target.value })}
        />
        <Button variant="ghost" size="sm" onClick={() => onMove(-1)} disabled={index === 0}>
          Move up
        </Button>
        <Button
          variant="ghost"
          size="sm"
          onClick={() => onMove(1)}
          disabled={index === total - 1}
        >
          Move down
        </Button>
        <Button variant="ghost" size="sm" onClick={onRemove}>
          Remove lesson
        </Button>
      </div>

      {lesson.blocks.map((block, i) => (
        <BlockEditor
          key={i}
          block={block}
          index={i}
          lessonIndex={index}
          onChange={(next) => setBlock(i, next)}
          onRemove={() =>
            onChange({ ...lesson, blocks: lesson.blocks.filter((_, j) => j !== i) })
          }
        />
      ))}

      <div className={styles.addBlocks}>
        {(Object.keys(BLOCK_LABELS) as BlockType[]).map((type) => (
          <Button
            key={type}
            variant="ghost"
            size="sm"
            onClick={() => onChange({ ...lesson, blocks: [...lesson.blocks, emptyBlock(type)] })}
          >
            Add {BLOCK_LABELS[type].toLowerCase()}
          </Button>
        ))}
      </div>
    </div>
  );
}

/**
 * One block.
 *
 * **An exhaustive `switch` over the union**, as §13.3 requires of `LessonBody`:
 * a new block type is a compile error here as well as in the renderer, so the
 * editor cannot silently fail to offer one the learner's screen can draw.
 */
function BlockEditor({
  block,
  index,
  lessonIndex,
  onChange,
  onRemove,
}: {
  block: LessonBlock;
  index: number;
  lessonIndex: number;
  onChange: (block: LessonBlock) => void;
  onRemove: () => void;
}) {
  const id = `block-${lessonIndex}-${index}`;

  const body = () => {
    switch (block.type) {
      case "paragraph":
      case "heading":
        return (
          <textarea
            id={id}
            className={styles.textarea}
            rows={block.type === "paragraph" ? 3 : 1}
            value={block.text}
            onChange={(event) => onChange({ ...block, text: event.target.value })}
          />
        );
      case "callout":
        return (
          <>
            <select
              className={styles.select}
              value={block.tone}
              onChange={(event) =>
                onChange({ ...block, tone: event.target.value as "info" | "notice" })
              }
              aria-label="Callout tone"
            >
              <option value="info">Info</option>
              <option value="notice">Notice</option>
            </select>
            <textarea
              id={id}
              className={styles.textarea}
              rows={2}
              value={block.text}
              onChange={(event) => onChange({ ...block, text: event.target.value })}
            />
          </>
        );
      case "list":
        return (
          <textarea
            id={id}
            className={styles.textarea}
            rows={Math.max(2, block.items.length)}
            value={block.items.join("\n")}
            // One item per line: the simplest thing that cannot lose an item.
            onChange={(event) =>
              onChange({ ...block, items: event.target.value.split("\n") })
            }
          />
        );
      case "code":
        return (
          <>
            <input
              className={styles.input}
              value={block.language}
              onChange={(event) => onChange({ ...block, language: event.target.value })}
              aria-label="Code language"
            />
            <textarea
              id={id}
              className={styles.code_area}
              rows={6}
              value={block.code}
              onChange={(event) => onChange({ ...block, code: event.target.value })}
            />
          </>
        );
    }
  };

  return (
    <div className={styles.block}>
      <div className={styles.blockHead}>
        <label className={styles.blockLabel} htmlFor={id}>
          {BLOCK_LABELS[block.type]}
        </label>
        <Button variant="ghost" size="sm" onClick={onRemove}>
          Remove
        </Button>
      </div>
      {body()}
    </div>
  );
}

/**
 * §6.4's impact preview.
 *
 * **It counts before it asks.** The three sentences under the numbers are
 * promises about real people — "learners taking version 2 will finish it" is
 * §6 rule 6 stated to the person about to rely on it — so the dialog loads the
 * counts first and the publish button waits for them.
 */
function ImpactDialog({
  moduleId,
  draft,
  onClose,
  onPublished,
}: {
  moduleId: string;
  draft: Version;
  onClose: () => void;
  onPublished: () => void;
}) {
  const { data, isPending } = useQuery({
    queryKey: impactKey(moduleId, draft.id),
    queryFn: ({ signal }) => adminModulesApi.impact(moduleId, draft.id, signal),
  });

  const publish = useMutation({
    mutationFn: () => adminModulesApi.publish(moduleId, draft.id),
    onSuccess: onPublished,
  });

  return (
    <div className={styles.backdrop}>
      <Card
        className={styles.dialog}
        role="dialog"
        aria-modal="true"
        aria-labelledby="impact-title"
      >
        <h2 id="impact-title" className={styles.dialogTitle}>
          Publish version {draft.versionNo} of {draft.title}?
        </h2>

        {isPending || !data ? (
          <p role="status" aria-live="polite" className={styles.hint}>
            Counting who this affects…
          </p>
        ) : (
          <>
            <dl className={styles.counts}>
              <div className={styles.count}>
                <dt className={styles.countValue}>{data.activeRoadmaps}</dt>
                <dd className={styles.countLabel}>active roadmaps include this module</dd>
              </div>
              <div className={styles.count}>
                <dt className={styles.countValue}>{data.takingCurrent}</dt>
                <dd className={styles.countLabel}>
                  learners are taking version {data.currentVersionNo ?? "—"} now
                </dd>
              </div>
              <div className={styles.count}>
                <dt className={styles.countValue}>{data.passed}</dt>
                <dd className={styles.countLabel}>learners have passed it</dd>
              </div>
            </dl>

            {/* §6 rule 6, said to the person about to rely on it. */}
            <ul className={styles.promises}>
              <li>
                Learners taking version {data.currentVersionNo ?? "—"} will finish it.
              </li>
              <li>Learners who passed keep their credit.</li>
              <li>New learners get version {data.versionNo}.</li>
            </ul>
          </>
        )}

        <div className={styles.dialogActions}>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={() => publish.mutate()} disabled={isPending || publish.isPending}>
            {publish.isPending ? "Publishing…" : `Publish version ${draft.versionNo}`}
          </Button>
        </div>

        {publish.error && (
          <p role="alert" className={styles.error}>
            {publish.error instanceof ApiError
              ? publish.error.message
              : "That did not publish. Try again in a moment."}
          </p>
        )}
      </Card>
    </div>
  );
}
