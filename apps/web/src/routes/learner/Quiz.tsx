import { useState } from "react";
import { useParams, useSearchParams } from "react-router";
import { Button } from "../../components/core/Button";
import { Card } from "../../components/core/Card";
import { Icon } from "../../components/core/Icon";
import { LinkButton } from "../../components/core/LinkButton";
import { RadioOption } from "../../components/forms/RadioOption";
import { ProgressBar } from "../../components/learning/ProgressBar";
import { ApiError } from "../../api/client";
import type { GradeResult, Quiz as QuizData } from "../../api/modules";
import { useQuiz, useSubmitQuiz } from "../../features/module/useModule";
import styles from "./Quiz.module.css";

/**
 * design.md §5.10 — the quiz.
 *
 * One question at a time, **no time limit** (§12), and answers kept as the
 * learner moves. Nothing here computes a score: the answers go to the API and
 * the result comes back graded (AGENT.md §6 rule 1), which is why there is no
 * answer key in this file to accidentally render.
 */
export function Quiz() {
  const { id } = useParams();
  const { data, isPending, error } = useQuiz(id);

  if (isPending) {
    return (
      <p role="status" aria-live="polite" className={styles.loading}>
        Loading the quiz…
      </p>
    );
  }

  if (error || !data) {
    const notFound = error instanceof ApiError && error.status === 404;
    return (
      <Card surface="white" radius="panel" padding="lg" className={styles.empty}>
        <h1 className={styles.title}>
          {notFound ? "We couldn't find that quiz" : "The quiz isn't available right now"}
        </h1>
        <p className={styles.line}>
          {notFound
            ? "It may have been replaced by a newer version of the module."
            : "This is usually temporary. Nothing you have answered is lost — try again in a moment."}
        </p>
        <LinkButton to="/app" icon="arrow-right">Back to home</LinkButton>
      </Card>
    );
  }

  return <QuizView quiz={data} />;
}

function QuizView({ quiz }: { quiz: QuizData }) {
  const [params] = useSearchParams();
  const testOut = params.get("testout") === "1";

  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [at, setAt] = useState(0);
  const [result, setResult] = useState<GradeResult | null>(null);
  const submit = useSubmitQuiz(quiz.id, quiz.moduleId);

  if (result) {
    return <Result quiz={quiz} result={result} onRetake={() => { setResult(null); setAnswers({}); setAt(0); }} />;
  }

  const question = quiz.questions[at];
  const answered = Object.keys(answers).length;
  const last = at === quiz.questions.length - 1;
  const error = submit.error instanceof ApiError ? submit.error : null;

  return (
    <div className={styles.page}>
      {testOut && (
        <p className={styles.testOutNote}>
          You are testing out. Passing marks the module complete without working through the
          lessons. There is no penalty for not passing.
        </p>
      )}

      {question && (
        <Card surface="white" radius="panel" padding="lg">
          <form
            className={styles.form}
            onSubmit={(e) => {
              e.preventDefault();
              if (!last) {
                setAt(at + 1);
                return;
              }
              submit.mutate(
                { answers, testOut },
                { onSuccess: (graded) => setResult(graded) },
              );
            }}
          >
            <div className={styles.headRow}>
              <h1 className={styles.title}>Quiz: {quiz.moduleTitle}</h1>
              <span className={styles.counter}>
                Question {at + 1} of {quiz.questions.length}
              </span>
            </div>

            {/* The counter above is the bar's text (§7), so it is not repeated. */}
            <ProgressBar
              hideLabel
              value={(answered / quiz.questions.length) * 100}
              label={`${answered} of ${quiz.questions.length} answered`}
            />

            <fieldset className={styles.field}>
              <legend className={styles.prompt}>{question.prompt}</legend>
              <div className={styles.options}>
                {question.options.map((option) => (
                  <RadioOption
                    key={option.id}
                    name={question.id}
                    label={option.text}
                    checked={answers[question.id] === option.id}
                    onChange={() => setAnswers({ ...answers, [question.id]: option.id })}
                  />
                ))}
              </div>
            </fieldset>

            {error && <p role="alert" className={styles.error}>{error.message}</p>}

            <div className={styles.actions}>
              <Button
                variant="outline"
                icon="arrow-left"
                iconPosition="left"
                type="button"
                disabled={at === 0}
                onClick={() => setAt(at - 1)}
              >
                Previous
              </Button>

              <Button
                type="submit"
                variant="primary"
                icon="arrow-right"
                loading={submit.isPending}
                loadingLabel="Marking…"
              >
                {last ? "Submit answers" : "Next"}
              </Button>
            </div>
          </form>
        </Card>
      )}

      {/* §12: no time limit, and the learner should know it. */}
      <p className={styles.reassurance}>
        There is no time limit. You can go back and change any answer before you submit.
      </p>
    </div>
  );
}

function Result({
  quiz,
  result,
  onRetake,
}: {
  quiz: QuizData;
  result: GradeResult;
  onRetake: () => void;
}) {
  /**
   * §5.10's "Topics to review": the questions answered wrongly, with the lesson
   * each came from. Deliberately not "here is the right answer" — the API
   * withholds that so a retake still means something.
   */
  const toReview = result.answers.filter((a) => !a.correct);
  const byId = new Map(quiz.questions.map((q) => [q.id, q]));
  const explained = result.answers.filter((a) => a.correct && a.explanation);

  return (
    <div className={styles.page}>
      <Card surface="white" radius="panel" padding="lg" className={styles.result}>
        {result.passed ? (
          /* §8: a status is icon + text + colour. The tick and the green are
             the first two; the sentence is the third. */
          <div className={styles.passedLine}>
            <Icon name="check" size={24} className={styles.passedIcon} />
            <h1 className={styles.resultTitle} tabIndex={-1}>
              You passed with {result.correctCount} of {result.questionCount} ({result.score}%)
            </h1>
          </div>
        ) : (
          <h1 className={styles.resultTitle} tabIndex={-1}>
            You got {result.correctCount} of {result.questionCount} ({result.score}%). You need{" "}
            {result.needed} to pass.
          </h1>
        )}

        {result.passed && result.completedModule && (
          <p className={styles.line}>{quiz.moduleTitle} is now a verified skill.</p>
        )}
        {result.passed && !result.completedModule && (
          <p className={styles.line}>
            You had already completed {quiz.moduleTitle}. This attempt is recorded, and your best
            score stands.
          </p>
        )}

        {toReview.length > 0 && (
          <section className={styles.review} aria-labelledby="review-heading">
            <h2 id="review-heading" className={styles.reviewLabel}>
              Topics to review
            </h2>
            <ul className={styles.reviewList}>
              {toReview.map((answer) => (
                <li key={answer.questionId} className={styles.reviewRow}>
                  <span className={styles.reviewPrompt}>
                    {byId.get(answer.questionId)?.prompt ?? "A question you missed"}
                  </span>
                  {answer.linkedLessonId && (
                    <LinkButton
                      variant="ghost"
                      size="sm"
                      to={`/app/module/${quiz.moduleId}?lesson=${answer.linkedLessonId}`}
                    >
                      Review lesson
                    </LinkButton>
                  )}
                </li>
              ))}
            </ul>
          </section>
        )}

        {/*
          Explanations come back only for questions answered correctly (§5.10),
          so this confirms understanding without handing over the key. On a
          pass it sits on the verified tint, which is the prototype's
          "Review: Question 5, rendering lists" box.
        */}
        {explained.length > 0 && (
          <section className={styles.right} aria-labelledby="right-heading">
            <h2 id="right-heading" className={styles.reviewLabel}>
              What you got right
            </h2>
            <ul className={styles.rightList}>
              {explained.map((answer) => (
                <li key={answer.questionId}>
                  <span className={styles.reviewPrompt}>
                    {byId.get(answer.questionId)?.prompt}
                  </span>
                  <span className={styles.explanation}>{answer.explanation}</span>
                </li>
              ))}
            </ul>
          </section>
        )}

        <div className={styles.actions}>
          <LinkButton variant="outline" to={`/app/module/${quiz.moduleId}`}>
            Back to the module
          </LinkButton>
          {!result.passed && (
            <Button variant="primary" icon="arrow-right" onClick={onRetake}>
              Retake quiz
            </Button>
          )}
        </div>
      </Card>
    </div>
  );
}
