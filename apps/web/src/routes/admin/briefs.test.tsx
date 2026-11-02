import { beforeEach, describe, expect, it } from "vitest";
import { http, HttpResponse } from "msw";
import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { render } from "../../test/render";
import { server } from "../../test/server";
import { expectNoAxeViolations } from "../../test/axe";
import { Briefs } from "./Briefs";

const BASE = "http://localhost:4000";
const BRIEF = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const V1 = "11111111-1111-4111-8111-111111111111";
const V2 = "22222222-2222-4222-8222-222222222222";

/**
 * design.md §6.5 — the capstone brief editor.
 *
 * The assertion that matters is §6.5's gate: **a brief cannot be published for
 * a technology option without a starter template**, because a learner who picks
 * it could not start the project at all. The screen names the missing ones
 * before Publish rather than letting an author find out from a refusal.
 */

const version = (over: Record<string, unknown> = {}) => ({
  id: V1,
  versionNo: 1,
  title: "Task tracker",
  description: "Build a task tracker.",
  goals: "",
  estimatedWeeks: 3,
  status: "published",
  publishedAt: "2026-10-01T00:00:00Z",
  milestones: [
    {
      id: "m1",
      title: "Set up repository",
      acceptanceCriteria: ["A README exists"],
      reviewChecklist: ["Is the history readable?"],
      explanationQuestion: null,
      checks: [{ type: "file_exists", name: "README exists", path: "README.md" }],
    },
  ],
  templates: [
    { technologyId: "react", technology: "React", repoFullName: "first-commit/task-tracker-react" },
    { technologyId: "vue", technology: "Vue", repoFullName: "first-commit/task-tracker-vue" },
  ],
  missingTemplates: [],
  ...over,
});

function brief(versions: Record<string, unknown>[]) {
  server.use(
    http.get(`${BASE}/admin/briefs`, () =>
      HttpResponse.json({
        briefs: [
          {
            id: BRIEF,
            slug: "task-tracker",
            status: "published",
            trackTitle: "Frontend",
            published: { id: V1, versionNo: 1, title: "Task tracker" },
            draft: null,
          },
        ],
      }),
    ),
    http.get(`${BASE}/admin/briefs/${BRIEF}`, () =>
      HttpResponse.json({
        brief: { id: BRIEF, slug: "task-tracker", status: "published", track_id: "t1" },
        technologies: [
          { id: "react", name: "React" },
          { id: "vue", name: "Vue" },
        ],
        versions,
      }),
    ),
  );
}

const at = { route: "/admin/briefs" };

beforeEach(() => brief([version()]));

describe("the starter template gate", () => {
  /** §6.5: a learner who picks Vue and finds no template cannot start at all. */
  it("names the technology with no template", async () => {
    brief([version({ missingTemplates: ["Vue"] })]);
    render(<Briefs />, at);

    expect(await screen.findByText(/cannot be published yet/i)).toBeInTheDocument();
    expect(screen.getByText("Vue")).toBeInTheDocument();
    expect(screen.getByText(/could not start the project/i)).toBeInTheDocument();
  });

  it("shows no gate when every option has one", async () => {
    render(<Briefs />, at);

    await screen.findByText("Task tracker");
    expect(screen.queryByText(/cannot be published yet/i)).not.toBeInTheDocument();
  });

  /** The button is not offered, so the refusal is not something to discover. */
  it("will not offer publish while a template is missing", async () => {
    brief([
      version(),
      version({ id: V2, versionNo: 2, status: "draft", publishedAt: null, missingTemplates: ["Vue"] }),
    ]);
    render(<Briefs />, at);

    expect(await screen.findByRole("button", { name: /publish version 2/i })).toBeDisabled();
  });

  it("offers publish once nothing is missing", async () => {
    brief([
      version(),
      version({ id: V2, versionNo: 2, status: "draft", publishedAt: null }),
    ]);
    render(<Briefs />, at);

    expect(await screen.findByRole("button", { name: /publish version 2/i })).toBeEnabled();
  });
});

describe("with no draft", () => {
  it("says learners keep the version they started", async () => {
    render(<Briefs />, at);

    expect(
      await screen.findByText(/they keep the version they started until you publish/i),
    ).toBeInTheDocument();
  });

  it("starts a draft", async () => {
    let asked = false;
    server.use(
      http.post(`${BASE}/admin/briefs/${BRIEF}/versions`, () => {
        asked = true;
        return HttpResponse.json({ versionId: V2, reused: false }, { status: 201 });
      }),
    );
    render(<Briefs />, at);

    await userEvent.click(await screen.findByRole("button", { name: /start a draft/i }));

    await waitFor(() => expect(asked).toBe(true));
  });

  /** A published brief is what learners are building. */
  it("does not offer milestone editing", async () => {
    render(<Briefs />, at);

    await screen.findByText("Task tracker");
    expect(screen.queryByRole("button", { name: /save milestones/i })).not.toBeInTheDocument();
  });
});

describe("editing a draft", () => {
  beforeEach(() => {
    brief([
      version(),
      version({ id: V2, versionNo: 2, status: "draft", publishedAt: null }),
    ]);
  });

  it("saves the milestones", async () => {
    let sent: { milestones: { title: string }[] } | undefined;
    server.use(
      http.put(`${BASE}/admin/briefs/${BRIEF}/versions/${V2}/milestones`, async ({ request }) => {
        sent = (await request.json()) as typeof sent;
        return HttpResponse.json({ milestones: 1 });
      }),
    );
    render(<Briefs />, at);

    const title = await screen.findByLabelText("Milestone 1");
    await userEvent.clear(title);
    await userEvent.type(title, "Renamed");
    await userEvent.click(screen.getByRole("button", { name: /save milestones/i }));

    await waitFor(() => expect(sent!.milestones[0].title).toBe("Renamed"));
  });

  it("edits the acceptance criteria one per line", async () => {
    render(<Briefs />, at);

    expect(await screen.findByLabelText(/acceptance criteria/i)).toHaveValue("A README exists");
  });

  /** §6.5's check editor is not built; the count is shown instead. */
  it("says the check editor is not built", async () => {
    render(<Briefs />, at);

    expect(await screen.findByText(/1 automatic check/i)).toBeInTheDocument();
    expect(screen.getByText(/still come from the seed files/i)).toBeInTheDocument();
  });
});

describe("templates", () => {
  it("shows one field per technology option", async () => {
    brief([version(), version({ id: V2, versionNo: 2, status: "draft", publishedAt: null })]);
    render(<Briefs />, at);

    await userEvent.click(await screen.findByRole("button", { name: /templates/i }));

    expect(screen.getByLabelText("React")).toHaveValue("first-commit/task-tracker-react");
    expect(screen.getByLabelText("Vue")).toHaveValue("first-commit/task-tracker-vue");
  });

  it("does not let a published version's templates be edited", async () => {
    render(<Briefs />, at);

    await userEvent.click(await screen.findByRole("button", { name: /templates/i }));

    expect(screen.getByLabelText("React")).toBeDisabled();
    expect(screen.queryByRole("button", { name: /save templates/i })).not.toBeInTheDocument();
  });
});

describe("history", () => {
  it("keeps a superseded version and says why", async () => {
    brief([version({ id: V2, versionNo: 2 }), version({ status: "superseded" })]);
    render(<Briefs />, at);

    await userEvent.click(await screen.findByRole("button", { name: /history/i }));

    expect(screen.getByText("superseded")).toBeInTheDocument();
    expect(screen.getByText(/learners who were building them finish them/i)).toBeInTheDocument();
  });
});

describe("accessibility", () => {
  it("has no axe violations", async () => {
    brief([
      version(),
      version({ id: V2, versionNo: 2, status: "draft", publishedAt: null, missingTemplates: ["Vue"] }),
    ]);
    const { container } = render(<Briefs />, at);

    await screen.findByText(/cannot be published yet/i);
    await expectNoAxeViolations(container);
  });
});
