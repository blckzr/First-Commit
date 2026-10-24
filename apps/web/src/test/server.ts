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
  /**
   * The session as the worker changes it underneath: the first read still says
   * the learner is mid-onboarding, every read after it says they are finished.
   * Refreshing the session is the only way to see the difference.
   */
  sessionFinishesOnboarding(user: SessionUser = LEARNER, step = "generating") {
    const calls = { n: 0 };
    server.use(
      http.get(`${BASE}/auth/me`, () => {
        calls.n += 1;
        return HttpResponse.json({ user, onboardingStep: calls.n === 1 ? step : null });
      }),
    );
    return calls;
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
    /** The Roadmap AI job's status, as `GET /onboarding` reports it. */
    generation?: "queued" | "running" | "completed" | "failed" | null;
    /** design.md §5.4 — the skills to rate and the checks behind them. */
    placement?: { skills: unknown[] };
    about?: {
      experienceLevel: string | null;
      goal: string | null;
      weeklyHours: number | null;
      workStyle?: string | null;
    } | null;
    careerPathId?: string | null;
  }) {
    server.use(
      http.get(`${BASE}/onboarding`, () =>
        HttpResponse.json({
          step: state.step,
          generation: state.generation ?? null,
          placement: state.placement ?? { skills: [] },
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
  /** `POST /onboarding/generating/retry`, counting the calls it receives. */
  onboardingRetry(status: "queued" | "failed" = "queued") {
    const calls = { n: 0 };
    server.use(
      http.post(`${BASE}/onboarding/generating/retry`, () => {
        calls.n += 1;
        return HttpResponse.json({ status });
      }),
    );
    return calls;
  },

  onboardingStepFails(path: "about" | "target" | "placement", status: number, error: string) {
    const url = `${BASE}/onboarding/${path}`;
    const handler = () => HttpResponse.json({ error }, { status });
    server.use(path === "placement" ? http.post(url, handler) : http.put(url, handler));
  },
  /** design.md §5.7 — the roadmap the chart reads. */
  /**
   * §5.14 — the capstone. `stage` is the API's answer, not the screen's.
   *
   * A `project` gets the fields every project has filled in, so a test that
   * only cares about the brief title does not have to restate a commit history
   * — and adding a field to the payload does not break every fixture at once.
   */
  capstone(state: Record<string, unknown>) {
    const project = state.project as Record<string, unknown> | null | undefined;
    server.use(
      http.get(`${BASE}/capstone`, () =>
        HttpResponse.json({
          stage: "locked",
          reason: null,
          technology: null,
          briefs: [],
          roadmapId: null,
          ...state,
          project: project ? { commits: [], githubReachable: true, ...project } : null,
        }),
      ),
    );
  },
  capstoneStartSucceeds(seen?: (body: unknown) => void, roadmapId = "r1") {
    server.use(
      http.post(`${BASE}/roadmaps/${roadmapId}/capstone`, async ({ request }) => {
        seen?.(await request.json());
        return HttpResponse.json({ projectId: "p1", stage: "connect" }, { status: 201 });
      }),
    );
  },
  /** §5.14 stage 2 — the learner's GitHub connection. */
  githubConnection(state: Record<string, unknown>) {
    server.use(
      http.get(`${BASE}/github/connection`, () =>
        HttpResponse.json({
          connected: false,
          configured: false,
          repositories: [],
          ...state,
        }),
      ),
    );
  },
  githubConnectUrl(url = "http://localhost:4000/github/callback?installation_id=1&code=dev&state=s") {
    server.use(http.get(`${BASE}/github/connect`, () => HttpResponse.json({ url, configured: false })));
  },
  capstoneRepositorySucceeds(seen?: (body: unknown) => void, roadmapId = "r1") {
    server.use(
      http.put(`${BASE}/roadmaps/${roadmapId}/capstone/repository`, async ({ request }) => {
        seen?.(await request.json());
        return HttpResponse.json({ stage: "build", repoFullName: "learner/task-tracker" });
      }),
    );
  },
  /** §5.14 stage 3 — the milestone tracker. */
  capstoneMilestones(
    milestones: Record<string, unknown>[],
    latestCommitSha: string | null = "a1b2c3d4e5",
    roadmapId = "r1",
  ) {
    server.use(
      http.get(`${BASE}/roadmaps/${roadmapId}/capstone/milestones`, () =>
        HttpResponse.json({
          milestones: milestones.map((m, i) => ({
            id: `m${i + 1}`,
            sortOrder: i,
            title: "A milestone",
            acceptanceCriteria: [],
            explanationQuestion: null,
            modules: [],
            status: "not-started",
            commitSha: null,
            checks: [],
            explanationAnswer: null,
            review: null,
            ...m,
          })),
          latestCommitSha,
        }),
      ),
    );
  },
  capstoneExplanationSucceeds(seen?: (body: unknown) => void, roadmapId = "r1") {
    server.use(
      http.put(`${BASE}/roadmaps/${roadmapId}/capstone/milestones/:milestoneId/explanation`, async ({ request }) => {
        seen?.(await request.json());
        return HttpResponse.json({ saved: true });
      }),
    );
  },
  capstoneDemoUrlSucceeds(seen?: (body: unknown) => void, roadmapId = "r1") {
    server.use(
      http.put(`${BASE}/roadmaps/${roadmapId}/capstone/demo-url`, async ({ request }) => {
        seen?.(await request.json());
        return HttpResponse.json({ demoUrl: "https://example.com" });
      }),
    );
  },
  capstoneRepositoryFails(status: number, error: string, roadmapId = "r1") {
    server.use(
      http.put(`${BASE}/roadmaps/${roadmapId}/capstone/repository`, () =>
        HttpResponse.json({ error }, { status }),
      ),
    );
  },
  capstoneStartFails(status: number, error: string, roadmapId = "r1") {
    server.use(
      http.post(`${BASE}/roadmaps/${roadmapId}/capstone`, () =>
        HttpResponse.json({ error }, { status }),
      ),
    );
  },
  roadmap(roadmap: unknown, id = "r1") {
    server.use(http.get(`${BASE}/roadmaps/${id}`, () => HttpResponse.json({ roadmap })));
  },
  /** §5.5 — PATCH /roadmaps/:id, the only thing a browser may change. */
  roadmapPatch(roadmap: unknown, seen?: (body: unknown) => void, id = "r1") {
    server.use(
      http.patch(`${BASE}/roadmaps/${id}`, async ({ request }) => {
        seen?.(await request.json());
        return HttpResponse.json({ roadmap });
      }),
    );
  },
  roadmapPatchFails(status: number, error: string, id = "r1") {
    server.use(
      http.patch(`${BASE}/roadmaps/${id}`, () => HttpResponse.json({ error }, { status })),
    );
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
