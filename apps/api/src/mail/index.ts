import { createConsoleMailer } from "./console.js";
import { createBrevoMailer } from "./brevo.js";

/**
 * Transactional mail.
 *
 * The platform sends exactly two kinds of message — an email verification link
 * and a password reset link (docs/database-schema.md §6.3). Both are
 * single-use, expiring, and stored only as a hash, so the link in the message
 * is the only copy that exists.
 *
 * **Two implementations behind one interface.** In development nothing is sent
 * and the link is written to the console, which is enough to build and test all
 * of §6.3 without a provider account. In production it goes through Brevo,
 * chosen because it verifies a sender by email and needs no domain.
 *
 * Swapping provider later means writing one more transport and changing the
 * line in `createMailer` that picks between them.
 */

export interface MailMessage {
  to: string;
  subject: string;
  /** Always required: some clients refuse HTML, and it is what the console transport prints. */
  text: string;
  html?: string;
}

export interface Mailer {
  /** The transport's name, for logging and tests. */
  readonly name: string;
  /**
   * Sends a message, or throws.
   *
   * Callers decide what a failure means. For sign up it should **not** fail the
   * request — the account exists either way, and the learner can ask for
   * another link — so log it and carry on. For an explicit "resend" the caller
   * should surface it, since silence would look like success.
   */
  send(message: MailMessage): Promise<void>;
}

export interface MailerOptions {
  brevoApiKey: string | null;
  mailFrom: string | null;
  mailFromName: string;
}

export function createMailer(options: MailerOptions): Mailer {
  if (!options.brevoApiKey) {
    return createConsoleMailer();
  }

  if (!options.mailFrom) {
    // Failing at boot beats failing at the first sign up.
    throw new Error(
      "BREVO_API_KEY is set but MAIL_FROM is not. Set the verified sender address, " +
        "or unset BREVO_API_KEY to log mail to the console instead.",
    );
  }

  return createBrevoMailer({
    apiKey: options.brevoApiKey,
    from: options.mailFrom,
    fromName: options.mailFromName,
  });
}

export { createConsoleMailer, createBrevoMailer };
export { verificationEmail, passwordResetEmail } from "./templates.js";
