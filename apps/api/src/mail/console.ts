import type { Mailer, MailMessage } from "./index.js";

/** Pulls links out of the body so they are easy to spot and click in a terminal. */
function findLinks(text: string): string[] {
  return [...new Set(text.match(/https?:\/\/\S+/g) ?? [])];
}

/**
 * The development transport. Writes the message to the console instead of
 * sending it.
 *
 * This is what makes the whole of docs/database-schema.md §6.3 — hashed,
 * expiring, single-use tokens and the rate limiting around them — buildable and
 * testable with no provider account. Copy the link out of the terminal and the
 * flow runs exactly as it will in production.
 */
export function createConsoleMailer(): Mailer {
  return {
    name: "console",
    async send(message: MailMessage) {
      const links = findLinks(message.text);
      console.log(
        [
          "",
          "┌─ mail (not sent — console transport) ─────────────────────",
          `│ to:      ${message.to}`,
          `│ subject: ${message.subject}`,
          ...(links.length
            ? ["│", ...links.map((l) => `│ link:    ${l}`)]
            : []),
          "│",
          ...message.text.trimEnd().split("\n").map((line) => `│ ${line}`),
          "└───────────────────────────────────────────────────────────",
          "",
        ].join("\n"),
      );
    },
  };
}
