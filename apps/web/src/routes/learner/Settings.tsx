import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Badge } from "../../components/core/Badge";
import { Button } from "../../components/core/Button";
import { Card } from "../../components/core/Card";
import { Icon } from "../../components/core/Icon";
import { Input } from "../../components/forms/Input";
import { ApiError } from "../../api/client";
import { accountApi, accountKey, type Account } from "../../api/account";
import { githubApi, githubKey, type GitHubConnection } from "../../api/github";
import { downloadFile } from "../../api/download";
import { sessionKey, useSessionActions } from "../../features/auth/useSession";
import styles from "./Settings.module.css";

/**
 * design.md §5.18 — Settings.
 *
 * §5.18 lists five sections. **Four are here, and the fifth says why it is
 * not**: "choose which notifications to receive by email" has no control,
 * because nothing in the platform sends a notification by email. There are two
 * mail templates, verification and reset, and the only `notifications` writer
 * inserts an in-app row. A toggle here would store a preference that changes
 * nothing — the state §6.11's two unenforced rules are already in, and not one
 * worth entering twice. It is said on the screen rather than left blank, which
 * is the rule the admin screens follow too: an absence with no explanation
 * reads as unfinished rather than as decided.
 */
export function Settings() {
  const account = useQuery({
    queryKey: accountKey,
    queryFn: ({ signal }) => accountApi.get(signal),
  });

  const github = useQuery({
    queryKey: githubKey,
    queryFn: ({ signal }) => githubApi.connection(signal),
  });

  if (account.isPending) {
    return (
      <p role="status" aria-live="polite" className={styles.loading}>
        Loading your settings…
      </p>
    );
  }

  if (account.error || !account.data) {
    return (
      <Card surface="white" radius="panel" padding="lg">
        <h1 className={styles.title}>Your settings aren&apos;t available right now</h1>
        <p className={styles.lede}>
          {account.error instanceof ApiError
            ? account.error.message
            : "This is usually temporary. Nothing about your account has changed — try again in a moment."}
        </p>
      </Card>
    );
  }

  return (
    <div className={styles.page}>
      <Card surface="white" radius="panel" padding="lg" className={styles.header}>
        <h1 className={styles.title}>Settings</h1>
        <p className={styles.lede}>Your account, your sign-in, and your data.</p>
      </Card>

      <ProfileSection account={account.data} />
      <PasswordSection />
      <GitHubSection connection={github.data} loading={github.isPending} />
      <NotificationsSection />
      <DataSection account={account.data} />
    </div>
  );
}

function Section({
  title,
  description,
  children,
}: {
  title: string;
  description?: string;
  children: React.ReactNode;
}) {
  return (
    <Card surface="white" radius="panel" padding="lg" className={styles.section}>
      <h2 className={styles.sectionTitle}>{title}</h2>
      {description && <p className={styles.sectionLede}>{description}</p>}
      {children}
    </Card>
  );
}

function ProfileSection({ account }: { account: Account }) {
  const client = useQueryClient();
  const [fullName, setFullName] = useState(account.fullName);
  const [email, setEmail] = useState(account.email);
  const [saved, setSaved] = useState<{ emailChanged: boolean; sent: boolean } | null>(null);

  const save = useMutation({
    mutationFn: accountApi.saveProfile,
    onSuccess: async (result) => {
      setSaved({ emailChanged: result.emailChanged, sent: result.verificationSent });
      // The name and the verified flag both live on the session, so the shell's
      // profile menu is stale until this refetches.
      await client.invalidateQueries({ queryKey: accountKey });
      await client.invalidateQueries({ queryKey: sessionKey });
    },
  });

  const changed = fullName !== account.fullName || email !== account.email;

  return (
    <Section title="Profile">
      <form
        className={styles.form}
        onSubmit={(event) => {
          event.preventDefault();
          setSaved(null);
          save.mutate({ fullName, email });
        }}
      >
        <Input
          label="Full name"
          value={fullName}
          onChange={(event) => setFullName(event.target.value)}
          maxLength={120}
          required
          hint="This goes on certificates you earn from now on. Certificates you already have keep the name they were issued with."
        />

        <div className={styles.emailRow}>
          <Input
            label="Email"
            type="email"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            required
            hint="Changing this means confirming the new address before it counts as verified."
          />
          {account.emailVerified ? (
            <Badge tone="verified" icon="check">
              Verified
            </Badge>
          ) : (
            <Badge tone="notice" icon="info">
              Not confirmed yet
            </Badge>
          )}
        </div>

        <div className={styles.actions}>
          <Button type="submit" disabled={!changed || save.isPending}>
            {save.isPending ? "Saving…" : "Save profile"}
          </Button>
        </div>

        {save.error && (
          <p role="alert" className={styles.error}>
            {save.error instanceof ApiError
              ? save.error.message
              : "That didn't save. Try again in a moment."}
          </p>
        )}

        {saved && (
          <p role="status" aria-live="polite" className={styles.ok}>
            {!saved.emailChanged
              ? "Profile saved."
              : saved.sent
                ? "Profile saved. Check your new address for a link to confirm it."
                : "Profile saved, but we couldn't send the confirmation email just now. Try saving again in a minute to resend it."}
          </p>
        )}
      </form>

      <p className={styles.note}>
        Your education details live on the <a href="/app/resume">Resume</a>, next to the evidence
        they sit beside.
      </p>
    </Section>
  );
}

function PasswordSection() {
  const [currentPassword, setCurrent] = useState("");
  const [newPassword, setNew] = useState("");
  const [done, setDone] = useState(false);

  const change = useMutation({
    mutationFn: accountApi.changePassword,
    onSuccess: () => {
      setDone(true);
      setCurrent("");
      setNew("");
    },
  });

  return (
    <Section
      title="Password"
      description="Changing your password signs you out everywhere else. You'll stay signed in here."
    >
      <form
        className={styles.form}
        onSubmit={(event) => {
          event.preventDefault();
          setDone(false);
          change.mutate({ currentPassword, newPassword });
        }}
      >
        <Input
          label="Current password"
          type="password"
          autoComplete="current-password"
          value={currentPassword}
          onChange={(event) => setCurrent(event.target.value)}
          required
        />
        <Input
          label="New password"
          type="password"
          autoComplete="new-password"
          value={newPassword}
          onChange={(event) => setNew(event.target.value)}
          minLength={8}
          required
          hint="At least 8 characters."
        />

        <div className={styles.actions}>
          <Button
            type="submit"
            disabled={change.isPending || !currentPassword || !newPassword}
          >
            {change.isPending ? "Changing…" : "Change password"}
          </Button>
        </div>

        {change.error && (
          <p role="alert" className={styles.error}>
            {change.error instanceof ApiError
              ? change.error.message
              : "That didn't change. Try again in a moment."}
          </p>
        )}

        {done && (
          <p role="status" aria-live="polite" className={styles.ok}>
            Password changed. Any other browser you were signed in on has been signed out.
          </p>
        )}
      </form>
    </Section>
  );
}

function GitHubSection({
  connection,
  loading,
}: {
  connection: GitHubConnection | undefined;
  loading: boolean;
}) {
  const client = useQueryClient();
  const [confirming, setConfirming] = useState(false);

  const disconnect = useMutation({
    mutationFn: githubApi.disconnect,
    onSuccess: async () => {
      setConfirming(false);
      await client.invalidateQueries({ queryKey: githubKey });
    },
  });

  if (loading) {
    return (
      <Section title="GitHub">
        <p role="status" aria-live="polite" className={styles.sectionLede}>
          Checking your connection…
        </p>
      </Section>
    );
  }

  if (!connection?.connected) {
    return (
      <Section title="GitHub">
        <p className={styles.sectionLede}>
          No GitHub account is connected. You&apos;ll be asked to connect one when you start your
          capstone project.
        </p>
      </Section>
    );
  }

  return (
    <Section title="GitHub">
      <dl className={styles.pairs}>
        <div className={styles.pair}>
          <dt className={styles.pairLabel}>Account</dt>
          <dd className={styles.pairValue}>
            <span className={styles.mono}>{connection.login}</span>
          </dd>
        </div>
        <div className={styles.pair}>
          <dt className={styles.pairLabel}>Connected</dt>
          <dd className={styles.pairValue}>
            {connection.connectedAt
              ? new Date(connection.connectedAt).toLocaleDateString()
              : "—"}
          </dd>
        </div>
      </dl>

      {/*
        §8: a status is icon and text and colour. "Connected but unreachable" is
        a real third state — the API says so rather than reporting the account
        as disconnected — and it must not look like a failure of the learner's.
      */}
      {connection.reachable === false && (
        <p className={styles.warn}>
          <Icon name="info" size={16} />
          We can&apos;t reach GitHub right now, so the repository list below may be incomplete.
          Your connection is fine.
        </p>
      )}

      <h3 className={styles.subTitle}>
        Repositories this connection can read ({connection.repositories.length})
      </h3>
      {connection.repositories.length === 0 ? (
        <p className={styles.sectionLede}>
          None yet. You choose which repository to grant when you connect your project.
        </p>
      ) : (
        <ul className={styles.repos}>
          {connection.repositories.map((repo) => (
            <li key={repo.id} className={styles.repo}>
              <span className={styles.mono}>{repo.fullName}</span>
              {repo.private && (
                <Badge tone="neutral" icon="lock">
                  Private
                </Badge>
              )}
            </li>
          ))}
        </ul>
      )}

      {confirming ? (
        <div className={styles.confirm}>
          <p className={styles.confirmText}>
            Disconnect <span className={styles.mono}>{connection.login}</span>? We&apos;ll stop
            reading your repository, so new commits won&apos;t be checked against your capstone
            milestones. Milestones you have already passed stay passed, and nothing in your project
            is deleted.
          </p>
          <div className={styles.actions}>
            <Button variant="secondary" onClick={() => setConfirming(false)}>
              Keep it connected
            </Button>
            <Button
              variant="destructive"
              onClick={() => disconnect.mutate()}
              disabled={disconnect.isPending}
            >
              {disconnect.isPending ? "Disconnecting…" : "Disconnect GitHub"}
            </Button>
          </div>
        </div>
      ) : (
        <div className={styles.actions}>
          <Button variant="outline" onClick={() => setConfirming(true)}>
            Disconnect GitHub
          </Button>
        </div>
      )}

      {disconnect.error && (
        <p role="alert" className={styles.error}>
          {disconnect.error instanceof ApiError
            ? disconnect.error.message
            : "That didn't disconnect. Try again in a moment."}
        </p>
      )}
    </Section>
  );
}

/**
 * The section §5.18 asks for and the platform cannot honour yet.
 *
 * Saying so here costs four lines and means an admin or a learner looking for
 * the setting finds an answer instead of an absence.
 */
function NotificationsSection() {
  return (
    <Section title="Notifications">
      <p className={styles.sectionLede}>
        Everything arrives in <a href="/app/notifications">Notifications</a> — a certificate you
        earn, a decision on a project. <strong>Nothing is sent to your email</strong>, so there is
        nothing to turn off here yet. The only emails we send are the ones you ask for: confirming
        your address and resetting your password.
      </p>
    </Section>
  );
}

function DataSection({ account }: { account: Account }) {
  const [downloading, setDownloading] = useState(false);
  const [downloadError, setDownloadError] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);

  async function download() {
    setDownloadError(null);
    setDownloading(true);
    try {
      await downloadFile("/account/export", "first-commit-data.json");
    } catch (err) {
      setDownloadError(
        err instanceof Error ? err.message : "The download didn't start. Try again in a moment.",
      );
    } finally {
      setDownloading(false);
    }
  }

  return (
    <Section title="Data and account">
      <div className={styles.actions}>
        <Button variant="outline" icon="file-text" onClick={download} disabled={downloading}>
          {downloading ? "Preparing…" : "Download my data"}
        </Button>
      </div>
      <p className={styles.note}>
        A JSON file with your roadmaps, progress, answers, projects, certificates and resume. It
        says inside what it leaves out.
      </p>

      {downloadError && (
        <p role="alert" className={styles.error}>
          {downloadError}
        </p>
      )}

      <hr className={styles.rule} />

      {account.canDelete ? (
        <>
          <div className={styles.actions}>
            <Button variant="destructive" onClick={() => setConfirming(true)}>
              Delete my account
            </Button>
          </div>
          <p className={styles.note}>
            This cannot be undone. Download your data first if you want to keep it.
          </p>
        </>
      ) : (
        /*
          The API decides this, not the screen. An admin has entries in an
          append-only log, so deleting the account would mean editing the record
          of what it did.
        */
        <p className={styles.note}>
          This account keeps a record in the admin activity log, which cannot be edited or removed,
          so it can&apos;t be deleted here. Another admin can suspend it instead.
        </p>
      )}

      {confirming && <DeleteDialog onClose={() => setConfirming(false)} />}
    </Section>
  );
}

/**
 * §5.18's delete dialog, with its copy word for word.
 *
 * §12 requires focus to move into a dialog and return when it closes, so that
 * is wired here rather than left to the browser: the dialog takes focus on
 * open, Escape closes it, Tab is held inside it, and the control that opened it
 * gets focus back. §5.18's dialog has exactly two buttons and no password
 * field — the spec's wording is the confirmation, and the CSRF guard plus the
 * session is what authorises the request.
 */
function DeleteDialog({ onClose }: { onClose: () => void }) {
  const navigate = useNavigate();
  const { clearSession } = useSessionActions();
  const dialog = useRef<HTMLDivElement>(null);

  const remove = useMutation({
    mutationFn: accountApi.deleteAccount,
    onSuccess: async () => {
      // The same order as signing out: the API has already dropped the
      // sessions, so clear the cache before navigating or a guard will bounce
      // through the signed-in tree on the way out.
      await clearSession();
      navigate("/", { replace: true });
    },
  });

  /**
   * Focus in, focus back, Escape out, Tab held inside — §12's four promises
   * about a dialog.
   *
   * **The listener is attached here rather than as an `onKeyDown` prop**, and
   * not to satisfy a linter. A modal's Escape belongs at the document: a
   * keydown prop on this element only fires while focus is *inside* it, which
   * is true right now and stops being true the moment anything here renders
   * through a portal or the browser parks focus on `body`. Attaching it at the
   * document is the behaviour a modal is supposed to have, and it also means
   * `jsx-a11y/no-noninteractive-element-interactions` has nothing to object to
   * — the rule was right that a handler prop on a `role="dialog"` div is the
   * wrong shape.
   *
   * `showModal()` would hand all of this to the browser and is the better
   * answer the day it can be tested: jsdom 30 still does not implement it, so
   * a native modal would be a dialog no test in this suite could open.
   */
  useEffect(() => {
    const previous = document.activeElement;
    dialog.current?.focus();

    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        onClose();
        return;
      }
      if (event.key !== "Tab") return;

      const focusable = dialog.current?.querySelectorAll<HTMLElement>(
        "button:not([disabled])",
      );
      if (!focusable || focusable.length === 0) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];

      // Only the two edges need handling; Tab between them is the browser's.
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    }

    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      // Back where they were, so closing the dialog does not drop the learner
      // at the top of the page (§12).
      if (previous instanceof HTMLElement) previous.focus();
    };
  }, [onClose]);

  return (
    <div className={styles.backdrop}>
      <div
        ref={dialog}
        tabIndex={-1}
        className={styles.dialog}
        role="dialog"
        aria-modal="true"
        aria-labelledby="delete-title"
        aria-describedby="delete-body"
      >
        <h2 id="delete-title" className={styles.dialogTitle}>
          Delete your account?
        </h2>
        <p id="delete-body" className={styles.dialogBody}>
          Your roadmaps, progress, resumes, and certificates will be permanently deleted, and your
          certificate verification links will stop working. This can&apos;t be undone.
        </p>

        <div className={styles.dialogActions}>
          <Button variant="secondary" onClick={onClose} disabled={remove.isPending}>
            Cancel
          </Button>
          <Button
            variant="destructive"
            onClick={() => remove.mutate()}
            disabled={remove.isPending}
          >
            {remove.isPending ? "Deleting…" : "Delete my account"}
          </Button>
        </div>

        {remove.error && (
          <p role="alert" className={styles.error}>
            {remove.error instanceof ApiError
              ? remove.error.message
              : "That didn't delete. Try again in a moment."}
          </p>
        )}
      </div>
    </div>
  );
}
