import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Badge } from "../../components/core/Badge";
import { Button } from "../../components/core/Button";
import { Card } from "../../components/core/Card";
import {
  adminUserKey,
  adminUsersApi,
  adminUsersKey,
  type Account,
  type UsersQuery,
} from "../../api/adminUsers";
import { useSession } from "../../features/auth/useSession";
import { ApiError } from "../../api/client";
import styles from "./Users.module.css";

/**
 * design.md §6.10 — Users.
 *
 * **Two of §6.10's three areas, and the third says why it is missing.**
 *
 * Learners and Admins are one searchable list filtered by role, because they
 * are the same table with the same columns; §6.10 separates them on the screen,
 * which is a layout decision rather than two features.
 *
 * **There is no "Invite admin" button**, and that is §6 rule 8: no endpoint
 * updates `users.role`. §6.10 asked for one; it was dropped rather than built,
 * and the screen names `npm run db:accounts` so an admin is not left looking
 * for a control that should exist. Deactivating an admin is a `status` change,
 * which rule 8 does not touch, so that half is here.
 *
 * **Data requests have no table.** Nothing in the schema records a data
 * download or deletion request, and §5.18's "Delete my account" meets a
 * separate problem (AGENT.md open question 17: an account that has logged an
 * admin action cannot be deleted, because `set null` is an update and the
 * append-only trigger blocks it). Said on the screen rather than mocked.
 *
 * **Nothing here can mark a module passed or change a score** — §6.10's own
 * sentence. The learner panel reads evidence and offers no control over it.
 */

const STATUS: Record<Account["status"], { label: string; tone: "verified" | "error" }> = {
  active: { label: "Active", tone: "verified" },
  suspended: { label: "Suspended", tone: "error" },
};

const DATE = new Intl.DateTimeFormat("en-GB", {
  day: "numeric",
  month: "short",
  year: "numeric",
});

export function Users() {
  const [search, setSearch] = useState("");
  const [role, setRole] = useState<UsersQuery["role"]>("learner");
  const [status, setStatus] = useState<UsersQuery["status"]>();
  const [open, setOpen] = useState<string>();

  const query: UsersQuery = { q: search, role, status };
  const { data, isPending, error } = useQuery({
    queryKey: adminUsersKey(query),
    queryFn: ({ signal }) => adminUsersApi.list(query, signal),
  });

  return (
    <div className={styles.page}>
      <header>
        <h1 className={styles.title}>Users</h1>
        <p className={styles.lede}>
          Search accounts, read a learner's record, and suspend or reactivate an account with a
          reason. Nothing here can mark a module passed or change a score.
        </p>
      </header>

      <Card className={styles.controls}>
        <div className={styles.field}>
          <label className={styles.label} htmlFor="user-search">
            Search by name or email
          </label>
          <input
            id="user-search"
            type="search"
            className={styles.input}
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Name or email"
          />
        </div>

        <fieldset className={styles.fieldset}>
          <legend className={styles.label}>Role</legend>
          <div className={styles.segmented}>
            {(["learner", "admin"] as const).map((value) => (
              <label key={value} className={styles.segment}>
                <input
                  type="radio"
                  name="role"
                  className={styles.radio}
                  checked={role === value}
                  onChange={() => setRole(value)}
                />
                <span>{value === "learner" ? "Learners" : "Admins"}</span>
              </label>
            ))}
          </div>
        </fieldset>

        <div className={styles.field}>
          <label className={styles.label} htmlFor="user-status">
            Status
          </label>
          <select
            id="user-status"
            className={styles.select}
            value={status ?? ""}
            onChange={(event) =>
              setStatus((event.target.value || undefined) as UsersQuery["status"])
            }
          >
            <option value="">Any status</option>
            <option value="active">Active</option>
            <option value="suspended">Suspended</option>
          </select>
        </div>
      </Card>

      {isPending ? (
        <p role="status" aria-live="polite" className={styles.hint}>
          Loading accounts…
        </p>
      ) : error ? (
        <p role="alert" className={styles.error}>
          {error instanceof ApiError
            ? error.message
            : "Accounts did not load. Try again in a moment."}
        </p>
      ) : (
        <>
          {role === "admin" && (
            <p className={styles.adminCount}>
              {data.activeAdmins === 1
                ? "One admin can currently reach the admin area."
                : `${data.activeAdmins} admins can currently reach the admin area.`}
            </p>
          )}

          {data.users.length === 0 ? (
            <Card className={styles.empty}>
              <p className={styles.hint}>Nothing matches that search.</p>
            </Card>
          ) : (
            <ul className={styles.list}>
              {data.users.map((account) => (
                <li key={account.id}>
                  <Row
                    account={account}
                    query={query}
                    open={open === account.id}
                    onToggle={() => setOpen(open === account.id ? undefined : account.id)}
                  />
                </li>
              ))}
            </ul>
          )}
        </>
      )}

      {/*
        §6.10's third area. Nothing records a request, so there is nothing to
        process — and §5.18's deletion has its own unresolved problem. Naming
        both beats a tab that lists nothing.
      */}
      <Card className={styles.notBuilt}>
        <h2 className={styles.notBuiltTitle}>Not built yet</h2>
        <p className={styles.hint}>
          <strong>Data requests.</strong> Nothing in the schema records a data download or
          deletion request, so there is nothing for this page to process yet. Account deletion
          also has an open question behind it: an account that has logged an admin action cannot
          be deleted, because the activity log refuses to be changed.
        </p>
        <p className={styles.hint}>
          <strong>Inviting an admin.</strong> No endpoint may set an account's role, so an admin
          is made by running <code className={styles.code}>npm run db:accounts</code> or by SQL.
          Deactivating one is a status change, which is on this page.
        </p>
      </Card>
    </div>
  );
}

function Row({
  account,
  query,
  open,
  onToggle,
}: {
  account: Account;
  query: UsersQuery;
  open: boolean;
  onToggle: () => void;
}) {
  const session = useSession();
  const isYou = session.user?.id === account.id;

  return (
    <Card className={styles.row}>
      <div className={styles.rowHead}>
        <div>
          <h2 className={styles.name}>
            {account.fullName}
            {isYou && <span className={styles.you}> (you)</span>}
          </h2>
          <p className={styles.meta}>
            {account.email} · joined {DATE.format(new Date(account.createdAt))}
            {account.lastLoginAt
              ? ` · last signed in ${DATE.format(new Date(account.lastLoginAt))}`
              : " · never signed in"}
          </p>
        </div>
        <Badge tone={STATUS[account.status].tone}>{STATUS[account.status].label}</Badge>
      </div>

      <div className={styles.rowActions}>
        <Button variant="secondary" onClick={onToggle} aria-expanded={open}>
          {open ? "Hide details" : `View ${account.role === "admin" ? "account" : "record"}`}
        </Button>
        <StatusControl account={account} query={query} isYou={isYou} />
      </div>

      {open && <Detail account={account} />}
    </Card>
  );
}

/**
 * Suspend or reactivate, with a reason.
 *
 * **The reason field is not optional and not pre-filled.** §6.10 says "with a
 * reason" and the API refuses without one; a default like "Policy violation"
 * would make the log read as though somebody wrote it.
 */
function StatusControl({
  account,
  query,
  isYou,
}: {
  account: Account;
  query: UsersQuery;
  isYou: boolean;
}) {
  const client = useQueryClient();
  const [asking, setAsking] = useState(false);
  const [reason, setReason] = useState("");

  const next = account.status === "active" ? "suspended" : "active";
  const verb = next === "suspended" ? "Suspend" : "Reactivate";

  const mutation = useMutation({
    mutationFn: () => adminUsersApi.setStatus(account.id, { status: next, reason }),
    onSuccess: () => {
      setAsking(false);
      setReason("");
      void client.invalidateQueries({ queryKey: adminUsersKey(query) });
      void client.invalidateQueries({ queryKey: adminUserKey(account.id) });
    },
  });

  if (isYou) {
    return (
      <p className={styles.hint}>
        You can&apos;t change your own account&apos;s status. Ask another admin.
      </p>
    );
  }

  if (!asking) {
    return (
      <Button
        variant={next === "suspended" ? "destructive" : "primary"}
        onClick={() => setAsking(true)}
      >
        {`${verb} account`}
      </Button>
    );
  }

  return (
    <form
      className={styles.reasonForm}
      onSubmit={(event) => {
        event.preventDefault();
        mutation.mutate();
      }}
    >
      <label className={styles.label} htmlFor={`reason-${account.id}`}>
        {next === "suspended"
          ? "Why is this account being suspended?"
          : "Why is this account being reactivated?"}
      </label>
      <textarea
        id={`reason-${account.id}`}
        className={styles.textarea}
        value={reason}
        onChange={(event) => setReason(event.target.value)}
        rows={2}
        required
      />
      <p className={styles.hint}>
        {next === "suspended"
          ? "The account is signed out immediately and cannot sign back in. This is recorded in the activity log."
          : "They can sign in again. This is recorded in the activity log."}
      </p>
      {mutation.error && (
        <p role="alert" className={styles.error}>
          {mutation.error instanceof ApiError
            ? mutation.error.message
            : "That did not save. Try again in a moment."}
        </p>
      )}
      <div className={styles.reasonActions}>
        <Button
          type="submit"
          variant={next === "suspended" ? "destructive" : "primary"}
          disabled={reason.trim().length === 0 || mutation.isPending}
        >
          {mutation.isPending ? `${verb}ing…` : verb}
        </Button>
        <Button type="button" variant="secondary" onClick={() => setAsking(false)}>
          Cancel
        </Button>
      </div>
    </form>
  );
}

/** §6.10: "view roadmaps, progress, projects, and certificates". All reads. */
function Detail({ account }: { account: Account }) {
  const { data, isPending, error } = useQuery({
    queryKey: adminUserKey(account.id),
    queryFn: ({ signal }) => adminUsersApi.get(account.id, signal),
  });

  if (isPending) {
    return (
      <p role="status" aria-live="polite" className={styles.hint}>
        Loading the record…
      </p>
    );
  }
  if (error || !data) {
    return (
      <p role="alert" className={styles.error}>
        That record did not load. Try again in a moment.
      </p>
    );
  }

  const passed = data.completions.passed ?? 0;
  const testedOut = data.completions.tested_out ?? 0;
  const overrides = data.completions.override ?? 0;

  return (
    <div className={styles.detail}>
      <section>
        <h3 className={styles.sectionTitle}>Progress</h3>
        <p className={styles.counts}>
          <strong>{passed}</strong> modules passed · <strong>{testedOut}</strong> tested out ·{" "}
          <strong>{overrides}</strong> {overrides === 1 ? "override" : "overrides"}
        </p>
        {/*
          §6 rule 10: an override is an admin's correction, not the learner's
          work. Shown separately so a corrected record cannot read as a clean
          one — and read-only, because §6.10 forbids changing a score here.
        */}
        <p className={styles.hint}>
          An override is a logged admin correction, not work the learner did.
        </p>
      </section>

      <section>
        <h3 className={styles.sectionTitle}>Roadmaps</h3>
        {data.roadmaps.length === 0 ? (
          <p className={styles.hint}>No roadmap yet.</p>
        ) : (
          <ul className={styles.plainList}>
            {data.roadmaps.map((roadmap) => (
              <li key={roadmap.id}>
                {roadmap.pathTitle}
                {roadmap.trackTitle ? `, ${roadmap.trackTitle} track` : ""} — {roadmap.status}
              </li>
            ))}
          </ul>
        )}
      </section>

      <section>
        <h3 className={styles.sectionTitle}>Capstone projects</h3>
        {data.projects.length === 0 ? (
          <p className={styles.hint}>No project started.</p>
        ) : (
          <ul className={styles.plainList}>
            {data.projects.map((project) => (
              <li key={project.id}>
                {project.briefTitle} — {project.status}
                {project.repoFullName ? ` (${project.repoFullName})` : ""}
              </li>
            ))}
          </ul>
        )}
      </section>

      <section>
        <h3 className={styles.sectionTitle}>Certificates</h3>
        {data.certificates.length === 0 ? (
          <p className={styles.hint}>None issued.</p>
        ) : (
          <ul className={styles.plainList}>
            {data.certificates.map((certificate) => (
              <li key={certificate.id}>
                {certificate.title} — {certificate.status} ·{" "}
                <span className={styles.code}>{certificate.publicCode}</span>
              </li>
            ))}
          </ul>
        )}
      </section>

      {data.statusHistory.length > 0 && (
        <section>
          <h3 className={styles.sectionTitle}>Status history</h3>
          {/*
            Read back out of the append-only log. `users.status` holds the
            current state and no reason, so this is the only place the question
            "why was this suspended?" has an answer.
          */}
          <ul className={styles.plainList}>
            {data.statusHistory.map((entry) => (
              <li key={`${entry.action}-${entry.at}`}>
                {entry.action === "account.suspended" ? "Suspended" : "Reactivated"} on{" "}
                {DATE.format(new Date(entry.at))}
                {entry.by ? ` by ${entry.by}` : ""}
                {entry.reason ? ` — ${entry.reason}` : ""}
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
