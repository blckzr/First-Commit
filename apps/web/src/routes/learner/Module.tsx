import { useState } from "react";
import { useParams, useSearchParams } from "react-router";
import { Badge } from "../../components/core/Badge";
import { Button } from "../../components/core/Button";
import { Icon } from "../../components/core/Icon";
import { LinkButton } from "../../components/core/LinkButton";
import { LessonBody } from "../../components/learning/LessonBody";
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
 * quiz and exercise at the end of the list. The selected lesson lives in the
 * URL so a lesson is linkable and survives a breakpoint change (§13.5).
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
      <div className={styles.empty}>
        <h1 className={styles.title}>
          {notFound ? "We couldn't find that module" : "This module isn't available right now"}
        </h1>
        <p>
          {notFound
            ? "It may have been archived, or the link may be wrong."
            : "This is usually temporary. Your progress is safe — try again in a moment."}
        </p>
        <LinkButton to="/app" icon="arrow-right">Back to home</LinkButton>
      </div>
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
    <div className={styles.page}>
      <header className={styles.header}>
        <LinkButton variant="ghost" size="sm" to="/app" icon="arrow-left" iconPosition="left">
          Back to roadmap
        </LinkButton>

        <div className={styles.titleRow}>
          <div>
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
        </div>

        {module.description && <p className={styles.description}>{module.description}</p>}

        {/* §5.9's two version notices. Both say the learner keeps their credit. */}
        {module.newerVersion && (
          <p className={styles.notice} role="note">
            <Icon name="info" size={16} />
            {module.completion
              ? `This module was updated after you passed it. Your credit stays. What changed: ${module.newerVersion.changeSummary}`
              : `A newer version of this module is available. You can finish your current version and keep your progress. What changed: ${module.newerVersion.changeSummary}`}
          </p>
        )}
      </header>

      <div className={styles.body}>
        <nav className={styles.lessonNav} aria-label="Lessons in this module">
          <ol className={styles.lessonList}>
            {module.lessons.map((lesson, i) => (
              <li key={lesson.id}>
                <button
                  type="button"
                  className={[styles.lessonLink, lesson.id === selected?.id ? styles.lessonCurrent : ""]
                    .filter(Boolean)
                    .join(" ")}
                  aria-current={lesson.id === selected?.id ? "true" : undefined}
                  onClick={() => openLesson(lesson.id)}
                >
                  <span className={styles.lessonNumber}>{i + 1}</span>
                  <span className={styles.lessonTitle}>{lesson.title}</span>
                  {/* §8: never a tick alone — the word is there for a screen reader. */}
                  {lesson.completed && (
                    <span className={styles.lessonDone}>
                      <Icon name="check" size={14} />
                      <span className={styles.srOnly}>Read</span>
                    </span>
                  )}
                </button>
              </li>
            ))}
          </ol>

          {quiz && (
            <div className={styles.assessments}>
              <LinkButton
                variant={quiz.passed ? "outline" : "primary"}
                size="sm"
                fullWidth
                to={`/app/quiz/${quiz.id}`}
                icon="arrow-right"
              >
                {quiz.passed ? "Retake quiz" : quiz.attempts > 0 ? "Try the quiz again" : "Take the quiz"}
              </LinkButton>
              <p className={styles.assessmentMeta}>
                {quiz.questionCount} questions · pass at {quiz.passingScore}%
                {quiz.bestScore !== null ? ` · best ${quiz.bestScore}%` : ""}
              </p>
            </div>
          )}
        </nav>

        <main className={styles.reading}>
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
            <article className={styles.article}>
              <h2 className={styles.lessonHeading}>{selected.title}</h2>

              {selected.content ? (
                <LessonBody blocks={selected.content.blocks} />
              ) : (
                <p className={styles.unwritten}>
                  This lesson hasn&apos;t been written yet. The quiz and your progress still work.
                </p>
              )}

              <div className={styles.lessonActions}>
                {/*
                  Always rendered, disabled on the first lesson. §5.9 shows
                  Previous on every lesson, and a control that disappears moves
                  the one beside it under the reader's cursor.
                */}
                <Button
                  variant="ghost"
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
            </article>
          )}

          {quiz && !module.completion && (
            <p className={styles.testOut}>
              Already know this?{" "}
              <LinkButton variant="ghost" size="sm" to={`/app/quiz/${quiz.id}?testout=1`}>
                Take the assessment to test out
              </LinkButton>
            </p>
          )}
        </main>
      </div>
    </div>
  );
}
