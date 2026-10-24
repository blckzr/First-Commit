import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Badge } from "../../components/core/Badge";
import { Button } from "../../components/core/Button";
import { Card } from "../../components/core/Card";
import {
  adminCertificatesApi,
  adminCertificatesKey,
  type AdminCertificate,
} from "../../api/adminCertificates";
import { ApiError } from "../../api/client";
import styles from "./Certificates.module.css";

/**
 * design.md §6.7 — Certificates.
 *
 * **Two of §6.7's four areas, and the other two are honestly absent.** Issued
 * (search, open the public page) and Revoke are built. Templates and Reissue
 * have no endpoint and no column behind them, so there is a note saying so
 * rather than a button that does nothing — tracked in docs/task-tracker.md.
 *
 * **There is no issue button, and that is the design.** §6.7: "Certificates are
 * issued automatically when requirements are met; there is no manual issue
 * button." §6 rule 1 is why — `syncCertificates()` reads evidence and decides,
 * so a certificate always means the platform checked. An admin can withdraw one
 * it granted, which is the only thing here that takes something away from a
 * learner, so it needs a reason and it gets logged.
 */

const TYPE_LABEL: Record<AdminCertificate["type"], string> = {
  completion: "Certificate of Completion",
  project: "Project Certificate",
};

/** §8: status is text + colour, never colour alone. */
const STATUS: Record<
  AdminCertificate["status"],
  { label: string; tone: "verified" | "error" | "neutral" }
> = {
  valid: { label: "Valid", tone: "verified" },
  revoked: { label: "Revoked", tone: "error" },
  reissued: { label: "Reissued", tone: "neutral" },
};

export function Certificates() {
  const [search, setSearch] = useState("");
  const [revoking, setRevoking] = useState<string>();

  const { data, isPending, error } = useQuery({
    queryKey: adminCertificatesKey(search),
    queryFn: ({ signal }) => adminCertificatesApi.list(search, signal),
  });

  return (
    <div className={styles.page}>
      <header className={styles.header}>
        <h1 className={styles.title}>Certificates</h1>
        <p className={styles.lede}>
          Certificates are issued automatically when a learner meets the requirements. There is no
          manual issue button.
        </p>
      </header>

      <div className={styles.search}>
        <label className={styles.label} htmlFor="certificate-search">
          Search by name, email or certificate code
        </label>
        <input
          id="certificate-search"
          type="search"
          className={styles.input}
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          placeholder="Name, email, or code"
        />
      </div>

      {isPending ? (
        <p role="status" aria-live="polite" className={styles.hint}>
          Loading certificates…
        </p>
      ) : error || !data ? (
        <p role="alert" className={styles.error}>
          {error instanceof ApiError ? error.message : "That did not load. Try again in a moment."}
        </p>
      ) : data.certificates.length === 0 ? (
        <Card className={styles.empty}>
          <p className={styles.emptyText}>
            {search
              ? `Nothing matches that search.`
              : "No certificates have been issued yet. They appear here as learners finish."}
          </p>
        </Card>
      ) : (
        <ul className={styles.list}>
          {data.certificates.map((certificate) => (
            <li key={certificate.id}>
              <CertificateRow
                certificate={certificate}
                search={search}
                open={revoking === certificate.id}
                onToggle={() =>
                  setRevoking(revoking === certificate.id ? undefined : certificate.id)
                }
              />
            </li>
          ))}
        </ul>
      )}

      {/*
        §6.7 also specifies templates and reissue. Neither has an endpoint, and
        reissue needs a column to point the old code at the new certificate.
        Saying so beats a button that does nothing.
      */}
      <Card className={styles.notBuilt}>
        <h2 className={styles.notBuiltTitle}>Not built yet</h2>
        <p className={styles.hint}>
          Editing certificate templates, and reissuing one with corrected details, are specified in
          section 6.7 but have no endpoint behind them yet.
        </p>
      </Card>
    </div>
  );
}

function CertificateRow({
  certificate,
  search,
  open,
  onToggle,
}: {
  certificate: AdminCertificate;
  search: string;
  open: boolean;
  onToggle: () => void;
}) {
  const client = useQueryClient();
  const [reason, setReason] = useState("");
  const status = STATUS[certificate.status];

  const revoke = useMutation({
    mutationFn: () => adminCertificatesApi.revoke(certificate.id, reason),
    async onSuccess() {
      await client.invalidateQueries({ queryKey: adminCertificatesKey(search) });
      setReason("");
      onToggle();
    },
  });

  return (
    <Card className={styles.row}>
      <div className={styles.rowMain}>
        <div className={styles.rowText}>
          <h2 className={styles.recipient}>{certificate.recipientName}</h2>
          <p className={styles.meta}>
            {TYPE_LABEL[certificate.type]} — {certificate.title}
          </p>
          <p className={styles.meta}>
            <code className={styles.code}>{certificate.publicCode}</code>{" "}
            <span className={styles.muted}>{certificate.learner.email}</span>
          </p>
          <p className={styles.muted}>
            Issued{" "}
            <time dateTime={certificate.issuedAt}>
              {new Date(certificate.issuedAt).toLocaleDateString()}
            </time>
          </p>
        </div>

        <div className={styles.rowSide}>
          <Badge tone={status.tone}>{status.label}</Badge>
          <a
            className={styles.verifyLink}
            href={`/verify/${certificate.publicCode}`}
            target="_blank"
            rel="noreferrer noopener"
          >
            Open public page
            <span className={styles.visuallyHidden}>
              {" "}
              for {certificate.recipientName}, opens in a new tab
            </span>
          </a>
          {/*
            Already revoked is not revokable again — the endpoint filters on
            `status = 'valid'`, so a second attempt is a 404 rather than a
            second log entry. The screen agrees with it rather than finding out.
          */}
          {certificate.status === "valid" && (
            <Button variant="secondary" onClick={onToggle} aria-expanded={open}>
              {open ? "Cancel" : "Revoke"}
            </Button>
          )}
        </div>
      </div>

      {certificate.status === "revoked" && (
        <p className={styles.revoked}>
          Revoked
          {certificate.revokedAt && (
            <>
              {" "}
              <time dateTime={certificate.revokedAt}>
                {new Date(certificate.revokedAt).toLocaleDateString()}
              </time>
            </>
          )}
          {certificate.revokedReason ? ` — ${certificate.revokedReason}` : ""}
        </p>
      )}

      {open && (
        <div className={styles.revokeForm}>
          <label className={styles.label} htmlFor={`reason-${certificate.id}`}>
            Why is this being withdrawn? (required)
          </label>
          <textarea
            id={`reason-${certificate.id}`}
            className={styles.textarea}
            rows={2}
            value={reason}
            onChange={(event) => setReason(event.target.value)}
          />
          <p className={styles.hint}>
            The public verification page will show this certificate as revoked. It keeps its code,
            so anyone holding the link sees that it was withdrawn rather than a dead end.
          </p>
          <Button
            variant="destructive"
            disabled={!reason.trim() || revoke.isPending}
            onClick={() => revoke.mutate()}
          >
            {revoke.isPending ? "Revoking…" : "Revoke certificate"}
          </Button>

          {revoke.error && (
            <p role="alert" className={styles.error}>
              {revoke.error instanceof ApiError
                ? revoke.error.message
                : "That did not save. Try again in a moment."}
            </p>
          )}
        </div>
      )}
    </Card>
  );
}
