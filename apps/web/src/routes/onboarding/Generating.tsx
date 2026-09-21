import { useEffect, useState } from "react";
import { useNavigate } from "react-router";
import { useQueryClient } from "@tanstack/react-query";
import { Button } from "../../components/core/Button";
import { sessionKey } from "../../features/auth/useSession";
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
 * It polls the onboarding state and leaves by itself once the step reads
 * `done` — but **it does not navigate**. `RequireLearner` already sends a
 * learner with no unfinished onboarding to `/app`; all this screen has to do is
 * refresh the session so the guard can see that.
 *
 * That matters. An earlier version called `navigate("/app")` here as well, and
 * the two fought: navigating changed the location, `useNavigate` returned a new
 * identity, the effect's dependencies changed, and it navigated again —
 * "Maximum update depth exceeded", then the browser throttling navigation to
 * stay responsive. One place decides where a learner goes.
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
  const client = useQueryClient();
  const { data } = useOnboarding({ pollMs: POLL_MS });
  const [slow, setSlow] = useState(false);

  useEffect(() => {
    const timer = setTimeout(() => setSlow(true), SLOW_AFTER_MS);
    return () => clearTimeout(timer);
  }, []);

  /**
   * The worker writes the roadmap and moves the step; the browser only reads
   * it. `done` means the session's `onboardingStep` is stale, so refresh it and
   * let the guard do the redirect.
   *
   * `client` is stable and `data?.step` settles once, so this runs exactly
   * once — which is the whole difference from the version that looped.
   */
  useEffect(() => {
    if (data?.step !== "done") return;
    void client.invalidateQueries({ queryKey: sessionKey });
  }, [data?.step, client]);

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
