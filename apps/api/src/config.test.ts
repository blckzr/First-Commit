import { afterEach, describe, expect, it } from "vitest";
import { secret } from "./config.js";

/**
 * `SESSION_SECRET` signs every session cookie. `required()` only asks whether
 * a value is non-empty, which let the instruction text from `.env.example` —
 * pasted rather than run — pass validation and sign real cookies for days.
 */
const NAME = "TEST_SECRET_UNDER_CHECK";
afterEach(() => {
  delete process.env[NAME];
});

const withValue = (value: string) => {
  process.env[NAME] = value;
  return () => secret(NAME);
};

describe("secret()", () => {
  it("accepts a generated value", () => {
    const generated = "9f2c1a".repeat(8);
    expect(withValue(generated)()).toBe(generated);
  });

  /** The exact string that was sitting in .env while the API served requests. */
  it("refuses the instruction from .env.example", () => {
    expect(withValue(`<node -e "console.log(crypto.randomBytes(32).toString('hex'))">`)).toThrow(
      /looks like the instruction/,
    );
  });

  it.each(["$(openssl rand -hex 32)", "YOUR_SECRET_HERE"])("refuses %s", (value) => {
    expect(withValue(value)).toThrow(/looks like the instruction/);
  });

  it("refuses a value too short to be a secret", () => {
    expect(withValue("hunter2")).toThrow(/at least 32/);
  });

  it("still refuses an empty value, as before", () => {
    expect(withValue("   ")).toThrow(/Missing environment variable/);
  });

  /** The message has to say what to do, not just what is wrong (§9). */
  it("says how to generate one", () => {
    expect(withValue("short")).toThrow(/crypto.randomBytes/);
  });
});
