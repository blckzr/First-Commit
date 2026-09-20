import type { MailMessage } from "./index.js";

/**
 * The two messages the platform sends.
 *
 * design.md §9: the voice is a patient senior developer — plain, specific,
 * encouraging without cheerleading. No exclamation marks, no "Oops", and the
 * action says what happens.
 *
 * Both links are single-use and expire (docs/database-schema.md §6.3), so both
 * messages say so plainly rather than leaving the learner to discover it when
 * the link stops working.
 */

const WORDMARK = "First Commit";

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/**
 * A plain, table-free HTML body.
 *
 * Deliberately not styled with the design tokens: mail clients strip most CSS,
 * and a verification link that renders as unstyled text in Outlook is better
 * than one that renders as a broken layout. The tokens belong in the app.
 */
function wrap(heading: string, bodyLines: string[], action: { label: string; url: string }): string {
  const paragraphs = bodyLines
    .map((line) => `<p style="margin:0 0 16px">${escapeHtml(line)}</p>`)
    .join("\n      ");

  return `<!doctype html>
<html lang="en">
  <body style="margin:0;padding:24px;background:#f4f2f9;font-family:Helvetica,Arial,sans-serif;color:#14161d;line-height:1.55">
    <div style="max-width:520px;margin:0 auto;background:#ffffff;border-radius:12px;padding:32px">
      <p style="margin:0 0 24px;font-weight:700;font-size:16px">${WORDMARK}</p>
      <h1 style="margin:0 0 16px;font-size:22px;line-height:1.3">${escapeHtml(heading)}</h1>
      ${paragraphs}
      <p style="margin:24px 0">
        <a href="${escapeHtml(action.url)}"
           style="display:inline-block;padding:12px 22px;background:#14161d;color:#ffffff;text-decoration:none;border-radius:999px;font-weight:700">
          ${escapeHtml(action.label)}
        </a>
      </p>
      <p style="margin:0 0 8px;font-size:13px;color:#6b6878">
        If the button does not work, paste this into your browser:
      </p>
      <p style="margin:0;font-size:13px;word-break:break-all;color:#553aa6">${escapeHtml(action.url)}</p>
    </div>
  </body>
</html>`;
}

function plain(heading: string, bodyLines: string[], action: { label: string; url: string }): string {
  return [
    WORDMARK,
    "",
    heading,
    "",
    ...bodyLines,
    "",
    `${action.label}:`,
    action.url,
    "",
  ].join("\n");
}

export function verificationEmail(to: string, verifyUrl: string): MailMessage {
  const heading = "Confirm your email address";
  const body = [
    "You created a First Commit account. Confirming your email keeps it yours, and lets us reach you about your roadmap.",
    "This link works once and expires in an hour.",
    "If you did not create an account, you can ignore this message and nothing will happen.",
  ];
  return {
    to,
    subject: "Confirm your email address",
    text: plain(heading, body, { label: "Confirm your email", url: verifyUrl }),
    html: wrap(heading, body, { label: "Confirm your email", url: verifyUrl }),
  };
}

export function passwordResetEmail(to: string, resetUrl: string): MailMessage {
  const heading = "Set a new password";
  const body = [
    "Someone asked to reset the password for this First Commit account.",
    "This link works once and expires in an hour.",
    "If that was not you, ignore this message. Your password stays as it is, and nobody is told you received this.",
  ];
  return {
    to,
    subject: "Set a new First Commit password",
    text: plain(heading, body, { label: "Set a new password", url: resetUrl }),
    html: wrap(heading, body, { label: "Set a new password", url: resetUrl }),
  };
}
