import { useParams } from "react-router";
import { useQuery } from "@tanstack/react-query";
import { Card } from "../../components/core/Card";
import { Icon } from "../../components/core/Icon";
import { certificatesApi } from "../../api/certificates";
import styles from "./Verify.module.css";

/**
 * design.md §5.15's public certificate verification page.
 *
 * **No session, and no app navigation.** §4.3 puts this in the public area: it is
 * opened by a stranger from a link or a QR code — an employer, most likely — who
 * has no account and should not be shown one. So there is no shell, nothing to
 * sign into, and no link into `/app`.
 *
 * **What it deliberately does not show:** §5.15 — "The page shows only the
 * learner's name and certificate details, never contact information." The API
 * withholds the email, the ids and the revocation reason, and the discriminated
 * union means reading a field off the wrong state is a compile error rather than
 * `undefined` on somebody's credential.
 *
 * The prototype does not cover this screen, so it is designed from §5.15's
 * content and §3's tokens — the same way Forgot and Reset password were.
 */
export function Verify() {
  const { code } = useParams();
  const { data, isPending, error } = useQuery({
    queryKey: ["verify", code],
    queryFn: ({ signal }) => certificatesApi.verify(code ?? "", signal),
    enabled: Boolean(code),
    // A verification result does not change while somebody reads it.
    staleTime: 60_000,
    retry: false,
  });

  return (
    <main className={styles.page}>
      <header className={styles.header}>
        <span className={styles.wordmark}>
          <span className={styles.mark}>
            <Icon name="code-xml" size={14} />
          </span>
          First <span className={styles.wordmarkAccent}>Commit</span>
        </span>
        <h1 className={styles.heading}>Certificate verification</h1>
      </header>

      <Card surface="white" radius="panel" padding="lg" className={styles.panel}>
        {isPending && (
          <p role="status" aria-live="polite" className={styles.muted}>
            Checking this certificate…
          </p>
        )}

        {error && (
          <p role="status" aria-live="polite" className={styles.muted}>
            We couldn&apos;t check this certificate right now. Try again in a moment.
          </p>
        )}

        {data?.status === "valid" && (
          <>
            {/* §8: icon + text + colour. The words carry it on their own. */}
            <p className={styles.verdictValid}>
              <Icon name="check" size={20} aria-hidden />
              Valid certificate
            </p>

            <p className={styles.recipient}>{data.recipientName}</p>
            <p className={styles.kind}>
              {data.type === "completion" ? "Certificate of Completion" : "Project Certificate"}
            </p>
            <p className={styles.subject}>{data.title}</p>

            {data.projectTitle && <p className={styles.detail}>Project: {data.projectTitle}</p>}

            <dl className={styles.facts}>
              <div>
                <dt>Issued</dt>
                <dd>
                  {new Date(data.issuedAt).toLocaleDateString(undefined, {
                    year: "numeric",
                    month: "long",
                    day: "numeric",
                  })}
                </dd>
              </div>
              <div>
                <dt>Certificate ID</dt>
                <dd className={styles.code}>{data.code}</dd>
              </div>
            </dl>

            {data.skills.length > 0 && (
              <p className={styles.detail}>Skills verified: {data.skills.join(", ")}</p>
            )}

            {data.repository && (
              <p className={styles.detail}>Repository: {data.repository}</p>
            )}
          </>
        )}

        {data?.status === "revoked" && (
          <>
            <p className={styles.verdictRevoked}>
              <Icon name="x" size={20} aria-hidden />
              This certificate was revoked
              {data.revokedAt
                ? ` on ${new Date(data.revokedAt).toLocaleDateString(undefined, {
                    year: "numeric",
                    month: "long",
                    day: "numeric",
                  })}`
                : ""}
            </p>
            {/*
              No reason, by design. §5.15 shows the date and nothing more — why a
              certificate was revoked is between the learner and the platform.
            */}
            <p className={styles.muted}>Certificate ID {data.code}</p>
          </>
        )}

        {data?.status === "not-found" && (
          /* §5.15's wording, and §9: explain and direct rather than just refuse. */
          <>
            <p className={styles.verdictUnknown}>
              <Icon name="info" size={20} aria-hidden />
              No certificate found with ID {data.code || "(none given)"}.
            </p>
            <p className={styles.muted}>Check the ID and try again.</p>
          </>
        )}
      </Card>

      <p className={styles.footer}>
        Certificates are issued by First Commit after a learner passes every module on their
        roadmap. Each one is checked against our records when this page loads.
      </p>
    </main>
  );
}
