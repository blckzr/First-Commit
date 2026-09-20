import request from "supertest";
import type { Express } from "express";
import { config } from "../config.js";

/**
 * Request helpers that behave like a browser.
 *
 * `requireSameOrigin` refuses a state-changing request with no `Origin`, which
 * is what stops a cross-site form post. Supertest sends none by default, so
 * tests must set it — otherwise every POST test would be asserting against a
 * 403 from the CSRF guard rather than against the handler.
 *
 * Use `postFrom` to test the guard itself with a different origin.
 */
export function post(app: Express, path: string) {
  return request(app).post(path).set("Origin", config.appOrigin);
}

export function postFrom(app: Express, path: string, origin: string | null) {
  const req = request(app).post(path);
  return origin === null ? req : req.set("Origin", origin);
}

export function get(app: Express, path: string) {
  return request(app).get(path).set("Origin", config.appOrigin);
}
