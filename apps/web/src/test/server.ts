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
  /** design.md §5.7 — the roadmap the chart reads. */
  roadmap(roadmap: unknown, id = "r1") {
    server.use(http.get(`${BASE}/roadmaps/${id}`, () => HttpResponse.json({ roadmap })));
  },
  roadmapFails(status: number, error = "Not found", id = "r1") {
    server.use(http.get(`${BASE}/roadmaps/${id}`, () => HttpResponse.json({ error }, { status })));
  },
  roadmapList(roadmaps: unknown[]) {
    server.use(http.get(`${BASE}/roadmaps`, () => HttpResponse.json({ roadmaps })));
  },
  /** design.md §5.9, §5.10 — the module page and the quiz. */
  /**
   * `id` is what the URL asks for; the start handler follows the module's own
   * `moduleId`, which is what the screen actually posts to.
   */
  module(module: { moduleId?: string } | unknown, id = "m1") {
    const moduleId = (module as { moduleId?: string }).moduleId ?? id;
    server.use(http.get(`${BASE}/modules/${id}`, () => HttpResponse.json({ module })));
    server.use(
      http.post(`${BASE}/modules/${moduleId}/start`, () => HttpResponse.json({ started: true })),
    );
  },
  moduleFails(status: number, error = "Not found", id = "m1") {
    server.use(http.get(`${BASE}/modules/${id}`, () => HttpResponse.json({ error }, { status })));
  },
  lessonCompletes(seen?: (lessonId: string) => void) {
    server.use(
      http.post(`${BASE}/lessons/:lessonId/complete`, ({ params }) => {
        seen?.(params.lessonId as string);
        return HttpResponse.json({ completed: true });
      }),
    );
  },
  quiz(assessment: unknown, id = "a1") {
    server.use(http.get(`${BASE}/assessments/${id}`, () => HttpResponse.json({ assessment })));
  },
  quizFails(status: number, error = "Not found", id = "a1") {
    server.use(http.get(`${BASE}/assessments/${id}`, () => HttpResponse.json({ error }, { status })));
  },
  /** Records the submitted body, so a test can prove what the browser sent. */
  quizGrades(result: unknown, seen?: (body: unknown) => void, id = "a1") {
    server.use(
      http.post(`${BASE}/assessments/${id}/attempts`, async ({ request }) => {
        seen?.(await request.json());
        return HttpResponse.json({ result });
      }),
    );
  },
  quizGradeFails(status: number, error: string, id = "a1") {
    server.use(
      http.post(`${BASE}/assessments/${id}/attempts`, () =>
        HttpResponse.json({ error }, { status }),
      ),
    );
  },
  /** design.md §5.6 — what Home shows. */
  home(home: unknown) {
    server.use(http.get(`${BASE}/home`, () => HttpResponse.json({ home })));
  },
  homeFails(status: number, error = "Something went wrong.") {
    server.use(http.get(`${BASE}/home`, () => HttpResponse.json({ error }, { status })));
  },
  /** design.md §5.8 — the technology decision. */
  decision(decision: unknown, roadmapId = "r1", decisionId = "d1") {
    server.use(
      http.get(`${BASE}/roadmaps/${roadmapId}/decisions/${decisionId}`, () =>
        HttpResponse.json({ decision }),
      ),
    );
  },
  decisionFails(status: number, error = "Not found", roadmapId = "r1", decisionId = "d1") {
    server.use(
      http.get(`${BASE}/roadmaps/${roadmapId}/decisions/${decisionId}`, () =>
        HttpResponse.json({ error }, { status }),
      ),
    );
  },
  /** Records the body, so a test can prove the browser sends only the option. */
  choiceSucceeds(
    result: unknown,
    seen?: (body: unknown) => void,
    roadmapId = "r1",
    decisionId = "d1",
  ) {
    server.use(
      http.post(`${BASE}/roadmaps/${roadmapId}/decisions/${decisionId}`, async ({ request }) => {
        seen?.(await request.json());
        return HttpResponse.json({ result });
      }),
    );
  },
  choiceFails(status: number, error: string, roadmapId = "r1", decisionId = "d1") {
    server.use(
      http.post(`${BASE}/roadmaps/${roadmapId}/decisions/${decisionId}`, () =>
        HttpResponse.json({ error }, { status }),
      ),
    );
  },
  unreachable(path: string) {
    server.use(http.post(`${BASE}${path}`, () => HttpResponse.error()));
  },
};
