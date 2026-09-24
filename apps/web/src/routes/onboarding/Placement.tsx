import { useState } from "react";
import { useNavigate } from "react-router";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Button } from "../../components/core/Button";
import { Icon } from "../../components/core/Icon";
import { RadioOption } from "../../components/forms/RadioOption";
import { onboardingApi, type PlacementSkill, type Rating } from "../../api/onboarding";
import { ApiError } from "../../api/client";
import { useOnboarding, onboardingKey } from "../../features/onboarding/useOnboarding";
import { sessionKey } from "../../features/auth/useSession";
import { OnboardingLayout } from "./OnboardingLayout";
import styles from "./OnboardingLayout.module.css";
import placement from "./Placement.module.css";

/**
 * design.md §5.4 step 3 — placement.
 *
 * Two parts, on one page. The learner rates what they already know; anything
 * they rate **comfortable** is then checked, because a rating on its own can
 * never clear a module — every module on the path is required for the
 * certificate, and a skipped module writes no evidence. Passing a check writes
 * `module_completions` with `method = 'tested_out'`, which counts toward the
 * certificate exactly as testing out of one module does.
 *
 * Nothing here computes a score. The browser sends which option it chose and
 * the API grades it (AGENT.md §6 rule 1), which is why this file has no answer
 * key in it to leak.
 *
 * §5.4: "'I don't know yet' is always available" — rating everything "New to
 * me" is one click, and asks nothing further.
 */

const RATINGS: { value: Rating; label: string }[] = [
  { value: "new", label: "New to me" },
  { value: "seen", label: "I've seen it" },
  { value: "with_help", label: "I can use it with help" },
  { value: "comfortable", label: "I'm comfortable with it" },
];

export function Placement() {
  const navigate = useNavigate();
  const client = useQueryClient();
  const { data: state } = useOnboarding();

  const skills = state?.placement.skills ?? [];
  const [ratings, setRatings] = useState<Record<string, Rating>>({});
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [checking, setChecking] = useState(false);

  const save = useMutation({
    mutationFn: () =>
      onboardingApi.savePlacement(state?.careerPathId ?? "", ratings, answers),
    async onSuccess(result) {
      await client.invalidateQueries({ queryKey: onboardingKey });
      await client.invalidateQueries({ queryKey: sessionKey });
      void navigate(result.next);
    },
  });

  const error = save.error instanceof ApiError ? save.error : null;

  /** Only a claim of "comfortable" is worth checking. */
  const claimed = skills.filter((s) => ratings[s.slug] === "comfortable");
  const questions = claimed.flatMap((s) => s.check.questions);
  const unanswered = questions.filter((q) => !answers[q.id]).length;

  function rate(slug: string, value: Rating) {
    setRatings((prev) => ({ ...prev, [slug]: value }));
    // Dropping a claim drops its answers, so nothing is sent for a skill the
    // learner no longer says they know.
    if (value !== "comfortable") {
      const skill = skills.find((s) => s.slug === slug);
      if (skill) {
        setAnswers((prev) => {
          const next = { ...prev };
          for (const q of skill.check.questions) delete next[q.id];
          return next;
        });
      }
    }
  }

  function newToAll() {
    setRatings(Object.fromEntries(skills.map((s) => [s.slug, "new" as Rating])));
    setAnswers({});
    setChecking(false);
  }

  return (
    <OnboardingLayout
      step={2}
      title={checking ? "A few questions" : "What do you already know?"}
      lede={
        checking
          ? "Pass a section and its modules are marked as tested out. Get one wrong and you simply keep the module — nothing here can set you back."
          : "This tells us what order to put your roadmap in, and what you could test out of straight away. There's no time limit."
      }
    >
      <div className={styles.form}>
        {skills.length === 0 && (
          <p className={styles.empty}>
            <Icon name="info" size={18} /> There&apos;s nothing to check for this path yet.
            Continue and your roadmap will start from the beginning — you can still test out
            of any module once you&apos;re in.
          </p>
        )}

        {skills.length > 0 && !checking && (
          <>
            <div className={placement.skills}>
              {skills.map((skill) => (
                <fieldset key={skill.slug} className={placement.skill}>
                  <legend className={placement.skillName}>
                    {skill.name}
                    <span className={placement.skillHint}>{skill.description}</span>
                  </legend>
                  <div className={placement.options}>
                    {RATINGS.map((option) => (
                      <RadioOption
                        key={option.value}
                        name={skill.slug}
                        label={option.label}
                        checked={ratings[skill.slug] === option.value}
                        onChange={() => rate(skill.slug, option.value)}
                      />
                    ))}
                  </div>
                </fieldset>
              ))}
            </div>

            <p className={placement.aside}>
              <Button variant="ghost" size="sm" onClick={newToAll}>
                I&apos;m new to all of this
              </Button>
            </p>
          </>
        )}

        {checking && <Check skills={claimed} answers={answers} onAnswer={setAnswers} />}

        {error && <p role="alert" className={styles.formError}>{error.message}</p>}

        <div className={styles.actions}>
          <Button
            variant="ghost"
            icon="arrow-left"
            iconPosition="left"
            onClick={() =>
              checking ? setChecking(false) : void navigate("/onboarding/target")
            }
          >
            Back
          </Button>
          <div className={styles.actionsEnd}>
            {!checking && claimed.length > 0 ? (
              <Button variant="primary" icon="arrow-right" onClick={() => setChecking(true)}>
                {questionLabel(questions.length)}
              </Button>
            ) : (
              <Button
                variant="primary"
                icon="arrow-right"
                onClick={() => save.mutate()}
                loading={save.isPending}
                loadingLabel="Marking…"
              >
                Continue
              </Button>
            )}
          </div>
        </div>

        {checking && unanswered > 0 && (
          <p className={placement.remaining} role="status">
            {unanswered} question{unanswered === 1 ? "" : "s"} still to answer. You can
            continue without them — they count as wrong.
          </p>
        )}
      </div>
    </OnboardingLayout>
  );
}

/** §9: a button says what happens, including how much of it. */
function questionLabel(n: number): string {
  return `Check what I know — ${n} question${n === 1 ? "" : "s"}`;
}

function Check({
  skills,
  answers,
  onAnswer,
}: {
  skills: PlacementSkill[];
  answers: Record<string, string>;
  onAnswer: (next: Record<string, string>) => void;
}) {
  return (
    <div className={placement.skills}>
      {skills.map((skill) => (
        <section key={skill.slug} className={placement.check} aria-labelledby={`c-${skill.slug}`}>
          <h2 id={`c-${skill.slug}`} className={placement.checkTitle}>
            {skill.name}
            <span className={placement.skillHint}>
              Clears {skill.moduleCount} module{skill.moduleCount === 1 ? "" : "s"} if you pass
            </span>
          </h2>

          {skill.check.questions.map((question, i) => (
            <fieldset key={question.id} className={placement.question}>
              <legend className={placement.prompt}>
                <span className={placement.number}>{i + 1}</span>
                {question.prompt}
              </legend>
              <div className={placement.options}>
                {question.options.map((option) => (
                  <RadioOption
                    key={option.id}
                    name={question.id}
                    label={option.text}
                    checked={answers[question.id] === option.id}
                    onChange={() => onAnswer({ ...answers, [question.id]: option.id })}
                  />
                ))}
              </div>
            </fieldset>
          ))}
        </section>
      ))}
    </div>
  );
}
