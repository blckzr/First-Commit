import { setupServer } from "msw/node";
import { http, HttpResponse } from "msw";
import type { SessionUser } from "../api/auth";

/**
 * A stand-in for the API, so web tests need no database and no running server.
 *
 * Shapes here must match what `apps/api` actually returns. They are asserted
 * against the same Zod schemas the app uses, so a drift shows up as a parse
 * failure rather than as a component quietly rendering undefined — but nothing
 * here proves the API agrees. That is what the API's own tests are for, and
 * ultimately a run against a real database.
 */

const BASE = "http://localhost:4000";

export const LEARNER: SessionUser = {
  id: "11111111-1111-1111-1111-111111111111",
  fullName: "Jan Kevin Gerona",
  email: "learner@example.com",
  role: "learner",
  emailVerified: false,
};

export const ADMIN: SessionUser = {
  ...LEARNER,
  id: "22222222-2222-2222-2222-222222222222",
  role: "admin",
};

/** Signed out by default: a visitor with no cookie is the common case. */
export const handlers = [
  http.get(`${BASE}/auth/me`, () =>
    HttpResponse.json({ error: "You need to be signed in to do that." }, { status: 401 }),
  ),
];

export const server = setupServer(...handlers);

/** Shortcuts for the states a test wants to put the API in. */
export const api = {
  signedIn(user: SessionUser = LEARNER, onboardingStep: string | null = null) {
    server.use(
      http.get(`${BASE}/auth/me`, () => HttpResponse.json({ user, onboardingStep })),
    );
  },
  signedOut() {
    server.use(
      http.get(`${BASE}/auth/me`, () =>
        HttpResponse.json({ error: "You need to be signed in to do that." }, { status: 401 }),
      ),
    );
  },
  signUpSucceeds(next = "/onboarding/about", user: SessionUser = LEARNER) {
    server.use(
      http.post(`${BASE}/auth/signup`, () => HttpResponse.json({ user, next }, { status: 201 })),
    );
  },
  signUpFails(status: number, error: string) {
    server.use(http.post(`${BASE}/auth/signup`, () => HttpResponse.json({ error }, { status })));
  },
  logInSucceeds(next = "/app", user: SessionUser = LEARNER) {
    server.use(http.post(`${BASE}/auth/login`, () => HttpResponse.json({ user, next })));
  },
  logInFails(status = 401, error = "Email or password is incorrect.") {
    server.use(http.post(`${BASE}/auth/login`, () => HttpResponse.json({ error }, { status })));
  },
  forgotSucceeds(message = "If that email has an account, a reset link is on its way.") {
    server.use(
      http.post(`${BASE}/auth/password/forgot`, () => HttpResponse.json({ message })),
    );
  },
  forgotFails(status: number, error: string) {
    server.use(
      http.post(`${BASE}/auth/password/forgot`, () => HttpResponse.json({ error }, { status })),
    );
  },
  resetSucceeds(next = "/login") {
    server.use(
      http.post(`${BASE}/auth/password/reset`, () => HttpResponse.json({ reset: true, next })),
    );
  },
  resetFails(status = 400, error = "That link has expired or has already been used. Ask for a new one.") {
    server.use(
      http.post(`${BASE}/auth/password/reset`, () => HttpResponse.json({ error }, { status })),
    );
  },
  /** design.md §5.4 — the onboarding state the four screens read and write. */
  onboarding(state: {
    step: string;
    about?: { experienceLevel: string | null; goal: string | null; weeklyHours: number | null } | null;
    careerPathId?: string | null;
  }) {
    server.use(
      http.get(`${BASE}/onboarding`, () =>
        HttpResponse.json({
          step: state.step,
          about: state.about ?? null,
          careerPathId: state.careerPathId ?? null,
        }),
      ),
    );
  },
  careerPaths(careerPaths: { id: string; slug: string; title: string; description: string }[]) {
    server.use(http.get(`${BASE}/career-paths`, () => HttpResponse.json({ careerPaths })));
  },
  /** Records what the screen sent, so a test can assert on the request body. */
  onboardingStepSucceeds(
    path: "about" | "target" | "placement",
    next: string,
    seen?: (body: unknown) => void,
  ) {
    const url = `${BASE}/onboarding/${path}`;
    const handler = async ({ request }: { request: Request }) => {
      seen?.(await request.json());
      return HttpResponse.json({ step: path, next });
    };
    server.use(path === "placement" ? http.post(url, handler) : http.put(url, handler));
  },
  onboardingStepFails(path: "about" | "target" | "placement", status: number, error: string) {
    const url = `${BASE}/onboarding/${path}`;
    const handler = () => HttpResponse.json({ error }, { status });
    server.use(path === "placement" ? http.post(url, handler) : http.put(url, handler));
  },
  unreachable(path: string) {
    server.use(http.post(`${BASE}${path}`, () => HttpResponse.error()));
  },
};
