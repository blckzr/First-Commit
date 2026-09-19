import { Badge } from "../../components/core/Badge";
import { Button } from "../../components/core/Button";
import { Card } from "../../components/core/Card";
import { Icon } from "../../components/core/Icon";
import { LinkButton } from "../../components/core/LinkButton";
import { ProgressBar } from "../../components/learning/ProgressBar";
import { useSession } from "../../features/auth/useSession";
import styles from "./Home.module.css";

/**
 * design.md §5.6 — Home answers one question: what do I do next?
 *
 * Mock data until the API exists. Every number here will come from
 * module_completions, which only server code writes (AGENT.md §6).
 */
const PROGRESS = { passed: 6, total: 16 };

export function Home() {
  const { user } = useSession();
  const percent = (PROGRESS.passed / PROGRESS.total) * 100;

  return (
    <div>
      <h1 className={styles.greeting}>Good evening, {user?.fullName}</h1>

      <div className={styles.grid}>
        <div className={styles.stack}>
          <Card surface="white" padding="lg">
            <span className={styles.panelLabel}>Continue</span>
            <h2 className={styles.continueTitle}>Arrays and objects</h2>
            <p className={styles.continueMeta}>Lesson 2 of 4 · about 5 hours left</p>
            <div className={styles.row}>
              <Badge tone="here" icon="circle-dot">You are here</Badge>
              <Button variant="primary" icon="arrow-right">Continue lesson</Button>
            </div>
          </Card>

          <Card surface="white" padding="lg">
            <span className={styles.panelLabel}>Your roadmap</span>
            <h2 className={styles.pathTitle}>Junior Web Developer, Frontend</h2>
            <ProgressBar
              value={percent}
              label={`${PROGRESS.passed} of ${PROGRESS.total} modules passed`}
              showValue
            />
            <div className={styles.row}>
              <Badge tone="verified" icon="check">4 skills verified</Badge>
              <LinkButton to="/app/roadmaps" variant="outline" icon="arrow-right">
                View roadmap
              </LinkButton>
            </div>
          </Card>
        </div>

        <Card surface="soft" padding="lg">
          <span className={styles.panelLabel}>Updates</span>
          <div className={styles.updateRow}>
            <Icon name="info" size={18} className={styles.noticeIcon} />
            <div className={styles.updateBody}>
              <p>
                We added a practice module on loops to your roadmap after your
                last quiz.
              </p>
              <div className={styles.updateActions}>
                <Button variant="outline" size="sm">View module</Button>
                <Button variant="ghost" size="sm">Remove</Button>
              </div>
            </div>
          </div>
        </Card>
      </div>
    </div>
  );
}
