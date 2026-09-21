import { useNavigate } from "react-router";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Button } from "../../components/core/Button";
import { Icon } from "../../components/core/Icon";
import { onboardingApi } from "../../api/onboarding";
import { ApiError } from "../../api/client";
import { useOnboarding, onboardingKey } from "../../features/onboarding/useOnboarding";
import { sessionKey } from "../../features/auth/useSession";
import { OnboardingLayout } from "./OnboardingLayout";
import styles from "./OnboardingLayout.module.css";

/**
 * design.md §5.4 step 3 — placement.
 *
 * "Answers placement questions; 'I don't know yet' is always available; no time
 * limit."
 *
 * **The questions do not exist yet.** The schema has no placement question
 * table — `placement_results.results` is free-form jsonb and nothing defines
 * where the questions come from (AGENT.md §11). So this screen currently offers
 * only the skip, which §5.4 says must always be available anyway, and records
 * an empty result. When the questions are specified, they render above the
 * actions and fill `results`.
 */
export function Placement() {
  const navigate = useNavigate();
  const client = useQueryClient();
  const { data: state } = useOnboarding();

  const save = useMutation({
    mutationFn: (results: Record<string, unknown>) =>
      onboardingApi.savePlacement(state?.careerPathId ?? "", results),
    async onSuccess(result) {
      await client.invalidateQueries({ queryKey: onboardingKey });
      await client.invalidateQueries({ queryKey: sessionKey });
      void navigate(result.next);
    },
  });

  const error = save.error instanceof ApiError ? save.error : null;

  return (
    <OnboardingLayout
      step={2}
      title="Placement"
      lede="This short check helps us skip what you already know. There's no time limit, and nothing here affects your certificate."
    >
      <div className={styles.form}>
        <p className={styles.empty}>
          <Icon name="info" size={18} /> The placement questions for this path aren&apos;t
          ready yet. Continue and your roadmap will start from the beginning — you can still
          test out of any module once you&apos;re in.
        </p>

        {error && <p role="alert" className={styles.formError}>{error.message}</p>}

        <div className={styles.actions}>
          <Button variant="ghost" icon="arrow-left" iconPosition="left" onClick={() => void navigate("/onboarding/target")}>
            Back
          </Button>
          <div className={styles.actionsEnd}>
            {/* §5.4: "I don't know yet" is always available. */}
            <Button
              variant="primary"
              icon="arrow-right"
              onClick={() => save.mutate({})}
              loading={save.isPending}
              loadingLabel="Saving…"
            >
              Continue
            </Button>
          </div>
        </div>
      </div>
    </OnboardingLayout>
  );
}
