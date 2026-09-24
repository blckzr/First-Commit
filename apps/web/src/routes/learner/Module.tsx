import { useState } from "react";
import { Link, useParams, useSearchParams } from "react-router";
import { Badge } from "../../components/core/Badge";
import { Button } from "../../components/core/Button";
import { Card } from "../../components/core/Card";
import { Icon } from "../../components/core/Icon";
import { LinkButton } from "../../components/core/LinkButton";
import { LessonBody } from "../../components/learning/LessonBody";
import { LessonRow } from "../../components/learning/LessonRow";
import { ApiError } from "../../api/client";
import type { ModulePage } from "../../api/modules";
import {
  useCompleteLesson,
  useModule,
  useStartModule,
} from "../../features/module/useModule";
import styles from "./Module.module.css";

/**
 * design.md §5.9 — the module page.
 *
 * Lessons in order down the left, the reading column on the right, and the
 * quiz and exercise as rows at the end of the same list. The selected lesson
 * lives in the URL so a lesson is linkable and survives a breakpoint change
 * (§13.5).
 */
export function Module() {
  const { id } = useParams();
  const { data, isPending, error } = useModule(id);

  if (isPending) {
    return (
      <p role="status" aria-live="polite" className={styles.loading}>
        Loading this module…
      </p>
    );
  }

  if (error || !data) {
    const notFound = error instanceof ApiError && error.status === 404;
    return (
      <Card surface="white" radius="panel" padding="lg" className={styles.empty}>
        <h1 className={styles.title}>
          {notFound ? "We couldn't find that module" : "This module isn't available right now"}
        </h1>
        <p className={styles.lede}>
          {notFound
            ? "It may have been archived, or the link may be wrong."
            : "This is usually temporary. Your progress is safe — try again in a moment."}
        </p>
        <LinkButton to="/app" icon="arrow-right">Back to home</LinkButton>
      </Card>
    );
  }

  return <ModuleView module={data} />;
}

function ModuleView({ module }: { module: ModulePage }) {
  const [params, setParams] = useSearchParams();
  const start = useStartModule(module.moduleId);
  const completeLesson = useCompleteLesson(module.moduleId);
  const [justRead, setJustRead] = useState<string | null>(null);

  const quiz = module.assessments.find((a) => a.type === "quiz");
  const lessonParam = params.get("lesson");
  const selected =
    module.lessons.find((l) => l.id === lessonParam) ??
    module.lessons.find((l) => l.id === module.currentLessonId) ??
    module.lessons[0] ??
    null;

  const index = selected ? module.lessons.indexOf(selected) : -1;
  const next = index >= 0 ? module.lessons[index + 1] : undefined;
  const previous = index > 0 ? module.lessons[index - 1] : undefined;

  function openLesson(lessonId: string) {
    setParams(
      (prev) => {
        const p = new URLSearchParams(prev);
        p.set("lesson", lessonId);
        return p;
      },
      { replace: true },
    );
  }

  async function readAndContinue() {
    if (!selected) return;
    if (!module.enrolled) await start.mutateAsync();
    await completeLesson.mutateAsync(selected.id);
    setJustRead(selected.title);
    if (next) openLesson(next.id);
  }

  return (
    <>
      <Card surface="white" radius="panel" padding="lg" className={styles.header}>
        <div className={styles.headerText}>
          <LinkButton variant="ghost" size="sm" to="/app" icon="arrow-left" iconPosition="left">
            Back to roadmap
          </LinkButton>
          <h1 className={styles.title}>{module.title}</h1>
          <p className={styles.meta}>
            {module.skillTitle} · about {module.estimatedHours} hours · version {module.versionNo}
          </p>
        </div>
        <div className={styles.headerBadges}>
          {module.technologyName && <Badge tone="violet">{module.technologyName}</Badge>}
          {module.completion &&
            (module.completion.method === "tested_out" ? (
              <Badge tone="verified" icon="check">Tested out</Badge>
            ) : (
              <Badge tone="verified" icon="check">
                Passed{module.completion.score !== null ? `, ${module.completion.score}%` : ""}
              </Badge>
            ))}
        </div>
      </Card>

      {/* §5.9's two version notices. Both say the learner keeps their credit. */}
      {module.newerVersion && (
        <p className={styles.notice} role="note">
          <Icon name="info" size={17} className={styles.noticeIcon} />
          <span>
            {module.completion
              ? `This module was updated after you passed it. Your credit stays. What changed: ${module.newerVersion.changeSummary}`
              : `A newer version of this module is available. You can finish your current version and keep your progress. What changed: ${module.newerVersion.changeSummary}`}
          </span>
        </p>
      )}

      <div className={styles.body}>
        <nav className={styles.rail} aria-label="Lessons in this module">
          <ul className={styles.railList}>
            {module.lessons.map((lesson, i) => (
              <li key={lesson.id}>
                <LessonRow
                  label={`${i + 1} ${lesson.title}`}
                  state={lesson.completed ? "done" : "todo"}
                  current={lesson.id === selected?.id}
                  onClick={() => openLesson(lesson.id)}
                />
              </li>
            ))}
            {/*
              §5.9: the quiz and the exercise are rows in this list too. A link
              rather than a `LessonRow`, because it leaves the page — the
              lesson rows only change what is beside them.
            */}
            {quiz && (
              <li>
                <Link to={`/app/quiz/${quiz.id}`} className={styles.railAssessment}>
                  <span>Quiz</span>
                  <span className={styles.railAssessmentMeta}>
                    {quiz.questionCount} questions
                    {quiz.bestScore !== null ? ` · best ${quiz.bestScore}%` : ""}
                  </span>
                </Link>
              </li>
            )}
          </ul>
        </nav>

        {/*
          A section, not a second `<main>`: the learner shell already renders
          one, and a page with two main landmarks has none a screen reader can
          jump to reliably.
        */}
        <Card as="section" surface="white" radius="panel" padding="lg" className={styles.reading}>
          {/* Announced politely, so a screen reader hears that the lesson moved. */}
          <p className={styles.srOnly} role="status">
            {justRead ? `${justRead} marked as read.` : ""}
          </p>

          {!selected && (
            <p className={styles.unwritten}>
              This module has no lessons yet.
              {quiz ? " You can still take the quiz." : ""}
            </p>
          )}

          {selected && (
            <>
              <h2 className={styles.lessonHeading}>{selected.title}</h2>

              <div className={styles.lessonBody}>
                {selected.content ? (
                  <LessonBody blocks={selected.content.blocks} />
                ) : (
                  <p className={styles.unwritten}>
                    This lesson hasn&apos;t been written yet. The quiz and your progress still work.
                  </p>
                )}
              </div>

              <div className={styles.lessonActions}>
                {/*
                  Always rendered, disabled on the first lesson. §5.9 shows
                  Previous on every lesson, and a control that disappears moves
                  the one beside it under the reader's cursor.
                */}
                <Button
                  variant="outline"
                  icon="arrow-left"
                  iconPosition="left"
                  disabled={!previous}
                  onClick={() => previous && openLesson(previous.id)}
                >
                  Previous
                </Button>

                <Button
                  variant="primary"
                  icon="arrow-right"
                  onClick={() => void readAndContinue()}
                  loading={completeLesson.isPending || start.isPending}
                  loadingLabel="Saving…"
                >
                  {next ? "Next lesson" : selected.completed ? "Marked as read" : "Mark as read"}
                </Button>
              </div>
            </>
          )}
        </Card>
      </div>

      {quiz && !module.completion && (
        <Card surface="soft" radius="card" padding="md" className={styles.testOut}>
          <span className={styles.testOutLabel}>Already know this?</span>
          <LinkButton variant="secondary" size="sm" to={`/app/quiz/${quiz.id}?testout=1`}>
            Take the assessment to test out
          </LinkButton>
        </Card>
      )}
    </>
  );
}
