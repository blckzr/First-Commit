import { useEffect, useState } from "react";
import { useNavigate } from "react-router";
import { Button } from "../../components/core/Button";
import { useOnboarding } from "../../features/onboarding/useOnboarding";
import { OnboardingLayout } from "./OnboardingLayout";
import styles from "./OnboardingLayout.module.css";

/**
 * design.md §5.4 step 4 — waiting for the Roadmap AI.
 *
 * "Building your roadmap from your answers…" with an explanation of what is
 * happening and what to do if it takes long; on failure, a "Try again" that
 * does not lose the learner's answers.
 *
 * **The roadmap is not generated yet.** `roadmap_generation` is a stub in the
 * worker (AGENT.md §7, Phase 3), so the `ai_jobs` row queued by the placement
 * step sits there. This screen is built for the real thing: it polls the
 * onboarding state and moves on by itself the moment the step becomes `done`.
 *
 * Nothing here is lost by waiting or leaving — every answer is already stored
 * server-side, which is what makes "Try again" cheap.
 */

/** How often to ask whether the roadmap has landed. */
const POLL_MS = 3000;
/** When to stop saying "under a minute" and start offering a way out. */
const SLOW_AFTER_MS = 60_000;

export function Generating() {
  const navigate = useNavigate();
  const { data } = useOnboarding({ pollMs: POLL_MS });
  const [slow, setSlow] = useState(false);

  useEffect(() => {
    const timer = setTimeout(() => setSlow(true), SLOW_AFTER_MS);
    return () => clearTimeout(timer);
  }, []);

  // The worker writes the roadmap and moves the step; the browser only reads it.
  useEffect(() => {
    if (data?.step === "done") void navigate("/app", { replace: true });
  }, [data?.step, navigate]);

  return (
    <OnboardingLayout step={3} title="Building your roadmap">
      <div className={styles.waiting}>
        {/*
          Indeterminate work. A percentage here would be invented, so the bar
          is decoration with no value attached and the text carries the state.
        */}
        <div className={styles.indeterminate} aria-hidden="true">
          <span />
        </div>

        <p className={styles.waitingLead}>Building your roadmap from your answers…</p>

        <p className={styles.waitingNote} role="status">
          {slow
            ? "This is taking longer than usual. Your answers are saved, so you can leave this page — we'll email you when it's ready."
            : "This usually takes under a minute. You can leave this page; we'll email you when it's ready."}
        </p>

        {slow && (
          <div className={styles.waitingAction}>
            <Button variant="outline" onClick={() => void navigate("/onboarding/placement")}>
              Try again
            </Button>
          </div>
        )}
      </div>
    </OnboardingLayout>
  );
}
