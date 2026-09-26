import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Badge } from "../../components/core/Badge";
import { Button } from "../../components/core/Button";
import { Card } from "../../components/core/Card";
import { Icon } from "../../components/core/Icon";
import { LinkButton } from "../../components/core/LinkButton";
import { ProgressBar } from "../../components/learning/ProgressBar";
import { certificatesApi, type Certificate, type Progress } from "../../api/certificates";
import { downloadPdf } from "../../api/download";
import { ApiError } from "../../api/client";
import styles from "./Certificates.module.css";

/**
 * design.md §5.15 — Certificates.
 *
 * **Nothing here asks for a certificate.** AGENT.md §6 rule 1: the backend checks
 * the requirements itself, so this screen reads and displays. Opening it is what
 * makes the server check, which is why a newly finished roadmap shows its
 * certificate the first time the page loads.
 *
 * The Project Certificate is Phase 4. §5.15 shows it locked with a reason, and
 * "the capstone isn't built yet" is a more honest reason than a milestone count
 * the platform cannot produce.
 */
export function Certificates() {
  const { data, isPending, error } = useQuery({
    queryKey: ["certificates"],
    queryFn: ({ signal }) => certificatesApi.list(signal),
  });

  if (isPending) {
    return (
      <p role="status" aria-live="polite" className={styles.loading}>
        Loading your certificates…
      </p>
    );
  }

  if (error || !data) {
    return (
      <Card surface="white" radius="panel" padding="lg" className={styles.empty}>
        <h1 className={styles.title}>Your certificates aren&apos;t available right now</h1>
        <p className={styles.lede}>
          {error instanceof ApiError
            ? error.message
            : "This is usually temporary. Nothing you earned is lost — try again in a moment."}
        </p>
      </Card>
    );
  }

  const earned = data.certificates.filter((c) => c.status !== "revoked");
  const revoked = data.certificates.filter((c) => c.status === "revoked");
  /** The roadmaps that could still earn one, closest to finished first. */
  const pending = data.progress
    .filter((p) => !earned.some((c) => c.roadmapId === p.roadmapId))
    .sort((a, b) => b.completed / (b.required || 1) - a.completed / (a.required || 1));

  return (
    <div className={styles.page}>
      <Card surface="white" radius="panel" padding="lg" className={styles.header}>
        <h1 className={styles.title}>Certificates</h1>
        <p className={styles.lede}>
          Each one has a verification link anybody can open — no account needed.
        </p>
      </Card>

      {earned.length === 0 && (
        /* §5.15's empty state, word for word. */
        <Card surface="white" radius="panel" padding="lg" className={styles.empty}>
          <h2 className={styles.emptyTitle}>Finish your roadmap to earn your first certificate.</h2>
          <LinkButton to="/app/roadmaps" icon="arrow-right">
            View roadmap
          </LinkButton>
        </Card>
      )}

      {earned.length > 0 && (
        <ul className={styles.list}>
          {earned.map((certificate) => (
            <li key={certificate.publicCode}>
              <CertificateCard certificate={certificate} />
            </li>
          ))}
        </ul>
      )}

      {pending.map((progress) => (
        <LockedRoadmap key={progress.roadmapId} progress={progress} />
      ))}

      {/* §5.15's locked Project Certificate. */}
      {!data.projectCertificate.available && (
        <Card surface="white" radius="panel" padding="lg" className={styles.locked}>
          <span className={styles.lockedHead}>
            <Icon name="lock" size={16} aria-hidden />
            <h2 className={styles.lockedTitle}>Project Certificate</h2>
          </span>
          <p className={styles.lede}>
            Earned by finishing a capstone project. Capstones aren&apos;t built yet — this is
            where yours will appear.
          </p>
        </Card>
      )}

      {revoked.length > 0 && (
        <section className={styles.revokedSection}>
          <h2 className={styles.sectionTitle}>Revoked</h2>
          <ul className={styles.list}>
            {revoked.map((certificate) => (
              <li key={certificate.publicCode}>
                <CertificateCard certificate={certificate} />
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}

const MONTH_DAY_YEAR: Intl.DateTimeFormatOptions = {
  year: "numeric",
  month: "long",
  day: "numeric",
};

function CertificateCard({ certificate }: { certificate: Certificate }) {
  const [copied, setCopied] = useState(false);
  const [downloadError, setDownloadError] = useState<string | null>(null);
  const revoked = certificate.status === "revoked";
  const url = `${window.location.origin}${certificate.verifyPath}`;

  async function copy() {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
    } catch {
      // Clipboard access can be refused. The link is on screen either way, so
      // there is nothing to apologise for — the label just does not change.
      setCopied(false);
    }
  }

  return (
    <Card surface="white" radius="card" padding="lg" className={styles.card}>
      <div className={styles.cardHead}>
        <span className={styles.cardKind}>
          <Icon name={revoked ? "x" : "award"} size={18} aria-hidden />
          {certificate.type === "completion" ? "Certificate of Completion" : "Project Certificate"}
        </span>
        {/* §8: status is icon + text + colour, never colour alone. */}
        {revoked ? (
          <Badge tone="error" icon="x">
            Revoked
          </Badge>
        ) : (
          <Badge tone="verified" icon="check">
            Valid
          </Badge>
        )}
      </div>

      <h3 className={styles.cardTitle}>{certificate.title}</h3>

      <p className={styles.meta}>
        Issued {new Date(certificate.issuedAt).toLocaleDateString(undefined, MONTH_DAY_YEAR)}
        {" · ID "}
        <span className={styles.code}>{certificate.publicCode}</span>
      </p>

      {certificate.skills.length > 0 && (
        <p className={styles.skills}>Skills verified: {certificate.skills.join(", ")}</p>
      )}

      {!revoked && (
        <div className={styles.actions}>
          {/* §9: buttons say what happens. Opens the page anybody else would see. */}
          <LinkButton to={certificate.verifyPath} variant="secondary">
            View
          </LinkButton>
          <Button variant="ghost" onClick={copy}>
            {copied ? "Link copied" : "Copy verification link"}
          </Button>
          {/*
            §5.15's "Download PDF". Generated on request rather than stored, so
            a file can never assert something the record no longer says — see
            `apps/api/src/pdf/routes.ts`.
          */}
          <Button
            variant="ghost"
            onClick={() =>
              downloadPdf(
                `/certificates/${certificate.publicCode}.pdf`,
                `${certificate.publicCode}.pdf`,
              ).catch((e: Error) => setDownloadError(e.message))
            }
          >
            Download PDF
          </Button>
        </div>
      )}

      {downloadError && (
        <p role="alert" className={styles.error}>
          {downloadError}
        </p>
      )}
    </Card>
  );
}

/**
 * A roadmap that has not earned its certificate, with the reason.
 *
 * §9: an empty state says what to do. "0 of 0 modules" would be true and useless,
 * so a roadmap that cannot be finished as it stands says why instead.
 */
function LockedRoadmap({ progress }: { progress: Progress }) {
  const label = `${progress.completed} of ${progress.required} modules passed`;

  return (
    <Card surface="soft" radius="panel" padding="lg" className={styles.locked}>
      <span className={styles.lockedHead}>
        <Icon name="lock" size={16} aria-hidden />
        <h2 className={styles.lockedTitle}>{progress.title}</h2>
      </span>

      {progress.blockedBy === "no-modules" ? (
        <p className={styles.lede}>
          This roadmap has no modules yet, so there is nothing to certify. Build it from your
          roadmaps page.
        </p>
      ) : progress.blockedBy === "technology-not-chosen" ? (
        <p className={styles.lede}>
          Choose your framework to see the rest of this roadmap. The certificate covers those
          modules too.
        </p>
      ) : (
        <>
          <ProgressBar
            value={(progress.completed / progress.required) * 100}
            label={label}
          />
          <p className={styles.lede}>Pass every module on this roadmap to earn its certificate.</p>
        </>
      )}

      <LinkButton to="/app/roadmaps" variant="secondary">
        View roadmap
      </LinkButton>
    </Card>
  );
}
