import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Badge } from "../../components/core/Badge";
import { Button } from "../../components/core/Button";
import { Card } from "../../components/core/Card";
import { Checkbox } from "../../components/forms/Checkbox";
import { Icon } from "../../components/core/Icon";
import { LinkButton } from "../../components/core/LinkButton";
import { ApiError } from "../../api/client";
import { resumeApi, type Content, type Evidence, type ResumePage } from "../../api/resume";
import { downloadPdf } from "../../api/download";
import { ResumeDetailsForm } from "../../features/resume/ResumeDetailsForm";
import styles from "./Resume.module.css";

/**
 * design.md §5.16 — the resume.
 *
 * **The evidence panel is the honest part.** §5.16: it "lists only verified
 * items; learners choose which to include but cannot add unverified skills."
 * There is no control here that adds a skill, and there is no free-text
 * experience field — a resume is the one thing this platform produces that a
 * stranger reads and acts on, so the absences are the design.
 *
 * §7 states the rule twice: unsupported skills are removed, and **module
 * completion is a skill, never experience**. The API grounds what the model
 * returns; this screen never gets the chance to un-ground it.
 */
export function Resume() {
  const client = useQueryClient();
  const { data, isPending, error } = useQuery({
    queryKey: ["resume"],
    queryFn: ({ signal }) => resumeApi.get(signal),
    /** Poll only while the model is working, so the preview fills in by itself. */
    refetchInterval: (q) =>
      q.state.data?.resume.status === "queued" || q.state.data?.resume.status === "running"
        ? 2000
        : false,
  });

  const refresh = () => client.invalidateQueries({ queryKey: ["resume"] });

  if (isPending) {
    return (
      <p role="status" aria-live="polite" className={styles.loading}>
        Loading your resume…
      </p>
    );
  }

  if (error || !data) {
    return (
      <Card surface="white" radius="panel" padding="lg" className={styles.empty}>
        <h1 className={styles.title}>Your resume isn&apos;t available right now</h1>
        <p className={styles.lede}>
          {error instanceof ApiError
            ? error.message
            : "This is usually temporary. Nothing you earned is lost — try again in a moment."}
        </p>
      </Card>
    );
  }

  return <ResumeView page={data} onChanged={refresh} />;
}

function ResumeView({ page, onChanged }: { page: ResumePage; onChanged: () => void }) {
  const { evidence, details } = page;
  const nothingVerified = evidence.skills.length === 0;

  const [selection, setSelection] = useState({
    skillIds: page.resume.selected.skillIds,
    certificateCodes: page.resume.selected.certificateCodes,
  });

  /** Nothing chosen yet means everything, which is what a first resume wants. */
  const chosenSkills =
    selection.skillIds.length > 0 ? selection.skillIds : evidence.skills.map((s) => s.skillId);
  const chosenCertificates =
    selection.certificateCodes.length > 0
      ? selection.certificateCodes
      : evidence.certificates.map((c) => c.publicCode);

  const save = useMutation({
    mutationFn: resumeApi.setSelection,
    onSuccess: onChanged,
  });

  const generate = useMutation({
    mutationFn: resumeApi.generate,
    onSuccess: onChanged,
  });

  function toggle(kind: "skillIds" | "certificateCodes", id: string) {
    const current = kind === "skillIds" ? chosenSkills : chosenCertificates;
    const next = current.includes(id) ? current.filter((x) => x !== id) : [...current, id];
    const updated = { ...selection, [kind]: next };
    setSelection(updated);
    save.mutate(updated);
  }

  const working = page.resume.status === "queued" || page.resume.status === "running";
  const [downloadError, setDownloadError] = useState<string | null>(null);

  return (
    <div className={styles.page}>
      <Card surface="white" radius="panel" padding="lg" className={styles.header}>
        <h1 className={styles.title}>Resume</h1>
        <p className={styles.lede}>
          Built from what you have proved. Everything here is checked against your passed
          assessments — nothing else can be added.
        </p>
      </Card>

      {nothingVerified ? (
        /* §5.16's empty state, word for word. */
        <Card surface="white" radius="panel" padding="lg" className={styles.empty}>
          <h2 className={styles.emptyTitle}>
            Pass your first module assessment to add a verified skill to your resume.
          </h2>
          <LinkButton to="/app/roadmaps" icon="arrow-right">
            View roadmap
          </LinkButton>
        </Card>
      ) : (
        <div className={styles.split}>
          {/* ---- Evidence ------------------------------------------------ */}
          <Card surface="white" radius="panel" padding="lg" className={styles.evidence}>
            <h2 className={styles.paneTitle}>Evidence</h2>

            <fieldset className={styles.group}>
              <legend className={styles.legend}>Verified skills</legend>
              <ul className={styles.list}>
                {evidence.skills.map((skill) => (
                  <li key={skill.skillId}>
                    <Checkbox
                      checked={chosenSkills.includes(skill.skillId)}
                      onChange={() => toggle("skillIds", skill.skillId)}
                      label={skill.name}
                    />
                    {/* §8: status is icon + text + colour. */}
                    <Badge tone="verified" icon="check">
                      {skill.method === "tested_out" ? "Tested out" : "Passed"}
                    </Badge>
                  </li>
                ))}
              </ul>
            </fieldset>

            {evidence.certificates.length > 0 && (
              <fieldset className={styles.group}>
                <legend className={styles.legend}>Certifications</legend>
                <ul className={styles.list}>
                  {evidence.certificates.map((certificate) => (
                    <li key={certificate.publicCode}>
                      <Checkbox
                        checked={chosenCertificates.includes(certificate.publicCode)}
                        onChange={() => toggle("certificateCodes", certificate.publicCode)}
                        label={certificate.title}
                      />
                    </li>
                  ))}
                </ul>
              </fieldset>
            )}

            <section className={styles.group}>
              <h3 className={styles.legend}>Projects</h3>
              {evidence.projects.length === 0 ? (
                /*
                 * §7: "No capstone means no Projects section." Said plainly
                 * rather than hidden, so the absence reads as a next step
                 * rather than as something missing.
                 */
                <p className={styles.muted}>
                  Build your capstone project to add it here. Capstones aren&apos;t built yet.
                </p>
              ) : (
                <ul className={styles.list}>
                  {evidence.projects.map((project) => (
                    <li key={project.id}>{project.title}</li>
                  ))}
                </ul>
              )}
            </section>

            <section className={styles.group}>
              <h3 className={styles.legend}>Personal details</h3>
              <ResumeDetailsForm details={details} onSaved={onChanged} />
            </section>
          </Card>

          {/* ---- Preview -------------------------------------------------- */}
          <Card surface="white" radius="panel" padding="lg" className={styles.preview}>
            <h2 className={styles.paneTitle}>Preview</h2>
            <Preview
              page={page}
              evidence={evidence}
              chosenSkills={chosenSkills}
              chosenCertificates={chosenCertificates}
              onChanged={onChanged}
            />
          </Card>
        </div>
      )}

      {!nothingVerified && (
        <Card surface="white" radius="panel" padding="lg" className={styles.actions}>
          <div className={styles.actionText}>
            {generate.isError && (
              <p role="alert" className={styles.error}>
                {generate.error instanceof ApiError
                  ? generate.error.message
                  : "That didn't start. Try again in a moment."}
              </p>
            )}
            {working && (
              <p role="status" aria-live="polite" className={styles.muted}>
                Writing your summary…
              </p>
            )}
            {downloadError && (
              <p role="alert" className={styles.error}>
                {downloadError}
              </p>
            )}
          </div>
          <div className={styles.actionButtons}>
            <Button onClick={() => generate.mutate()} disabled={working || generate.isPending}>
              {page.resume.generatedAt ? "Generate again" : "Generate resume"}
            </Button>
            {/*
              §5.16's "Download PDF". The file is built from the evidence at the
              moment it is asked for, so it can never claim something the learner
              no longer has — only the prose comes from what was generated.
            */}
            <Button
              variant="secondary"
              onClick={() =>
                downloadPdf("/resume.pdf", "resume.pdf").catch((e: Error) =>
                  setDownloadError(e.message),
                )
              }
            >
              Download PDF
            </Button>
          </div>
        </Card>
      )}
    </div>
  );
}

/**
 * The ATS-friendly preview (§5.16): "single column, standard headings, no
 * tables, icons, or images."
 *
 * That is a real constraint rather than a style: an applicant tracking system
 * parses this by heading, and a two-column layout with icons is what makes a
 * resume unreadable to one. So the preview is a plain document, and the
 * screen's own chrome stays outside it.
 */
function Preview({
  page,
  evidence,
  chosenSkills,
  chosenCertificates,
  onChanged,
}: {
  page: ResumePage;
  evidence: Evidence;
  chosenSkills: string[];
  chosenCertificates: string[];
  onChanged: () => void;
}) {
  const { details } = page;
  const content: Content | null = page.resume.content;

  /**
   * The skills shown are the chosen evidence, not whatever the model returned.
   * The model orders and phrases; it never decides membership.
   */
  const skills = evidence.skills
    .filter((s) => chosenSkills.includes(s.skillId))
    .map((s) => s.name);
  const ordered = content?.skills?.length
    ? [...skills].sort((a, b) => content.skills.indexOf(a) - content.skills.indexOf(b))
    : skills;

  const certificates = evidence.certificates.filter((c) =>
    chosenCertificates.includes(c.publicCode),
  );

  const contact = [details.email, details.phone, details.city].filter(Boolean).join(" · ");

  return (
    <article className={styles.document}>
      <h3 className={styles.docName}>{details.fullName}</h3>
      {contact && <p className={styles.docContact}>{contact}</p>}
      {details.links.length > 0 && (
        <p className={styles.docContact}>
          {details.links.map((l) => `${l.label}: ${l.url}`).join(" · ")}
        </p>
      )}

      <SummarySection page={page} onChanged={onChanged} />

      {ordered.length > 0 && (
        <section>
          <h4 className={styles.docHeading}>Skills</h4>
          <p className={styles.docText}>{ordered.join(", ")}</p>
        </section>
      )}

      {certificates.length > 0 && (
        <section>
          <h4 className={styles.docHeading}>Certifications</h4>
          <ul className={styles.docList}>
            {certificates.map((c) => (
              <li key={c.publicCode}>
                {c.title} — {new Date(c.issuedAt).getFullYear()}
              </li>
            ))}
          </ul>
        </section>
      )}

      {details.education.length > 0 && (
        <section>
          <h4 className={styles.docHeading}>Education</h4>
          <ul className={styles.docList}>
            {details.education.map((e, i) => (
              <li key={i}>
                {[e.school, e.degree].filter(Boolean).join(", ")}
                {e.start || e.end ? ` (${[e.start, e.end].filter(Boolean).join("–")})` : ""}
              </li>
            ))}
          </ul>
        </section>
      )}
    </article>
  );
}

/** §5.16: "AI-written summary and project descriptions are labeled and editable." */
function SummarySection({ page, onChanged }: { page: ResumePage; onChanged: () => void }) {
  const summary = page.resume.content?.summary ?? "";
  const isAi = page.resume.aiFields.includes("summary");
  const [editing, setEditing] = useState(false);

  const save = useMutation({
    mutationFn: (text: string) => resumeApi.edit({ summary: text }),
    onSuccess: () => {
      setEditing(false);
      onChanged();
    },
  });

  if (!summary && !editing) {
    return (
      <section>
        <h4 className={styles.docHeading}>Summary</h4>
        <p className={styles.muted}>
          Generate your resume to write a summary from your verified skills.
        </p>
      </section>
    );
  }

  return (
    <section>
      <h4 className={styles.docHeading}>
        Summary
        {isAi && (
          <span className={styles.aiTag}>
            AI
            <span className={styles.hiddenText}>, written by AI and editable</span>
          </span>
        )}
      </h4>

      {editing ? (
        /*
         * Keyed on the summary so a freshly generated one replaces the draft by
         * remounting. An effect calling `setDraft` would be a cascading render,
         * and React's own advice is to key the component instead.
         */
        <SummaryEditor
          key={summary}
          initial={summary}
          saving={save.isPending}
          onSave={(text) => save.mutate(text)}
          onCancel={() => setEditing(false)}
        />
      ) : (
        <>
          <p className={styles.docText}>{summary}</p>
          <Button size="sm" variant="ghost" onClick={() => setEditing(true)}>
            <Icon name="wrench" size={14} aria-hidden /> Edit summary
          </Button>
        </>
      )}
    </section>
  );
}

/** The summary editor. Its draft lives here so the parent can key it. */
function SummaryEditor({
  initial,
  saving,
  onSave,
  onCancel,
}: {
  initial: string;
  saving: boolean;
  onSave: (text: string) => void;
  onCancel: () => void;
}) {
  const [draft, setDraft] = useState(initial);

  return (
    <div className={styles.editor}>
      <label className={styles.hiddenText} htmlFor="summary-edit">
        Summary
      </label>
      <textarea
        id="summary-edit"
        className={styles.textarea}
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        rows={4}
        maxLength={2000}
      />
      <div className={styles.editorActions}>
        <Button size="sm" onClick={() => onSave(draft)} disabled={saving}>
          Save summary
        </Button>
        <Button size="sm" variant="ghost" onClick={onCancel}>
          Cancel
        </Button>
      </div>
    </div>
  );
}
