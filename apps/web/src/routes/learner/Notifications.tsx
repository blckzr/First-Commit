import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "react-router";
import { Button } from "../../components/core/Button";
import { Card } from "../../components/core/Card";
import { Icon, type IconName } from "../../components/core/Icon";
import { notificationsApi, notificationsKey } from "../../api/notifications";
import { ApiError } from "../../api/client";
import { group } from "../../features/notifications/group";
import styles from "./Notifications.module.css";

/**
 * design.md §5.17 — Notifications.
 *
 * Grouped Today, This week and Earlier. **The grouping is done here, not by the
 * API**, because it depends on the reader's clock: a notification written at
 * 23:50 is "Today" to the learner who reads it at 23:55 and "This week" to the
 * same learner next morning. A server that decided it would be wrong for one of
 * them.
 *
 * §5.17 also calls for acting inline ("Add to roadmap"). Nothing writes a
 * notification that needs it yet — the two live kinds, a certificate earned and
 * a project rejected, are both "go and look". When the versioning kinds arrive
 * they bring their own actions; until then an inline button would be an empty
 * promise. Recorded in docs/task-tracker.md.
 */

/**
 * §8: an icon stands beside the words, never instead of them — every row here
 * carries its title as text, so the icon is decoration and is `aria-hidden`.
 *
 * Typed as `IconName`, so naming an icon the design system does not have is a
 * compile error. Four plausible-sounding names (`alert-circle`, `check-circle`,
 * `refresh`, `plus-circle`) were exactly that.
 */
const ICON: Record<string, IconName> = {
  certificate_earned: "award",
  project_rejected: "flag",
  milestone_reviewed: "check",
  module_updated: "layers",
  module_added: "plus",
  reinforcement_added: "plus",
  account_notice: "info",
};

export function Notifications() {
  const client = useQueryClient();

  const { data, isPending, error } = useQuery({
    queryKey: notificationsKey,
    queryFn: ({ signal }) => notificationsApi.list(signal),
  });

  const invalidate = () => client.invalidateQueries({ queryKey: notificationsKey });

  const markRead = useMutation({
    mutationFn: (id: string) => notificationsApi.markRead(id),
    onSuccess: invalidate,
  });

  const markAllRead = useMutation({
    mutationFn: () => notificationsApi.markAllRead(),
    onSuccess: invalidate,
  });

  if (isPending) {
    return (
      <p role="status" aria-live="polite" className={styles.hint}>
        Loading your notifications…
      </p>
    );
  }

  if (error || !data) {
    return (
      <p role="alert" className={styles.error}>
        {error instanceof ApiError
          ? error.message
          : "Your notifications did not load. Try again in a moment."}
      </p>
    );
  }

  const groups = group(data.notifications);

  return (
    <div className={styles.page}>
      <header className={styles.header}>
        <h1 className={styles.title}>Notifications</h1>
        {data.unreadCount > 0 && (
          <Button
            variant="secondary"
            onClick={() => markAllRead.mutate()}
            disabled={markAllRead.isPending}
          >
            {markAllRead.isPending ? "Marking…" : "Mark all as read"}
          </Button>
        )}
      </header>

      {/*
        A polite live region, so the count changing after "Mark all as read" is
        announced rather than only seen (§12).
      */}
      <p role="status" aria-live="polite" className={styles.count}>
        {data.unreadCount === 0
          ? "Nothing unread."
          : `${data.unreadCount} unread notification${data.unreadCount === 1 ? "" : "s"}.`}
      </p>

      {data.notifications.length === 0 ? (
        <Card className={styles.empty}>
          {/* §9's copy, verbatim from §5.17. */}
          <p className={styles.emptyText}>You&rsquo;re all caught up.</p>
        </Card>
      ) : (
        groups.map((section) => (
          <section key={section.heading} aria-labelledby={`group-${section.heading}`}>
            <h2 id={`group-${section.heading}`} className={styles.groupHeading}>
              {section.heading}
            </h2>
            <ul className={styles.list}>
              {section.items.map((item) => (
                <li key={item.id}>
                  <Card
                    className={[styles.row, item.readAt ? styles.read : styles.unread]
                      .filter(Boolean)
                      .join(" ")}
                  >
                    <Icon
                      name={ICON[item.type] ?? "info"}
                      aria-hidden
                      className={styles.icon}
                    />

                    <div className={styles.rowText}>
                      <h3 className={styles.rowTitle}>{item.title}</h3>
                      {item.body && <p className={styles.body}>{item.body}</p>}
                      <time className={styles.when} dateTime={item.createdAt}>
                        {new Date(item.createdAt).toLocaleString()}
                      </time>
                    </div>

                    <div className={styles.rowActions}>
                      {/*
                        Opening it marks it read, which is what §5.17 means by
                        acting on an update — the learner has seen it by then.
                      */}
                      {item.link && (
                        <Link
                          to={item.link}
                          className={styles.open}
                          onClick={() => {
                            if (!item.readAt) markRead.mutate(item.id);
                          }}
                        >
                          Open
                        </Link>
                      )}
                      {!item.readAt && (
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => markRead.mutate(item.id)}
                          disabled={markRead.isPending}
                        >
                          Mark as read
                        </Button>
                      )}
                      {/* §8: read vs unread is a word, not only a background. */}
                      {item.readAt && <span className={styles.readLabel}>Read</span>}
                    </div>
                  </Card>
                </li>
              ))}
            </ul>
          </section>
        ))
      )}
    </div>
  );
}
