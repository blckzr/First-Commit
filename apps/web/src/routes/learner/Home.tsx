import { Badge } from "../../components/core/Badge";
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
 */
export function Home() {
  const { user } = useSession();
  const { data, isPending, error } = useHome();

  const firstName = user?.fullName?.split(" ")[0] ?? "";

  return (
    <div>
      <h1 className={styles.greeting}>{greeting()}{firstName ? `, ${firstName}` : ""}</h1>

      {isPending && (
        <p role="status" aria-live="polite" className={styles.loading}>
          Loading what&apos;s next…
        </p>
      )}

      {!isPending && (error || !data) && (
        <Card surface="white" padding="lg">
          <h2 className={styles.panelTitle}>We couldn&apos;t load your progress</h2>
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
      )}

      {!isPending && data && <HomeView home={data} />}
    </div>
  );
}

/** §5.6's header. Local time, because it is a greeting, not a timestamp. */
function greeting(): string {
  const hour = new Date().getHours();
  if (hour < 12) return "Good morning";
  if (hour < 18) return "Good afternoon";
  return "Good evening";
}

function HomeView({ home }: { home: HomeSummary }) {
  // §5.6: "Choose a target job to build your first roadmap." with "Build my roadmap".
  if (!home.roadmap) {
    return (
      <Card surface="white" padding="lg">
        <h2 className={styles.panelTitle}>Choose a target job to build your first roadmap</h2>
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

  return (
    <div className={styles.grid}>
      <div className={styles.stack}>
        {home.continue ? (
          <Continue panel={home.continue} />
        ) : (
          <Card surface="white" padding="lg">
            <span className={styles.panelLabel}>Continue</span>
            <h2 className={styles.panelTitle}>Nothing is waiting on you</h2>
            <p className={styles.muted}>
              Everything available on your roadmap is done. Open it to see what unlocks next.
            </p>
          </Card>
        )}

        <Card surface="white" padding="lg">
          <span className={styles.panelLabel}>Your roadmap</span>
          <h2 className={styles.panelTitle}>
            {roadmap.careerPathTitle}
            {roadmap.trackTitle ? `, ${roadmap.trackTitle}` : ""}
          </h2>
          <ProgressBar
            value={percent}
            label={`${roadmap.passedCount} of ${roadmap.totalCount} modules passed`}
            showValue
          />
          <div className={styles.row}>
            <LinkButton
              to={`/app/roadmap/${roadmap.id}`}
              variant="outline"
              icon="arrow-right"
            >
              View roadmap
            </LinkButton>
          </div>
        </Card>
      </div>

      {updates.length > 0 && (
        <Card surface="soft" padding="lg">
          <span className={styles.panelLabel}>Updates</span>
          <ul className={styles.updateList}>
            {updates.map((update) => (
              <li key={update.id} className={styles.updateRow}>
                <Icon name="info" size={18} className={styles.noticeIcon} />
                <div className={styles.updateBody}>
                  {/* §7: AI output is labelled as AI and carries its reason. */}
                  {update.fromAi && <Badge tone="ai">Added by AI</Badge>}
                  <p>{update.text}</p>
                  <div className={styles.updateActions}>
                    <LinkButton
                      to={`/app/module/${update.moduleId}`}
                      variant="outline"
                      size="sm"
                    >
                      {update.kind === "module_updated" ? "See what changed" : "View module"}
                    </LinkButton>
                  </div>
                </div>
              </li>
            ))}
          </ul>
        </Card>
      )}
    </div>
  );
}

/**
 * §5.6: "Arrays and objects, lesson 2 of 4".
 *
 * The `switch` is exhaustive on `kind`, so the capstone's milestone variant
 * cannot be added to the API without this refusing to compile.
 */
function Continue({ panel }: { panel: ContinuePanel }) {
  switch (panel.kind) {
    case "module": {
      const where =
        panel.lessonNumber === null
          ? `${panel.skillTitle} · about ${panel.estimatedHours} hours`
          : `Lesson ${panel.lessonNumber} of ${panel.lessonCount} · about ${panel.estimatedHours} hours`;

      return (
        <Card surface="white" padding="lg">
          <span className={styles.panelLabel}>Continue</span>
          <h2 className={styles.panelTitle}>{panel.moduleTitle}</h2>
          <p className={styles.muted}>{where}</p>
          <div className={styles.row}>
            {/* §8: status is icon + text + colour, never colour alone. */}
            <Badge tone="here" icon="circle-dot">You are here</Badge>
            <LinkButton
              to={
                panel.lessonId
                  ? `/app/module/${panel.moduleId}?lesson=${panel.lessonId}`
                  : `/app/module/${panel.moduleId}`
              }
              icon="arrow-right"
            >
              {/* §9: a button says what happens, and keeps its name through the flow. */}
              {panel.started ? "Continue lesson" : "Start module"}
            </LinkButton>
          </div>
        </Card>
      );
    }
    default:
      return assertNever(panel.kind);
  }
}

function assertNever(value: never): never {
  throw new Error(`Unhandled Continue panel: ${JSON.stringify(value)}`);
}
