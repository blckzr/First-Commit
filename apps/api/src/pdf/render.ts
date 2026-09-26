import PDFDocument from "pdfkit";

/**
 * PDF rendering for certificates (§5.15) and resumes (§5.16).
 *
 * **pdfkit, not a headless browser.** Puppeteer would let the PDF reuse the
 * screen's CSS, and it would also ship Chromium — on Render's free plan that is
 * most of the memory and a cold start measured in tens of seconds. pdfkit is
 * pure JavaScript and draws directly, which costs the layout twice but keeps
 * the API small enough to run where it runs.
 *
 * **The resume PDF is the ATS-friendly one** (§5.16: "single column, standard
 * headings, no tables, icons, or images"). That is a parsing requirement, not a
 * style: an applicant tracking system reads a resume by heading, and a two
 * column layout with icons is what makes one unreadable to it. So this renderer
 * has no columns, no graphics, and only the built-in fonts — a missing font is
 * the other common way a PDF comes out as unsearchable boxes.
 */

const PAGE = { size: "LETTER" as const, margin: 56 };
const INK = "#14161D";
const MUTED = "#5B5C6B";
const RULE = "#D9D9E0";

function collect(doc: PDFKit.PDFDocument): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    doc.on("data", (c: Buffer) => chunks.push(c));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);
    doc.end();
  });
}

export interface ResumePdf {
  fullName: string;
  contact: string[];
  links: { label: string; url: string }[];
  summary: string;
  skills: string[];
  certificates: { title: string; year: number }[];
  education: { school: string; degree: string; start: string; end: string }[];
  projects: { title: string; description: string; repo: string | null; demo: string | null }[];
}

export async function renderResumePdf(resume: ResumePdf): Promise<Buffer> {
  const doc = new PDFDocument({ ...PAGE, info: { Title: `${resume.fullName} — Resume` } });

  doc.fillColor(INK).font("Helvetica-Bold").fontSize(20).text(resume.fullName);

  const contact = resume.contact.filter(Boolean).join("  ·  ");
  if (contact) {
    doc.moveDown(0.3).font("Helvetica").fontSize(10).fillColor(MUTED).text(contact);
  }
  for (const link of resume.links) {
    doc.fillColor(MUTED).fontSize(10).text(`${link.label}: ${link.url}`);
  }

  /**
   * A plain heading and a rule. **No icons and no images** — §5.16 rules them
   * out because a parser cannot read them and a human does not need them.
   */
  const heading = (text: string) => {
    doc.moveDown(1).fillColor(INK).font("Helvetica-Bold").fontSize(11).text(text.toUpperCase());
    const y = doc.y + 2;
    doc
      .moveTo(doc.page.margins.left, y)
      .lineTo(doc.page.width - doc.page.margins.right, y)
      .strokeColor(RULE)
      .lineWidth(0.5)
      .stroke();
    doc.moveDown(0.6);
  };

  const body = (text: string) =>
    doc.fillColor(INK).font("Helvetica").fontSize(10).text(text, { lineGap: 2 });

  if (resume.summary) {
    heading("Summary");
    body(resume.summary);
  }

  if (resume.skills.length > 0) {
    heading("Skills");
    // One line, comma separated: what a parser expects under this heading.
    body(resume.skills.join(", "));
  }

  /** §7: no capstone means no Projects section, so an empty list draws nothing. */
  if (resume.projects.length > 0) {
    heading("Projects");
    for (const project of resume.projects) {
      doc.font("Helvetica-Bold").fontSize(10).fillColor(INK).text(project.title);
      body(project.description);
      const links = [project.repo, project.demo].filter(Boolean).join("  ·  ");
      if (links) doc.fillColor(MUTED).fontSize(9).text(links);
      doc.moveDown(0.4);
    }
  }

  if (resume.certificates.length > 0) {
    heading("Certifications");
    for (const certificate of resume.certificates) {
      body(`${certificate.title} — ${certificate.year}`);
    }
  }

  if (resume.education.length > 0) {
    heading("Education");
    for (const entry of resume.education) {
      const name = [entry.school, entry.degree].filter(Boolean).join(", ");
      const years = [entry.start, entry.end].filter(Boolean).join("–");
      body(years ? `${name} (${years})` : name);
    }
  }

  return collect(doc);
}

export interface CertificatePdf {
  recipientName: string;
  title: string;
  type: "completion" | "project";
  publicCode: string;
  issuedAt: Date;
  skills: string[];
  verifyUrl: string;
}

/**
 * The certificate (§5.15).
 *
 * Landscape and centred, because it is a document somebody prints or attaches
 * rather than one a machine parses. **It carries its verification URL and code
 * in text**: a certificate that cannot be checked is decoration, and the whole
 * claim of §5.15 is that anybody can check it without an account.
 */
export async function renderCertificatePdf(certificate: CertificatePdf): Promise<Buffer> {
  const doc = new PDFDocument({
    size: "LETTER",
    layout: "landscape",
    margin: 64,
    info: { Title: `${certificate.recipientName} — ${certificate.title}` },
  });

  const width = doc.page.width - doc.page.margins.left - doc.page.margins.right;
  const centre = { width, align: "center" as const };

  doc
    .fillColor(MUTED)
    .font("Helvetica-Bold")
    .fontSize(11)
    .text("FIRST COMMIT", centre);

  doc.moveDown(1.6);
  doc
    .fillColor(INK)
    .font("Helvetica")
    .fontSize(14)
    .text(
      certificate.type === "completion" ? "Certificate of Completion" : "Project Certificate",
      centre,
    );

  doc.moveDown(0.8);
  doc.font("Helvetica-Bold").fontSize(30).text(certificate.recipientName, centre);

  doc.moveDown(0.8);
  doc.font("Helvetica").fontSize(14).fillColor(INK).text(certificate.title, centre);

  if (certificate.skills.length > 0) {
    doc.moveDown(1.2);
    doc
      .fontSize(10)
      .fillColor(MUTED)
      .text(`Skills verified: ${certificate.skills.join(", ")}`, centre);
  }

  doc.moveDown(1.6);
  doc
    .fontSize(10)
    .fillColor(MUTED)
    .text(
      `Issued ${certificate.issuedAt.toLocaleDateString("en-US", {
        year: "numeric",
        month: "long",
        day: "numeric",
      })}   ·   ID ${certificate.publicCode}`,
      centre,
    );

  doc.moveDown(0.4);
  doc.fontSize(9).text(`Verify at ${certificate.verifyUrl}`, centre);

  return collect(doc);
}
