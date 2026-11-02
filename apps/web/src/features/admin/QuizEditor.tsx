import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Button } from "../../components/core/Button";
import { Card } from "../../components/core/Card";
import { adminQuizzesApi, quizKey, type Question } from "../../api/adminQuizzes";
import { ApiError } from "../../api/client";
import styles from "./QuizEditor.module.css";

/**
 * design.md §6.3's Assessment tab.
 *
 * **The correct answer is a radio, not a field.** `quiz_answer_keys` holds one
 * option per question, and a control that can express "two correct" or "none"
 * would let an author save a quiz nobody can pass — the API refuses it, but a
 * refusal an author meets after typing six options is a worse screen than one
 * that cannot ask the question.
 *
 * **Only a draft's quiz is editable.** A published quiz is what learners are
 * being tested on; the API returns `editable` and this shows the questions
 * read-only when it is false, rather than offering edits that would 404.
 */

const blankQuestion = (): Question => ({
  prompt: "",
  explanation: "",
  options: ["", ""],
  correctIndex: 0,
});

export function QuizEditor({
  moduleId,
  versionId,
}: {
  moduleId: string;
  versionId: string;
}) {
  const client = useQueryClient();

  const { data, isPending, error } = useQuery({
    queryKey: quizKey(moduleId, versionId),
    queryFn: ({ signal }) => adminQuizzesApi.get(moduleId, versionId, signal),
  });

  if (isPending) {
    return (
      <p role="status" aria-live="polite" className={styles.hint}>
        Loading the quiz…
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
        <h2 className={styles.sectionTitle}>Quiz</h2>
        {data.quiz ? (
          <>
            <p className={styles.hint}>
              Learners are being tested on this. Start a draft to change it.
            </p>
            <ol className={styles.readOnly}>
              {data.quiz.questions.map((question, i) => (
                <li key={i}>
                  {question.prompt}{" "}
                  <span className={styles.muted}>
                    ({question.options.length} options)
                  </span>
                </li>
              ))}
            </ol>
          </>
        ) : (
          <p className={styles.hint}>This version has no quiz.</p>
        )}
      </Card>
    );
  }

  return (
    <Editor
      // A different version is a different quiz; remount rather than sync.
      key={versionId}
      moduleId={moduleId}
      versionId={versionId}
      initial={data.quiz}
      onSaved={() => client.invalidateQueries({ queryKey: quizKey(moduleId, versionId) })}
    />
  );
}

function Editor({
  moduleId,
  versionId,
  initial,
  onSaved,
}: {
  moduleId: string;
  versionId: string;
  initial: { title: string; instructions: string; passingScore: number; questions: Question[] } | null;
  onSaved: () => void;
}) {
  const [title, setTitle] = useState(initial?.title ?? "");
  const [instructions, setInstructions] = useState(initial?.instructions ?? "");
  const [passingScore, setPassingScore] = useState(initial?.passingScore ?? 70);
  const [questions, setQuestions] = useState<Question[]>(initial?.questions ?? []);
  const [saved, setSaved] = useState(false);

  const save = useMutation({
    mutationFn: () =>
      adminQuizzesApi.save(moduleId, versionId, {
        title,
        instructions,
        passingScore,
        questions,
      }),
    onSuccess: () => {
      setSaved(true);
      onSaved();
    },
  });

  const change = (next: Question[]) => {
    setQuestions(next);
    setSaved(false);
  };

  const setQuestion = (index: number, question: Question) =>
    change(questions.map((q, i) => (i === index ? question : q)));

  return (
    <Card className={styles.panel}>
      <div className={styles.field}>
        <label className={styles.label} htmlFor="quiz-title">
          Quiz title
        </label>
        <input
          id="quiz-title"
          className={styles.input}
          value={title}
          onChange={(event) => {
            setTitle(event.target.value);
            setSaved(false);
          }}
        />
      </div>

      <div className={styles.field}>
        <label className={styles.label} htmlFor="quiz-instructions">
          Instructions
        </label>
        <textarea
          id="quiz-instructions"
          className={styles.textarea}
          rows={2}
          value={instructions}
          onChange={(event) => {
            setInstructions(event.target.value);
            setSaved(false);
          }}
        />
      </div>

      <div className={styles.field}>
        <label className={styles.label} htmlFor="quiz-score">
          Passing score (%)
        </label>
        <input
          id="quiz-score"
          type="number"
          min={0}
          max={100}
          className={styles.narrow}
          value={passingScore}
          onChange={(event) => {
            setPassingScore(Number(event.target.value));
            setSaved(false);
          }}
        />
      </div>

      <h2 className={styles.sectionTitle}>Questions</h2>
      {questions.length === 0 && (
        <p className={styles.hint}>
          No questions yet. A quiz with none cannot be published — a learner would open it and
          find nothing.
        </p>
      )}

      <ol className={styles.questions}>
        {questions.map((question, index) => (
          <li key={index} className={styles.question}>
            <QuestionEditor
              question={question}
              index={index}
              total={questions.length}
              onChange={(next) => setQuestion(index, next)}
              onRemove={() => change(questions.filter((_, i) => i !== index))}
              onMove={(by) => {
                const target = index + by;
                if (target < 0 || target >= questions.length) return;
                const next = [...questions];
                [next[index], next[target]] = [next[target], next[index]];
                change(next);
              }}
            />
          </li>
        ))}
      </ol>

      <div className={styles.actions}>
        <Button variant="secondary" onClick={() => change([...questions, blankQuestion()])}>
          Add question
        </Button>
        <Button onClick={() => save.mutate()} disabled={save.isPending}>
          {save.isPending ? "Saving…" : "Save quiz"}
        </Button>
      </div>

      <p role="status" aria-live="polite" className={styles.hint}>
        {saved ? "Quiz saved." : "Unsaved changes stay on this screen until you save."}
      </p>

      {save.error && (
        <p role="alert" className={styles.error}>
          {save.error instanceof ApiError
            ? save.error.message
            : "That did not save. Try again in a moment."}
        </p>
      )}
    </Card>
  );
}

function QuestionEditor({
  question,
  index,
  total,
  onChange,
  onRemove,
  onMove,
}: {
  question: Question;
  index: number;
  total: number;
  onChange: (question: Question) => void;
  onRemove: () => void;
  onMove: (by: number) => void;
}) {
  const group = `correct-${index}`;

  return (
    <div className={styles.questionBody}>
      <div className={styles.field}>
        <label className={styles.label} htmlFor={`prompt-${index}`}>
          Question {index + 1}
        </label>
        <textarea
          id={`prompt-${index}`}
          className={styles.textarea}
          rows={2}
          value={question.prompt}
          onChange={(event) => onChange({ ...question, prompt: event.target.value })}
        />
      </div>

      {/*
        A radio group, so "the correct answer" is one option by construction.
        §12: the group needs a name, and each radio needs its own label.
      */}
      <fieldset className={styles.options}>
        <legend className={styles.label}>Options — choose the correct one</legend>

        {question.options.map((option, optionIndex) => (
          <div key={optionIndex} className={styles.option}>
            <input
              type="radio"
              name={group}
              id={`${group}-${optionIndex}`}
              checked={question.correctIndex === optionIndex}
              onChange={() => onChange({ ...question, correctIndex: optionIndex })}
            />
            <label className={styles.visuallyHidden} htmlFor={`${group}-${optionIndex}`}>
              Option {optionIndex + 1} is correct
            </label>

            <label className={styles.visuallyHidden} htmlFor={`${group}-text-${optionIndex}`}>
              Option {optionIndex + 1} text
            </label>
            <input
              id={`${group}-text-${optionIndex}`}
              className={styles.input}
              value={option}
              onChange={(event) =>
                onChange({
                  ...question,
                  options: question.options.map((o, i) =>
                    i === optionIndex ? event.target.value : o,
                  ),
                })
              }
            />

            <Button
              variant="ghost"
              size="sm"
              disabled={question.options.length <= 2}
              onClick={() => {
                const options = question.options.filter((_, i) => i !== optionIndex);
                onChange({
                  ...question,
                  options,
                  /*
                   * Removing the option that was correct would otherwise leave
                   * the key pointing at whatever slid into its place, which is a
                   * quiz with a silently wrong answer. Falling back to the first
                   * is visible in the radio, so an author sees it moved.
                   */
                  correctIndex:
                    question.correctIndex === optionIndex
                      ? 0
                      : question.correctIndex > optionIndex
                        ? question.correctIndex - 1
                        : question.correctIndex,
                });
              }}
            >
              Remove option
            </Button>
          </div>
        ))}

        <Button
          variant="ghost"
          size="sm"
          disabled={question.options.length >= 6}
          onClick={() => onChange({ ...question, options: [...question.options, ""] })}
        >
          Add option
        </Button>
      </fieldset>

      <div className={styles.field}>
        <label className={styles.label} htmlFor={`explanation-${index}`}>
          Why that is the answer
        </label>
        <textarea
          id={`explanation-${index}`}
          className={styles.textarea}
          rows={2}
          value={question.explanation}
          onChange={(event) => onChange({ ...question, explanation: event.target.value })}
        />
      </div>

      <div className={styles.questionActions}>
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
          Remove question
        </Button>
      </div>
    </div>
  );
}
