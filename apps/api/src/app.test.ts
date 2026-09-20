import { describe, expect, it, vi, beforeAll } from "vitest";
import request from "supertest";

/**
 * The API's test harness.
 *
 * AGENT.md §10: "Never add an endpoint without its ownership check and a test
 * for it." This establishes the pattern so the first real endpoint has
 * somewhere to go — import the app, drive it with supertest, no port bound.
 */

vi.mock("./db.js", () => ({
  pool: { end: vi.fn(), on: vi.fn(), query: vi.fn() },
  checkDb: vi.fn(async () => ({ ok: true, latencyMs: 1 })),
}));

let app: import("express").Express;

beforeAll(async () => {
  const { createApp } = await import("./app.js");
  app = createApp();
});

describe("health", () => {
  it("answers liveness without touching the database", async () => {
    const res = await request(app).get("/health");
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(typeof res.body.uptime).toBe("number");
  });

  it("reports readiness from the database check", async () => {
    const res = await request(app).get("/health/db");
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
  });

  it("returns 503 when the database is unreachable", async () => {
    const { checkDb } = await import("./db.js");
    vi.mocked(checkDb).mockResolvedValueOnce({
      ok: false,
      latencyMs: 12,
      error: "connection refused",
    });
    const res = await request(app).get("/health/db");
    expect(res.status).toBe(503);
    expect(res.body.error).toBe("connection refused");
  });
});

describe("defaults", () => {
  it("answers unknown routes with 404 JSON, not an HTML stack", async () => {
    const res = await request(app).get("/nope");
    expect(res.status).toBe(404);
    expect(res.body).toEqual({ error: "Not found" });
  });

  it("does not advertise the framework", async () => {
    const res = await request(app).get("/health");
    expect(res.headers["x-powered-by"]).toBeUndefined();
  });

  it("allows the app origin with credentials", async () => {
    const res = await request(app).get("/health").set("Origin", "http://localhost:5173");
    expect(res.headers["access-control-allow-origin"]).toBe("http://localhost:5173");
    expect(res.headers["access-control-allow-credentials"]).toBe("true");
  });

  /**
   * `cors` returns the *configured* origin rather than echoing the caller's,
   * so the header is present either way. The property that matters is that it
   * never equals a foreign origin: the browser compares the two and blocks the
   * read when they differ.
   */
  it("never returns a foreign origin as allowed", async () => {
    const res = await request(app).get("/health").set("Origin", "https://evil.example");
    expect(res.headers["access-control-allow-origin"]).not.toBe("https://evil.example");
    expect(res.headers["access-control-allow-origin"]).toBe("http://localhost:5173");
  });

  it("answers a credentialed preflight for the app origin only", async () => {
    const allowed = await request(app)
      .options("/health")
      .set("Origin", "http://localhost:5173")
      .set("Access-Control-Request-Method", "POST");
    expect(allowed.headers["access-control-allow-origin"]).toBe("http://localhost:5173");
    expect(allowed.headers["access-control-allow-credentials"]).toBe("true");

    const foreign = await request(app)
      .options("/health")
      .set("Origin", "https://evil.example")
      .set("Access-Control-Request-Method", "POST");
    expect(foreign.headers["access-control-allow-origin"]).not.toBe("https://evil.example");
  });
});
