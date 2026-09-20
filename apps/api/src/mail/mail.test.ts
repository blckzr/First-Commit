import { afterEach, describe, expect, it, vi } from "vitest";
import {
  createBrevoMailer,
  createConsoleMailer,
  createMailer,
  passwordResetEmail,
  verificationEmail,
} from "./index.js";

afterEach(() => {
  vi.restoreAllMocks();
});

describe("createMailer", () => {
  it("uses the console transport when no Brevo key is set", () => {
    const mailer = createMailer({ brevoApiKey: null, mailFrom: null, mailFromName: "First Commit" });
    expect(mailer.name).toBe("console");
  });

  it("uses Brevo when a key and sender are set", () => {
    const mailer = createMailer({
      brevoApiKey: "key",
      mailFrom: "you@example.com",
      mailFromName: "First Commit",
    });
    expect(mailer.name).toBe("brevo");
  });

  /**
   * A half-configured provider should fail at boot, not at the first sign up —
   * by which point an account exists with no way to verify it.
   */
  it("refuses a Brevo key without a sender address", () => {
    expect(() =>
      createMailer({ brevoApiKey: "key", mailFrom: null, mailFromName: "First Commit" }),
    ).toThrow(/MAIL_FROM/);
  });
});

describe("console transport", () => {
  it("prints the link so it can be copied out of the terminal", async () => {
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    await createConsoleMailer().send(
      verificationEmail("learner@example.com", "http://localhost:5173/verify-email?token=abc123"),
    );

    const printed = log.mock.calls.map((c) => String(c[0])).join("\n");
    expect(printed).toContain("learner@example.com");
    expect(printed).toContain("http://localhost:5173/verify-email?token=abc123");
  });

  it("does not throw, so a dev environment never fails a request on mail", async () => {
    vi.spyOn(console, "log").mockImplementation(() => {});
    await expect(
      createConsoleMailer().send({ to: "a@b.c", subject: "s", text: "no links here" }),
    ).resolves.toBeUndefined();
  });
});

describe("brevo transport", () => {
  const mailer = createBrevoMailer({
    apiKey: "test-key",
    from: "sender@example.com",
    fromName: "First Commit",
  });

  it("posts the shape Brevo's transactional API expects", async () => {
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(new Response("", { status: 201 }));

    await mailer.send(verificationEmail("learner@example.com", "https://app.example/verify?t=1"));

    expect(fetchMock).toHaveBeenCalledOnce();
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("https://api.brevo.com/v3/smtp/email");

    const headers = init!.headers as Record<string, string>;
    expect(headers["api-key"]).toBe("test-key");

    const body = JSON.parse(init!.body as string);
    expect(body.sender).toEqual({ email: "sender@example.com", name: "First Commit" });
    expect(body.to).toEqual([{ email: "learner@example.com" }]);
    expect(body.subject).toBe("Confirm your email address");
    expect(body.textContent).toContain("https://app.example/verify?t=1");
    expect(body.htmlContent).toContain("https://app.example/verify?t=1");
  });

  it("throws with the status when Brevo rejects the request", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response('{"message":"sender not verified"}', { status: 400 }),
    );
    await expect(mailer.send({ to: "a@b.c", subject: "s", text: "t" })).rejects.toThrow(
      /400.*sender not verified/,
    );
  });

  it("throws a named error when the request itself fails", async () => {
    vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("network down"));
    await expect(mailer.send({ to: "a@b.c", subject: "s", text: "t" })).rejects.toThrow(
      /Brevo request failed: network down/,
    );
  });

  /**
   * Errors get logged, and logs get pasted into issues. Assert on the caught
   * message directly: `toThrow()` does not accept an asymmetric matcher, so
   * `expect.not.stringContaining(...)` there passes whatever the message says.
   */
  it("never puts the API key in an error", async () => {
    vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("boom"));

    const error = await mailer
      .send({ to: "a@b.c", subject: "s", text: "t" })
      .then(() => null)
      .catch((e: unknown) => e as Error);

    expect(error).toBeInstanceOf(Error);
    expect(error!.message).not.toContain("test-key");
    expect(error!.message).toContain("boom");
  });

  it("never puts the message body in an error", async () => {
    vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("boom"));

    const error = await mailer
      .send({ to: "a@b.c", subject: "s", text: "reset token 0a1b2c3d" })
      .then(() => null)
      .catch((e: unknown) => e as Error);

    expect(error!.message).not.toContain("0a1b2c3d");
  });
});

describe("templates", () => {
  const url = "https://app.example/verify-email?token=tok";

  it("carries the link in both the text and HTML bodies", () => {
    const mail = verificationEmail("a@b.c", url);
    expect(mail.text).toContain(url);
    expect(mail.html).toContain(url);
  });

  /** design.md §9: plain and specific, no cheerleading. */
  it("says the link is single-use and expiring", () => {
    for (const mail of [verificationEmail("a@b.c", url), passwordResetEmail("a@b.c", url)]) {
      expect(mail.text).toMatch(/works once/i);
      expect(mail.text).toMatch(/expires/i);
    }
  });

  it("avoids exclamation marks and apologetic filler", () => {
    for (const mail of [verificationEmail("a@b.c", url), passwordResetEmail("a@b.c", url)]) {
      expect(mail.text).not.toContain("!");
      expect(mail.text).not.toMatch(/oops|sorry/i);
    }
  });

  /**
   * §6.3: messages must not leak accounts. The reset mail is sent only to a
   * real address, but it still must not imply anything to a bystander, and it
   * must tell the reader that ignoring it is safe.
   */
  it("tells the reader that ignoring a reset is safe", () => {
    const mail = passwordResetEmail("a@b.c", url);
    expect(mail.text).toMatch(/ignore/i);
    expect(mail.text).toMatch(/password stays/i);
  });

  it("escapes a hostile URL rather than injecting it into the HTML", () => {
    const nasty = 'https://app.example/verify?t="><script>alert(1)</script>';
    const mail = verificationEmail("a@b.c", nasty);
    expect(mail.html).not.toContain("<script>");
    expect(mail.html).toContain("&lt;script&gt;");
  });
});
