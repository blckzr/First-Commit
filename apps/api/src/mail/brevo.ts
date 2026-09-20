import type { Mailer, MailMessage } from "./index.js";

const BREVO_ENDPOINT = "https://api.brevo.com/v3/smtp/email";
const TIMEOUT_MS = 15_000;

export interface BrevoOptions {
  apiKey: string;
  /** A sender address verified in Brevo. A personal address works; no domain is needed. */
  from: string;
  fromName: string;
}

/**
 * The production transport.
 *
 * Brevo's free plan sends 300 a day and verifies a sender by clicking a link in
 * that inbox, so it needs no domain — which is why it was chosen over Resend,
 * whose domainless sandbox only delivers to the account owner.
 *
 * The trade is deliverability: without a domain there is no SPF or DKIM
 * alignment, so mail often lands in spam. Verifying a domain in Brevo later
 * fixes that without changing this file.
 */
export function createBrevoMailer(options: BrevoOptions): Mailer {
  return {
    name: "brevo",
    async send(message: MailMessage) {
      let response: Response;
      try {
        response = await fetch(BREVO_ENDPOINT, {
          method: "POST",
          headers: {
            "api-key": options.apiKey,
            "content-type": "application/json",
            accept: "application/json",
          },
          body: JSON.stringify({
            sender: { email: options.from, name: options.fromName },
            to: [{ email: message.to }],
            subject: message.subject,
            textContent: message.text,
            ...(message.html ? { htmlContent: message.html } : {}),
          }),
          signal: AbortSignal.timeout(TIMEOUT_MS),
        });
      } catch (err) {
        // Never include the message body or the API key in an error.
        throw new Error(`Brevo request failed: ${(err as Error).message}`);
      }

      if (!response.ok) {
        const detail = await response.text().catch(() => "");
        throw new Error(
          `Brevo replied ${response.status}${detail ? `: ${detail.slice(0, 300)}` : ""}`,
        );
      }
    },
  };
}
