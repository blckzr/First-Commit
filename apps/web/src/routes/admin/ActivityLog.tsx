import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Card } from "../../components/core/Card";
import { Button } from "../../components/core/Button";
import {
  adminActivityApi,
  adminActivityFiltersKey,
  adminActivityKey,
  type ActivityEntry,
  type ActivityQuery,
} from "../../api/adminActivity";
import { ApiError } from "../../api/client";
import styles from "./ActivityLog.module.css";

/**
 * design.md §6.12 — the activity log.
 *
 * **Read-only, with no edit control anywhere.** §6.12: "No admin can edit or
 * delete entries, including their own." There is no endpoint either, and the
 * database blocks an update with a trigger — so the absence of a button here is
 * the third of three layers, not the only one.
 *
 * **Two translations happen on this screen, and both are the point of it.** A
 * row in `admin_activity_log` is `module_version.published` against a uuid;
 * what an admin needs is "Published a module version — JavaScript basics
 * (version 3)". The API resolves the target to a name; this file turns the
 * dotted action into a sentence (§9: name things the way people do). An action
 * this file has not met falls back to its raw form rather than being hidden,
 * because a log that quietly omits what it cannot label is not a log.
 */

/**
 * Every action the platform logs today, as a person would say it.
 *
 * Deliberately a lookup with a fallback rather than a prettifier over the
 * string. `ai_flag.confirmed_wrong` is "Ruled AI feedback wrong", not "Ai flag
 * confirmed wrong", and no amount of capitalisation gets there.
 */
const ACTIONS: Record<string, string> = {
  "module_version.published": "Published a module version",
  "module_version.discarded": "Discarded a draft version",
  "brief_version.published": "Published a capstone brief version",
  "certificate.revoked": "Withdrew a certificate",
  "ai_flag.confirmed_wrong": "Ruled AI feedback wrong",
  "ai_flag.confirmed_correct": "Ruled AI feedback correct",
  "certificate_requirement.added": "Made a module required for the certificate",
  "certificate_requirement.removed": "Made a module optional",
  "account.suspended": "Suspended an account",
  "account.reactivated": "Reactivated an account",
  "setting.changed": "Changed a platform setting",
  "integrity.cleared": "Cleared an integrity flag",
  "integrity.explanation_requested": "Asked for an explanation",
  "integrity.redo_requested": "Asked for the work to be redone",
  "integrity.rejected": "Rejected a project",
};

/** What a target type is called, for the fallback line. */
const TARGETS: Record<string, string> = {
  module_version: "module version",
  module: "module",
  capstone_brief_version: "capstone brief version",
  certificate: "certificate",
  ai_feedback_flag: "flagged AI feedback",
  integrity_flag: "integrity flag",
  user: "account",
  platform_setting: "setting",
};

const DATE = new Intl.DateTimeFormat("en-GB", {
  day: "numeric",
  month: "short",
  year: "numeric",
  hour: "2-digit",
  minute: "2-digit",
});

export function ActivityLog() {
  const [filters, setFilters] = useState<ActivityQuery>({});
  /** Cursors pushed as pages are walked, so Back is a pop rather than a refetch. */
  const [cursors, setCursors] = useState<string[]>([]);

  const query: ActivityQuery = { ...filters, before: cursors.at(-1) };

  const { data, isPending, error } = useQuery({
    queryKey: adminActivityKey(query),
    queryFn: ({ signal }) => adminActivityApi.list(query, signal),
  });

  const options = useQuery({
    queryKey: adminActivityFiltersKey,
    queryFn: ({ signal }) => adminActivityApi.filters(signal),
  });

  /** Changing a filter restarts the walk; page 3 of the old filter is meaningless. */
  const change = (next: Partial<ActivityQuery>) => {
    setFilters({ ...filters, ...next });
    setCursors([]);
  };

  return (
    <div className={styles.page}>
      <header>
        <h1 className={styles.title}>Activity log</h1>
        <p className={styles.lede}>
          Every sensitive admin action, with who did it and why. Entries cannot be edited or
          deleted — including your own.
        </p>
      </header>

      <Card className={styles.filters}>
        <h2 className={styles.filtersTitle}>Filter</h2>
        <div className={styles.filterRow}>
          <div className={styles.field}>
            <label className={styles.label} htmlFor="log-action">
              Action
            </label>
            <select
              id="log-action"
              className={styles.select}
              value={filters.action ?? ""}
              onChange={(event) => change({ action: event.target.value || undefined })}
            >
              <option value="">All actions</option>
              {(options.data?.actions ?? []).map((action) => (
                <option key={action.action} value={action.action}>
                  {`${ACTIONS[action.action] ?? action.action} (${action.count})`}
                </option>
              ))}
            </select>
          </div>

          <div className={styles.field}>
            <label className={styles.label} htmlFor="log-admin">
              Admin
            </label>
            <select
              id="log-admin"
              className={styles.select}
              value={filters.admin ?? ""}
              onChange={(event) => change({ admin: event.target.value || undefined })}
            >
              <option value="">All admins</option>
              {(options.data?.admins ?? []).map((admin) => (
                <option key={admin.id} value={admin.id}>
                  {admin.fullName}
                </option>
              ))}
            </select>
          </div>

          <div className={styles.field}>
            <label className={styles.label} htmlFor="log-from">
              From
            </label>
            <input
              id="log-from"
              type="date"
              className={styles.input}
              value={filters.from ?? ""}
              onChange={(event) => change({ from: event.target.value || undefined })}
            />
          </div>

          <div className={styles.field}>
            <label className={styles.label} htmlFor="log-to">
              To
            </label>
            <input
              id="log-to"
              type="date"
              className={styles.input}
              value={filters.to ?? ""}
              onChange={(event) => change({ to: event.target.value || undefined })}
            />
          </div>
        </div>
      </Card>

      {isPending ? (
        <p role="status" aria-live="polite" className={styles.hint}>
          Loading the log…
        </p>
      ) : error ? (
        <p role="alert" className={styles.error}>
          {error instanceof ApiError
            ? error.message
            : "The log did not load. Try again in a moment."}
        </p>
      ) : data.entries.length === 0 ? (
        <Card className={styles.empty}>
          <p className={styles.hint}>
            {Object.values(filters).some(Boolean)
              ? "Nothing matches those filters."
              : "No admin actions have been recorded yet. They appear here as soon as one is."}
          </p>
        </Card>
      ) : (
        <>
          {/*
            A table, because §6.12 specifies one and because the columns are
            genuinely comparable across rows — the one place in this app where a
            list of cards would be harder to scan rather than easier.
          */}
          {/*
            A focusable, labelled scroll region. A container that scrolls
            sideways has to be reachable by keyboard, or the columns past the
            fold are unreachable without a pointer (§12).
          */}
          <div
            className={styles.tableWrap}
            role="region"
            aria-label="Admin actions"
            tabIndex={0}
          >
            <table className={styles.table}>
              <caption className={styles.caption}>
                Admin actions, newest first. Read-only.
              </caption>
              <thead>
                <tr>
                  <th scope="col">When</th>
                  <th scope="col">Admin</th>
                  <th scope="col">Action</th>
                  <th scope="col">Target</th>
                  <th scope="col">Reason</th>
                </tr>
              </thead>
              <tbody>
                {data.entries.map((entry) => (
                  <Row key={entry.id} entry={entry} />
                ))}
              </tbody>
            </table>
          </div>

          <div className={styles.paging}>
            <Button
              variant="secondary"
              disabled={cursors.length === 0}
              onClick={() => setCursors(cursors.slice(0, -1))}
            >
              Newer
            </Button>
            <Button
              variant="secondary"
              disabled={data.nextBefore === null}
              onClick={() => data.nextBefore && setCursors([...cursors, data.nextBefore])}
            >
              Older
            </Button>
          </div>
        </>
      )}
    </div>
  );
}

function Row({ entry }: { entry: ActivityEntry }) {
  return (
    <tr>
      <td className={styles.when}>
        <time dateTime={entry.at}>{DATE.format(new Date(entry.at))}</time>
      </td>
      <td>
        {entry.admin ? (
          (entry.admin.fullName ?? "An admin")
        ) : (
          /*
            `admin_id` is `on delete set null`, so an entry outlives the account
            that made it — which is what append-only means. Saying so is more
            honest than a blank cell.
          */
          <span className={styles.gone}>An account since deleted</span>
        )}
      </td>
      <td className={styles.action}>{ACTIONS[entry.action] ?? entry.action}</td>
      <td>{targetText(entry)}</td>
      <td className={styles.reason}>
        {entry.reason ?? <span className={styles.none}>—</span>}
      </td>
    </tr>
  );
}

/**
 * What the target cell says.
 *
 * In order of preference: the resolved name; the setting's key for a setting,
 * which has no uuid to resolve; then the type on its own. A row never shows a
 * bare uuid — it is the one thing on this screen that means nothing to anybody.
 */
function targetText(entry: ActivityEntry): string {
  if (entry.target.label) return entry.target.label;

  const key = entry.details.key;
  if (typeof key === "string") return key;

  return TARGETS[entry.target.type] ?? entry.target.type;
}
