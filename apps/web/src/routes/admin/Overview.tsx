import { useQuery } from "@tanstack/react-query";
import { Badge } from "../../components/core/Badge";
import { Card } from "../../components/core/Card";
import { Icon } from "../../components/core/Icon";
import type { IconName } from "../../components/core/Icon";
import { LinkButton } from "../../components/core/LinkButton";
import { adminOverviewApi, adminOverviewKey, type Overview as Data } from "../../api/adminOverview";
import { ApiError } from "../../api/client";
import styles from "./Overview.module.css";

/**
 * design.md §6.1 — what needs attention today.
 *
 * **On real data.** This was the last screen in the app reading a hard-coded
 * array, which mattered more here than anywhere else: a page whose entire job is
 * to say what needs doing is worse than blank when its numbers are invented. It
 * showed "3 flagged AI feedback" beside a working `/admin/flags` endpoint for
 * weeks.
 *
 * **Nothing is rounded up to look busy.** Zero is shown as zero and says what
 * that means, because "nothing needs attention" is the answer an admin most
 * wants to be able to trust.
 */

const percent = (value: number) => `${Math.round(value * 100)}%`;

export function Overview() {
  const { data, isPending, error } = useQuery({
    queryKey: adminOverviewKey,
    queryFn: ({ signal }) => adminOverviewApi.get(signal),
  });

  if (isPending) {
    return (
      <p role="status" aria-live="polite" className={styles.lede}>
        Loading what needs attention…
      </p>
    );
  }

  if (error || !data) {
    return (
      <p role="alert" className={styles.error}>
        {error instanceof ApiError
          ? error.message
          : "The overview did not load. Try again in a moment."}
      </p>
    );
  }

  return (
    <div>
      <h1 className={styles.title}>Overview</h1>
      <p className={styles.lede}>What needs your attention today.</p>

      <div className={styles.grid}>
        <NeedsReview data={data} />
        <Content data={data} />
        <Struggling data={data} />
        <Certificates data={data} />
      </div>

      {/*
        §6.1's footer line. `activeWithinDays` comes from the API rather than
        being written here, so the caption cannot drift from what was counted.
      */}
      <p className={styles.totals}>
        <strong>{data.activeLearners}</strong> active learner
        {data.activeLearners === 1 ? "" : "s"} in the last {data.activeWithinDays} days
        {" · "}
        <strong>{data.certificatesThisMonth}</strong> certificate
        {data.certificatesThisMonth === 1 ? "" : "s"} this month
      </p>
    </div>
  );
}

/** §6.1's first panel: the two things an admin has to rule on. */
function NeedsReview({ data }: { data: Data }) {
  const total = data.openAiFlags + data.openProjectFlags;

  return (
    <Panel label="Needs review" icon="flag" count={total} wide>
      {total === 0 ? (
        <p className={styles.caption}>Nothing is waiting for a decision.</p>
      ) : (
        <ul className={styles.list}>
          {data.openAiFlags > 0 && (
            <li className={styles.row}>
              <span className={styles.rowTitle}>
                {data.openAiFlags} flagged AI feedback
              </span>
              <span className={styles.rowMeta}>Learners reported these as wrong</span>
            </li>
          )}
          {data.openProjectFlags > 0 && (
            <li className={styles.row}>
              <span className={styles.rowTitle}>
                {data.openProjectFlags} flagged project
                {data.openProjectFlags === 1 ? "" : "s"}
              </span>
              <span className={styles.rowMeta}>Integrity signals awaiting a decision</span>
            </li>
          )}
        </ul>
      )}

      <div className={styles.actions}>
        <LinkButton to="/admin/flags" variant="outline" size="sm" icon="arrow-right">
          Review flags
        </LinkButton>
        <LinkButton to="/admin/reviews" variant="outline" size="sm" icon="arrow-right">
          Open reviews
        </LinkButton>
      </div>
    </Panel>
  );
}

/**
 * §6.1's second panel: drafts, and briefs missing a starter template.
 *
 * **A missing template is a blocked learner, not untidiness.** Somebody who
 * picks Vue and finds no template cannot start their capstone at all, and
 * nothing else in the platform surfaces it — so it is named here with the
 * technology, because "Task tracker is missing Vue" is actionable and "1 gap"
 * is not.
 */
function Content({ data }: { data: Data }) {
  const total = data.draftCount + data.missingTemplates.length;

  return (
    <Panel label="Content" icon="wrench" count={total} wide>
      {total === 0 ? (
        <p className={styles.caption}>Everything is published, with every starter template.</p>
      ) : (
        <ul className={styles.list}>
          {data.drafts.map((draft) => (
            <li key={draft.moduleSlug + draft.title} className={styles.row}>
              <span className={styles.rowTitle}>{draft.title}</span>
              <span className={styles.rowMeta}>
                Draft · edited{" "}
                <time dateTime={draft.updatedAt}>
                  {new Date(draft.updatedAt).toLocaleDateString()}
                </time>
              </span>
            </li>
          ))}
          {data.draftCount > data.drafts.length && (
            <li className={styles.row}>
              <span className={styles.rowMeta}>
                and {data.draftCount - data.drafts.length} more draft
                {data.draftCount - data.drafts.length === 1 ? "" : "s"}
              </span>
            </li>
          )}
          {data.missingTemplates.map((gap) => (
            <li key={gap.briefTitle + gap.technology} className={styles.row}>
              <span className={styles.rowTitle}>{gap.briefTitle}</span>
              <span className={styles.rowMeta}>
                No {gap.technology} starter template — learners cannot start it
              </span>
            </li>
          ))}
        </ul>
      )}

      <div className={styles.actions}>
        <LinkButton to="/admin/modules" variant="outline" size="sm" icon="arrow-right">
          Open modules
        </LinkButton>
      </div>
    </Panel>
  );
}

/**
 * §6.1's "Learners struggling" row.
 *
 * The pass rate is **per learner, not per attempt** — somebody who failed six
 * times and passed on the seventh got there. The API counts it that way; this
 * only has to say which it is, so an admin reading 41% knows what 41% of what.
 */
function Struggling({ data }: { data: Data }) {
  const total = data.strugglingModules.length + data.strugglingMilestones.length;

  return (
    <Panel label="Learners struggling" icon="info" count={total} wide>
      {total === 0 ? (
        <p className={styles.caption}>
          No module or milestone is below a 60% pass rate.
        </p>
      ) : (
        <ul className={styles.list}>
          {data.strugglingModules.map((module) => (
            <li key={module.slug} className={styles.row}>
              <span className={styles.rowTitle}>{module.title}</span>
              <span className={styles.rowMeta}>
                {percent(module.passRate)} of {module.learners} learners passed
              </span>
            </li>
          ))}
          {data.strugglingMilestones.map((milestone) => (
            <li key={milestone.briefTitle + milestone.title} className={styles.row}>
              <span className={styles.rowTitle}>{milestone.title}</span>
              <span className={styles.rowMeta}>
                {percent(milestone.stuckRate)} of {milestone.attempted} still stuck ·{" "}
                {milestone.briefTitle}
              </span>
            </li>
          ))}
        </ul>
      )}

      <div className={styles.actions}>
        <LinkButton to="/admin/analytics" variant="outline" size="sm" icon="arrow-right">
          Open analytics
        </LinkButton>
      </div>
    </Panel>
  );
}

function Certificates({ data }: { data: Data }) {
  return (
    <Card surface="soft" padding="lg">
      <span className={styles.panelLabel}>
        <Icon name="award" size={14} />
        Certificates
      </span>
      <strong className={styles.count}>{data.certificatesThisMonth}</strong>
      <p className={styles.caption}>
        Issued this month
        {data.revokedThisMonth > 0
          ? `, ${data.revokedThisMonth} revoked.`
          : ", none revoked."}
      </p>
      {/* §8: status is icon + text + colour, never colour alone. */}
      {data.revokedThisMonth > 0 ? (
        <Badge tone="notice" icon="flag">
          {data.revokedThisMonth} revoked
        </Badge>
      ) : (
        <Badge tone="verified" icon="check">
          All valid
        </Badge>
      )}
    </Card>
  );
}

function Panel({
  label,
  icon,
  count,
  wide,
  children,
}: {
  label: string;
  icon: IconName;
  count: number;
  wide?: boolean;
  children: React.ReactNode;
}) {
  return (
    <Card surface="white" padding="lg" className={wide ? styles.wide : undefined}>
      <span className={styles.panelLabel}>
        <Icon name={icon} size={14} />
        {label}
      </span>
      <strong className={styles.count}>{count}</strong>
      {children}
    </Card>
  );
}
