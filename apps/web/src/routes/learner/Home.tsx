import { Card } from "../../components/core/Card";
import { Icon } from "../../components/core/Icon";
import { LinkButton } from "../../components/core/LinkButton";
import { ProgressBar } from "../../components/learning/ProgressBar";
import { useSession } from "../../features/auth/useSession";
import { useHome } from "../../features/home/useHome";
import type { ContinuePanel, HomeSummary } from "../../api/home";
import styles from "./Home.module.css";

/**
 * design.md §5.6 — Home answers one question: what do I do next?
 *
 * Every number comes from the API, which computes it from `module_completions`
 * — the table only server code writes (AGENT.md §6 rule 1). Nothing here adds
 * up a score or decides what counts as passed.
 *
 * The shape is the prototype's: a violet hero panel carrying the greeting, the
 * headline and the two actions, with an **ink card inside it** holding the
 * current module and the two counts. Then the roadmap panel, then Updates.
 */
export function Home() {
  const { user } = useSession();
  const { data, isPending, error } = useHome();

  const firstName = user?.fullName?.split(" ")[0] ?? "";

  if (isPending) {
    return (
      <p role="status" aria-live="polite" className={styles.loading}>
        Loading what&apos;s next…
      </p>
    );
  }

  if (error || !data) {
    return (
      <Card surface="white" radius="panel" padding="lg">
        <h1 className={styles.panelTitle}>We couldn&apos;t load your progress</h1>
        <p className={styles.muted}>
          This is usually temporary, and nothing you have done is lost. Your roadmap is still
          there.
        </p>
        <div className={styles.row}>
          <LinkButton to="/app/roadmaps" variant="outline" icon="arrow-right">
            See your roadmaps
          </LinkButton>
        </div>
      </Card>
    );
  }

  return <HomeView home={data} greetingName={firstName} />;
}

/** §5.6's greeting. Local time, because it is a greeting, not a timestamp. */
function greeting(): string {
  const hour = new Date().getHours();
  if (hour < 12) return "Good morning";
  if (hour < 18) return "Good afternoon";
  return "Good evening";
}

function HomeView({ home, greetingName }: { home: HomeSummary; greetingName: string }) {
  // §5.6: "Choose a target job to build your first roadmap." with "Build my roadmap".
  if (!home.roadmap) {
    return (
      <Card surface="white" radius="panel" padding="lg">
        <h1 className={styles.panelTitle}>Choose a target job to build your first roadmap</h1>
        <p className={styles.muted}>
          Tell us what you are working toward and we will plan the modules to get you there.
        </p>
        <div className={styles.row}>
          <LinkButton to="/onboarding/target" icon="arrow-right">
            Build my roadmap
          </LinkButton>
        </div>
      </Card>
    );
  }

  const { roadmap, updates } = home;
  const percent = roadmap.totalCount === 0 ? 0 : (roadmap.passedCount / roadmap.totalCount) * 100;
  const remaining = roadmap.totalCount - roadmap.passedCount;

  return (
    <>
      <section className={styles.hero} aria-labelledby="home-heading">
        <div className={styles.heroText}>
          <span className={styles.eyebrow}>
            {greeting()}
            {greetingName ? `, ${greetingName}` : ""}
          </span>

          {/*
            §3.1: one accent phrase per headline, and on this light wash it is
            violet-700 at 8.26:1. The prototype sets it in lime, which measures
            1.98:1 here — see design-source.md §3.1.
          */}
          <h1 id="home-heading" className={styles.heroTitle}>
            Pick up where
            <br />
            you <span className={styles.accent}>left off.</span>
          </h1>

          <p className={styles.heroBody}>{lede(home.continue, remaining)}</p>

          <div className={styles.heroActions}>
            {home.continue && (
              <LinkButton to={continueHref(home.continue)} icon="arrow-right">
                {/* §9: a button says what happens, and keeps its name through the flow. */}
                {home.continue.started ? "Continue lesson" : "Start module"}
              </LinkButton>
            )}
            <LinkButton
              to={`/app/roadmap/${roadmap.id}`}
              variant={home.continue ? "outline" : "primary"}
              icon={home.continue ? undefined : "arrow-right"}
            >
              View roadmap
            </LinkButton>
          </div>
        </div>

        {/* The ink card inside the hero: what you are on, and the two counts. */}
        <Card surface="dark" padding="md" className={styles.current}>
          <span className={styles.currentLabel}>
            {home.continue ? "Current module" : "Your progress"}
          </span>
          <span className={styles.currentTitle}>
            {home.continue ? home.continue.moduleTitle : roadmap.careerPathTitle}
          </span>
          <span className={styles.currentMeta}>
            {home.continue ? where(home.continue) : "Everything available is done."}
          </span>
          <div className={styles.stats}>
            <div className={styles.stat}>
              <span className={styles.statValue}>{roadmap.passedCount}</span>
              <span className={styles.statLabel}>Modules passed</span>
            </div>
            <div className={styles.stat}>
              <span className={styles.statValue}>{remaining}</span>
              <span className={styles.statLabel}>Remaining</span>
            </div>
          </div>
        </Card>
      </section>

      <Card surface="white" radius="panel" padding="lg">
        <div className={styles.panelRow}>
          <h2 className={styles.panelTitle}>
            {roadmap.careerPathTitle}
            {roadmap.trackTitle ? `, ${roadmap.trackTitle}` : ""}
          </h2>
          <LinkButton to={`/app/roadmap/${roadmap.id}`} variant="outline" size="sm">
            View roadmap
          </LinkButton>
        </div>
        <ProgressBar
          className={styles.progress}
          height={10}
          value={percent}
          label={`${roadmap.passedCount} of ${roadmap.totalCount} modules passed`}
        />
      </Card>

      {updates.length > 0 && (
        <Card surface="soft" radius="panel" padding="lg">
          <span className={styles.eyebrow}>Updates</span>
          <ul className={styles.updateList}>
            {updates.map((update) => (
              <li key={update.id} className={styles.updateRow}>
                <span className={styles.updateLine}>
                  <Icon name="info" size={18} className={styles.noticeIcon} />
                  <p>
                    {update.text}
                    {/* §7: AI output is labelled as AI wherever it appears. */}
                    {update.fromAi && <span className={styles.aiTag}> Added by AI.</span>}
                  </p>
                </span>
                <div className={styles.updateActions}>
                  <LinkButton
                    to={`/app/module/${update.moduleId}`}
                    variant="secondary"
                    size="sm"
                  >
                    {update.kind === "module_updated" ? "See what changed" : "View module"}
                  </LinkButton>
                </div>
              </li>
            ))}
          </ul>
        </Card>
      )}
    </>
  );
}

/**
 * §5.6's lead sentence. The prototype writes it from the module and what comes
 * after it; the platform knows the module and the count, so it says that much
 * and stops rather than inventing the rest.
 */
function lede(panel: ContinuePanel | null, remaining: number): string {
  if (!panel) {
    return remaining === 0
      ? "You have passed every module on your roadmap."
      : "Everything available on your roadmap is done. Open it to see what unlocks next.";
  }

  if (panel.lessonNumber === null) {
    return `${panel.moduleTitle} is next, in ${panel.skillTitle}. About ${panel.estimatedHours} hours.`;
  }

  const left = panel.lessonCount - panel.lessonNumber + 1;
  return left === 1
    ? `You are on the last lesson of ${panel.moduleTitle}.`
    : `You are ${left} lessons from finishing ${panel.moduleTitle}.`;
}

function where(panel: ContinuePanel): string {
  return panel.lessonNumber === null
    ? `${panel.skillTitle} · about ${panel.estimatedHours} hours`
    : `Lesson ${panel.lessonNumber} of ${panel.lessonCount} · about ${panel.estimatedHours} hours left`;
}

function continueHref(panel: ContinuePanel): string {
  switch (panel.kind) {
    case "module":
      return panel.lessonId
        ? `/app/module/${panel.moduleId}?lesson=${panel.lessonId}`
        : `/app/module/${panel.moduleId}`;
    default:
      return assertNever(panel.kind);
  }
}

function assertNever(value: never): never {
  throw new Error(`Unhandled Continue panel: ${JSON.stringify(value)}`);
}
