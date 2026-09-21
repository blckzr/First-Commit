import { useState } from "react";
import { useNavigate } from "react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Button } from "../../components/core/Button";
import { onboardingApi } from "../../api/onboarding";
import { ApiError } from "../../api/client";
import { useOnboarding, onboardingKey } from "../../features/onboarding/useOnboarding";
import { sessionKey } from "../../features/auth/useSession";
import { OnboardingLayout } from "./OnboardingLayout";
import styles from "./OnboardingLayout.module.css";

/**
 * design.md §5.4 step 2 — "Chooses a career path."
 *
 * The copy is from the wireframe: "What job are you working toward? You can add
 * another roadmap later."
 */
export function Target() {
  const navigate = useNavigate();
  const client = useQueryClient();
  const { data: state } = useOnboarding();

  const paths = useQuery({
    queryKey: ["career-paths"],
    queryFn: ({ signal }) => onboardingApi.careerPaths(signal),
  });

  const [chosen, setChosen] = useState<string>();
  const [fieldError, setFieldError] = useState<string>();
  const selected = chosen ?? state?.careerPathId ?? undefined;

  const save = useMutation({
    mutationFn: onboardingApi.saveTarget,
    async onSuccess(result) {
      await client.invalidateQueries({ queryKey: onboardingKey });
      await client.invalidateQueries({ queryKey: sessionKey });
      void navigate(result.next);
    },
  });

  function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!selected) {
      setFieldError("Choose the job you're working toward.");
      return;
    }
    setFieldError(undefined);
    save.mutate(selected);
  }

  const error = save.error instanceof ApiError ? save.error : null;

  return (
    <OnboardingLayout
      step={1}
      title="What job are you working toward?"
      lede="You can add another roadmap later, and what you learn counts toward both."
    >
      <form className={styles.form} onSubmit={onSubmit} noValidate>
        <fieldset className={styles.field}>
          <legend className={styles.legend} hidden>
            Career path
          </legend>
          {fieldError && <p className={styles.help}>{fieldError}</p>}

          {paths.isPending && <p className={styles.help}>Loading the available paths…</p>}

          {/*
            design.md §9: an empty state invites action. There is nothing the
            learner can do about an empty catalogue, so it says who can.
          */}
          {paths.data?.length === 0 && (
            <p className={styles.empty}>
              No career paths have been published yet. An admin adds these from the career
              path editor, and you&apos;ll be able to choose once one exists.
            </p>
          )}

          <div className={styles.cards}>
            {paths.data?.map((path) => (
              <button
                key={path.id}
                type="button"
                aria-pressed={selected === path.id}
                onClick={() => setChosen(path.id)}
                className={[styles.card, selected === path.id ? styles.cardSelected : ""]
                  .filter(Boolean)
                  .join(" ")}
              >
                <span className={styles.cardTitle}>{path.title}</span>
                <span className={styles.cardBody}>{path.description}</span>
              </button>
            ))}
          </div>
        </fieldset>

        {error && <p role="alert" className={styles.formError}>{error.message}</p>}

        <div className={styles.actions}>
          <Button variant="ghost" icon="arrow-left" iconPosition="left" onClick={() => void navigate("/onboarding/about")}>
            Back
          </Button>
          <div className={styles.actionsEnd}>
            <Button
              type="submit"
              variant="primary"
              icon="arrow-right"
              loading={save.isPending}
              loadingLabel="Saving…"
              disabled={!paths.data?.length}
            >
              Continue
            </Button>
          </div>
        </div>
      </form>
    </OnboardingLayout>
  );
}
