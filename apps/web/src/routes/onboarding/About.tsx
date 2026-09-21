import { useState } from "react";
import { useNavigate } from "react-router";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Button } from "../../components/core/Button";
import { Input } from "../../components/forms/Input";
import { RadioOption } from "../../components/forms/RadioOption";
import { onboardingApi, type AboutInput } from "../../api/onboarding";
import { ApiError } from "../../api/client";
import { useOnboarding, onboardingKey } from "../../features/onboarding/useOnboarding";
import { sessionKey } from "../../features/auth/useSession";
import { OnboardingLayout } from "./OnboardingLayout";
import styles from "./OnboardingLayout.module.css";

const EXPERIENCE = [
  { value: "none", label: "I've never written code" },
  { value: "some", label: "I've tried a bit — a tutorial or two" },
  { value: "comfortable", label: "I can build small things on my own" },
] as const;

const GOALS = [
  { value: "company_job", label: "A job at a company" },
  { value: "freelance", label: "Freelance or client work" },
  { value: "undecided", label: "I'm not sure yet" },
] as const;

/**
 * design.md §5.4 step 1 — "4 to 6 questions on experience, goals and weekly
 * hours using radio groups and chips".
 *
 * Answers already given come back from the API, so Back refills them.
 */
export function About() {
  const navigate = useNavigate();
  const client = useQueryClient();
  const { data, isPending } = useOnboarding();

  const [experience, setExperience] = useState<string>();
  const [goal, setGoal] = useState<string>();
  const [hours, setHours] = useState<string>();
  const [errors, setErrors] = useState<Record<string, string>>({});

  // Prefill once the saved answers arrive, without clobbering a later edit.
  const experienceValue = experience ?? data?.about?.experienceLevel ?? "";
  const goalValue = goal ?? data?.about?.goal ?? "";
  const hoursValue = hours ?? (data?.about?.weeklyHours?.toString() || "");

  const save = useMutation({
    mutationFn: (input: AboutInput) => onboardingApi.saveAbout(input),
    async onSuccess(result) {
      await client.invalidateQueries({ queryKey: onboardingKey });
      await client.invalidateQueries({ queryKey: sessionKey });
      void navigate(result.next);
    },
  });

  function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();

    const next: Record<string, string> = {};
    if (!experienceValue) next.experience = "Pick the one that sounds most like you.";
    if (!goalValue) next.goal = "Pick the one closest to what you want.";

    const parsedHours = Number(hoursValue);
    if (!hoursValue || !Number.isInteger(parsedHours) || parsedHours < 1 || parsedHours > 40) {
      next.hours = "Enter weekly hours as a number between 1 and 40.";
    }

    setErrors(next);
    if (Object.keys(next).length > 0) return;

    save.mutate({
      experienceLevel: experienceValue as AboutInput["experienceLevel"],
      goal: goalValue as AboutInput["goal"],
      weeklyHours: parsedHours,
    });
  }

  const error = save.error instanceof ApiError ? save.error : null;

  return (
    <OnboardingLayout
      step={0}
      title="About you"
      lede="A few questions so your roadmap starts in the right place. Nothing here is a test."
    >
      <form className={styles.form} onSubmit={onSubmit} noValidate>
        <fieldset className={styles.field}>
          <legend className={styles.legend}>How much code have you written?</legend>
          {errors.experience && <p className={styles.help}>{errors.experience}</p>}
          <div className={styles.options}>
            {EXPERIENCE.map((option) => (
              <RadioOption
                key={option.value}
                name="experience"
                label={option.label}
                checked={experienceValue === option.value}
                onChange={() => setExperience(option.value)}
              />
            ))}
          </div>
        </fieldset>

        <fieldset className={styles.field}>
          <legend className={styles.legend}>What are you working toward?</legend>
          {errors.goal && <p className={styles.help}>{errors.goal}</p>}
          <div className={styles.options}>
            {GOALS.map((option) => (
              <RadioOption
                key={option.value}
                name="goal"
                label={option.label}
                checked={goalValue === option.value}
                onChange={() => setGoal(option.value)}
              />
            ))}
          </div>
        </fieldset>

        <Input
          label="Hours a week you can study"
          name="weeklyHours"
          type="number"
          inputMode="numeric"
          min={1}
          max={40}
          value={hoursValue}
          onChange={(e) => setHours(e.currentTarget.value)}
          hint="An honest number is more useful than an ambitious one. You can change it later."
          error={errors.hours}
        />

        {error && <p role="alert" className={styles.formError}>{error.message}</p>}

        <div className={styles.actions}>
          <div className={styles.actionsEnd}>
            <Button
              type="submit"
              variant="primary"
              icon="arrow-right"
              loading={save.isPending}
              loadingLabel="Saving…"
              disabled={isPending}
            >
              Continue
            </Button>
          </div>
        </div>
      </form>
    </OnboardingLayout>
  );
}
