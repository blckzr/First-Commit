import { beforeEach, describe, expect, it } from "vitest";
import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { render } from "../../test/render";
import { api } from "../../test/server";
import { expectNoAxeViolations } from "../../test/axe";
import { Capstone } from "./Capstone";

/**
 * design.md §5.14 — the capstone, stage 1.
 *
 * The screen draws whatever `stage` the API reports and never works it out from
 * the other fields, so the tests drive it by stage. The one that matters most
 * is `locked`: the same rows decide it that decide whether `POST` is allowed, so
 * a screen that offered briefs anyway would be inviting a 409.
 */

const brief = {
  id: "b1",
  versionId: "v1",
  slug: "task-tracker",
  title: "Task tracker",
  description: "Keep a list of things to do.",
  goals: "Ship something you can show.",
  estimatedWeeks: 3,
  milestoneCount: 5,
  uses: ["Components", "HTML"],
  starterRepo: "first-commit/task-tracker-react",
};

const choosing = {
  stage: "choose" as const,
  technology: { id: "t1", name: "React" },
  briefs: [brief],
  roadmapId: "r1",
};

beforeEach(() => {
  api.signedIn();
});

describe("when the capstone is locked", () => {
  it("says why instead of offering briefs", async () => {
    api.capstone({
      stage: "locked",
      reason: "Finish the modules on this roadmap to unlock the capstone project.",
    });
    render(<Capstone />, { route: "/app/capstone" });

    expect(await screen.findByText(/finish the modules/i)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /build/i })).not.toBeInTheDocument();
  });

  /** §9: an empty state explains and directs rather than saying "nothing here". */
  it("explains when there is no roadmap at all", async () => {
    api.capstone({
      stage: "locked",
      reason: "Build a roadmap first — the capstone comes at the end of one.",
      roadmapId: null,
    });
    render(<Capstone />, { route: "/app/capstone" });

    expect(await screen.findByText(/build a roadmap first/i)).toBeInTheDocument();
  });
});

describe("choosing a brief", () => {
  it("shows the briefs for the technology the learner chose", async () => {
    api.capstone(choosing);
    render(<Capstone />, { route: "/app/capstone" });

    expect(await screen.findByText(/what you.+ll build with React/i)).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Task tracker" })).toBeInTheDocument();
    expect(screen.getByText("5")).toBeInTheDocument();
    expect(screen.getByText("About 3 weeks")).toBeInTheDocument();
    expect(screen.getByText("Components, HTML")).toBeInTheDocument();
  });

  /**
   * **The body carries a brief id and nothing else.** A technology here would
   * be a framework on a Project Certificate that nobody studied — the endpoint
   * rejects one, and this asserts the screen never tries.
   */
  it("sends only the brief id", async () => {
    let sent: unknown;
    api.capstone(choosing);
    api.capstoneStartSucceeds((body) => (sent = body));
    render(<Capstone />, { route: "/app/capstone" });

    await userEvent.click(await screen.findByRole("button", { name: /build task tracker/i }));

    await waitFor(() => expect(sent).toEqual({ briefId: "b1" }));
  });

  it("surfaces a refusal from the API", async () => {
    api.capstone(choosing);
    api.capstoneStartFails(409, "You have already started a project on this roadmap.");
    render(<Capstone />, { route: "/app/capstone" });

    await userEvent.click(await screen.findByRole("button", { name: /build task tracker/i }));

    expect(await screen.findByRole("alert")).toHaveTextContent(/already started/i);
  });

  it("says so when no brief exists for that technology", async () => {
    api.capstone({ ...choosing, briefs: [] });
    render(<Capstone />, { route: "/app/capstone" });

    expect(await screen.findByText(/no project brief for React/i)).toBeInTheDocument();
  });
});

const connecting = {
  stage: "connect" as const,
  technology: { id: "t1", name: "React" },
  project: {
    id: "p1",
    status: "connecting",
    repoFullName: null,
    briefTitle: "Task tracker",
    starterRepo: "first-commit/task-tracker-react",
  },
  roadmapId: "r1",
};

const repository = { id: 900123, fullName: "learner/task-tracker", private: false };

describe("stage 2 — connecting a repository", () => {
  it("offers the starter template for the learner's technology", async () => {
    api.capstone(connecting);
    api.githubConnection({ connected: false });
    render(<Capstone />, { route: "/app/capstone" });

    const link = await screen.findByRole("link", { name: /React starter template/i });
    // GitHub's "use this template" form, which creates the learner's OWN
    // repository rather than sending them to ours.
    expect(link).toHaveAttribute(
      "href",
      "https://github.com/first-commit/task-tracker-react/generate",
    );
  });

  /** A template withdrawn after the learner started must not break the screen. */
  it("says so when the starter template is gone", async () => {
    api.capstone({ ...connecting, project: { ...connecting.project, starterRepo: null } });
    api.githubConnection({ connected: false });
    render(<Capstone />, { route: "/app/capstone" });

    expect(await screen.findByText(/starter template for React is unavailable/i)).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: /starter template/i })).not.toBeInTheDocument();
  });

  it("offers to connect, with §5.14's promise about scope", async () => {
    api.capstone(connecting);
    api.githubConnection({ connected: false });
    render(<Capstone />, { route: "/app/capstone" });

    expect(await screen.findByRole("button", { name: /connect with github/i })).toBeInTheDocument();
    expect(screen.getByText(/only the repository you select is shared/i)).toBeInTheDocument();
  });

  it("shows the connected account instead of the button", async () => {
    api.capstone(connecting);
    api.githubConnection({ connected: true, login: "learner-x", repositories: [repository] });
    render(<Capstone />, { route: "/app/capstone" });

    expect(await screen.findByText("learner-x")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /connect with github/i })).not.toBeInTheDocument();
  });

  /**
   * **The id, never the name.** A name can be renamed or transferred; the id
   * cannot, and the API checks it against what the installation grants.
   */
  it("sends the repository id", async () => {
    let sent: unknown;
    api.capstone(connecting);
    api.githubConnection({ connected: true, login: "learner-x", repositories: [repository] });
    api.capstoneRepositorySucceeds((body) => (sent = body));
    render(<Capstone />, { route: "/app/capstone" });

    await userEvent.click(await screen.findByLabelText("learner/task-tracker"));
    await userEvent.click(screen.getByRole("button", { name: /start building/i }));

    await waitFor(() => expect(sent).toEqual({ repositoryId: 900123 }));
  });

  it("will not start building until a repository is chosen", async () => {
    api.capstone(connecting);
    api.githubConnection({ connected: true, login: "learner-x", repositories: [repository] });
    render(<Capstone />, { route: "/app/capstone" });

    expect(await screen.findByRole("button", { name: /start building/i })).toBeDisabled();
  });

  /**
   * A connected account the platform cannot reach is not a disconnected one —
   * offering to reconnect would be wrong as well as useless.
   */
  it("says GitHub is unreachable without offering to reconnect", async () => {
    api.capstone(connecting);
    api.githubConnection({ connected: true, login: "learner-x", reachable: false });
    render(<Capstone />, { route: "/app/capstone" });

    expect(await screen.findByRole("alert")).toHaveTextContent(/isn.t answering/i);
    expect(screen.queryByRole("button", { name: /connect with github/i })).not.toBeInTheDocument();
  });

  it("directs the learner when the installation grants nothing", async () => {
    api.capstone(connecting);
    api.githubConnection({ connected: true, login: "learner-x", repositories: [] });
    render(<Capstone />, { route: "/app/capstone" });

    expect(await screen.findByText(/doesn.t include any repositories/i)).toBeInTheDocument();
  });

  it("surfaces a refusal from the API", async () => {
    api.capstone(connecting);
    api.githubConnection({ connected: true, login: "learner-x", repositories: [repository] });
    api.capstoneRepositoryFails(404, "That repository isn't one this installation can see.");
    render(<Capstone />, { route: "/app/capstone" });

    await userEvent.click(await screen.findByLabelText("learner/task-tracker"));
    await userEvent.click(screen.getByRole("button", { name: /start building/i }));

    expect(await screen.findByRole("alert")).toHaveTextContent(/installation can see/i);
  });
});

describe("stage 3", () => {
  const building = (project: Record<string, unknown>) => ({
    stage: "build" as const,
    technology: { id: "t1", name: "React" },
    project: {
      id: "p1",
      status: "in_progress",
      repoFullName: "learner/task-tracker",
      briefTitle: "Task tracker",
      starterRepo: "first-commit/task-tracker-react",
      ...project,
    },
    roadmapId: "r1",
  });

  it("lists the push history, newest first", async () => {
    api.capstone(
      building({
        commits: [
          { sha: "a1b2c3d4e5", message: "Add task form", authorLogin: "learner", pushedAt: "2026-01-02T10:00:00Z" },
          { sha: "9988776655", message: "Build the layout", authorLogin: "learner", pushedAt: "2026-01-01T10:00:00Z" },
        ],
      }),
    );
    api.capstoneMilestones([{ title: "Set up the repository" }]);
    render(<Capstone />, { route: "/app/capstone" });

    // Short sha, as §5.14 draws it.
    expect(await screen.findByText("a1b2c3d")).toBeInTheDocument();
    expect(screen.getByText(/Add task form/)).toBeInTheDocument();
  });

  it("invites a first push when there is no history", async () => {
    api.capstone(building({ commits: [] }));
    api.capstoneMilestones([{ title: "Set up the repository" }]);
    render(<Capstone />, { route: "/app/capstone" });

    expect(await screen.findByText(/push your first commit/i)).toBeInTheDocument();
  });

  /** An unreachable GitHub is not a lost history, and saying so matters. */
  it("says the history may be behind when GitHub is unreachable", async () => {
    api.capstone(
      building({
        githubReachable: false,
        commits: [
          { sha: "a1b2c3d4e5", message: "Add task form", authorLogin: null, pushedAt: "2026-01-02T10:00:00Z" },
        ],
      }),
    );
    api.capstoneMilestones([{ title: "Set up the repository" }]);
    render(<Capstone />, { route: "/app/capstone" });

    expect(await screen.findByRole("alert")).toHaveTextContent(/nothing is lost/i);
  });
});

describe("the milestone tracker", () => {
  const project = {
    id: "p1",
    status: "in_progress",
    repoFullName: "learner/task-tracker",
    briefTitle: "Task tracker",
    starterRepo: "first-commit/task-tracker-react",
    commits: [],
  };

  const built = () => {
    api.capstone({
      stage: "build",
      technology: { id: "t1", name: "React" },
      project,
      roadmapId: "r1",
    });
  };

  it("shows progress and every milestone with a status word", async () => {
    built();
    api.capstoneMilestones([
      { title: "Set up the repository", status: "complete" },
      { title: "Build the layout", status: "failed" },
      { title: "Add and edit tasks", status: "not-started" },
    ]);
    render(<Capstone />, { route: "/app/capstone" });

    expect(await screen.findByText(/1 of 3 milestones complete/i)).toBeInTheDocument();

    /**
     * §8: status is icon **and text** and colour, never colour alone. A learner
     * scanning for the milestone that needs attention is exactly who a
     * colour-only signal fails.
     */
    expect(screen.getByText("Complete")).toBeInTheDocument();
    expect(screen.getByText("Not passing yet")).toBeInTheDocument();
    expect(screen.getByText("Not started")).toBeInTheDocument();
  });

  it("opens on the milestone being worked on", async () => {
    built();
    api.capstoneMilestones([
      { title: "Set up the repository", status: "complete" },
      { title: "Build the layout", status: "failed", acceptanceCriteria: ["A heading", "A form"] },
    ]);
    render(<Capstone />, { route: "/app/capstone" });

    // The first unfinished one, not the first one.
    expect(await screen.findByRole("heading", { name: /Milestone 2: Build the layout/i })).toBeInTheDocument();
    expect(screen.getByText("A heading")).toBeInTheDocument();
  });

  it("lets the learner read a different milestone", async () => {
    built();
    api.capstoneMilestones([
      { title: "Set up the repository", status: "complete", acceptanceCriteria: ["A README"] },
      { title: "Build the layout", status: "failed" },
    ]);
    render(<Capstone />, { route: "/app/capstone" });

    await userEvent.click(await screen.findByRole("button", { name: /Set up the repository/i }));

    expect(screen.getByRole("heading", { name: /Milestone 1/i })).toBeInTheDocument();
    expect(screen.getByText("A README")).toBeInTheDocument();
  });

  /**
   * **The distinction this screen exists to keep.** A check that has not
   * finished is not a check that failed, and a learner who pushed a moment ago
   * must not be told their code is wrong.
   */
  it("says a running check is running, not failing", async () => {
    built();
    api.capstoneMilestones([
      {
        title: "Add and edit tasks",
        status: "checking",
        commitSha: "a1b2c3d4e5",
        checks: [
          { checkId: "c1", name: "Test: adds a task", state: "passed", detail: '"adds a task" passed.' },
          { checkId: "c2", name: "Test: rejects empty input", state: "pending", detail: '"rejects empty input" is still running.' },
          { checkId: "c3", name: "A task form exists", state: "failed", detail: "Nothing matches." },
        ],
      },
    ]);
    render(<Capstone />, { route: "/app/capstone" });

    expect(await screen.findByText("Still running")).toBeInTheDocument();
    expect(screen.getByText("Passed")).toBeInTheDocument();
    expect(screen.getByText("Not passing")).toBeInTheDocument();
    // The commit being judged, so the learner knows which push this is about.
    expect(screen.getByText("a1b2c3d")).toBeInTheDocument();
  });

  it("waits for a push rather than showing an empty check list", async () => {
    built();
    api.capstoneMilestones([{ title: "Set up the repository", checks: [] }]);
    render(<Capstone />, { route: "/app/capstone" });

    expect(await screen.findByText(/push your changes to see checks/i)).toBeInTheDocument();
  });

  it("saves an answer to the explanation question", async () => {
    let sent: unknown;
    built();
    api.capstoneMilestones([
      {
        title: "Add and edit tasks",
        status: "failed",
        explanationQuestion: "How does your form stop an empty task?",
      },
    ]);
    api.capstoneExplanationSucceeds((body) => (sent = body));
    render(<Capstone />, { route: "/app/capstone" });

    const box = await screen.findByLabelText(/how does your form stop/i);
    await userEvent.type(box, "It checks the value is not empty first.");
    await userEvent.click(screen.getByRole("button", { name: /save answer/i }));

    await waitFor(() =>
      expect(sent).toEqual({ answer: "It checks the value is not empty first." }),
    );
  });

  it("does not ask the question on a milestone that has none", async () => {
    built();
    api.capstoneMilestones([{ title: "Set up the repository", explanationQuestion: null }]);
    render(<Capstone />, { route: "/app/capstone" });

    await screen.findByRole("heading", { name: /Milestone 1/i });
    expect(screen.queryByRole("button", { name: /save answer/i })).not.toBeInTheDocument();
  });

  /**
   * §7: all AI output is labelled as AI, carries a short reason, and is
   * flaggable. The shared `AiPanel` carries all three, which is why the review
   * goes through it rather than being drawn inline — a screen cannot then ship
   * two of the three.
   */
  it("shows the AI review labelled, with a way to flag it", async () => {
    built();
    api.capstoneMilestones([
      {
        title: "Add and edit tasks",
        status: "failed",
        review: {
          outputId: "out1",
          summary: "Adding and editing work. Empty input still gets through.",
          checklist: [
            { criterion: "Each task has a stable id", met: true, note: "You use crypto.randomUUID." },
            { criterion: "Empty input handled in one place", met: false, note: "Checked twice." },
          ],
          nextStep: "Look at the submit handler in TaskForm.",
        },
      },
    ]);
    render(<Capstone />, { route: "/app/capstone" });

    expect(await screen.findByText(/adding and editing work/i)).toBeInTheDocument();
    expect(screen.getByText(/look at the submit handler/i)).toBeInTheDocument();
    // Labelled as AI, and flaggable.
    expect(screen.getByText(/AI review/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /wrong/i })).toBeInTheDocument();

    // §8: the checklist verdict is a word, not only an icon and a colour.
    expect(screen.getByText(/— met/)).toBeInTheDocument();
    expect(screen.getByText(/— not yet/)).toBeInTheDocument();
  });

  /** No review yet is an empty space, not an empty panel. */
  it("shows no AI panel before the worker has written one", async () => {
    built();
    api.capstoneMilestones([{ title: "Add and edit tasks", status: "failed", review: null }]);
    render(<Capstone />, { route: "/app/capstone" });

    await screen.findByRole("heading", { name: /Milestone 1/i });
    expect(screen.queryByText(/AI review/i)).not.toBeInTheDocument();
  });

  it("congratulates a finished project", async () => {
    built();
    api.capstoneMilestones([
      { title: "Set up the repository", status: "complete" },
      { title: "Deploy", status: "complete" },
    ]);
    render(<Capstone />, { route: "/app/capstone" });

    expect(await screen.findByText(/every milestone is complete/i)).toBeInTheDocument();
    expect(screen.getByText(/project certificate is ready/i)).toBeInTheDocument();
  });

  it("has no axe violations", async () => {
    built();
    api.capstoneMilestones([
      { title: "Set up the repository", status: "complete" },
      {
        title: "Build the layout",
        status: "failed",
        acceptanceCriteria: ["A heading"],
        modules: [{ id: "mod1", title: "Components in React", slug: "components-in-react" }],
        explanationQuestion: "Why?",
        checks: [{ checkId: "c1", name: "A form exists", state: "failed", detail: "Nothing matches." }],
      },
    ]);
    const { container } = render(<Capstone />, { route: "/app/capstone" });

    await screen.findByRole("heading", { name: /Milestone 2/i });
    await expectNoAxeViolations(container);
  });
});

describe("accessibility", () => {
  it("has no axe violations while choosing", async () => {
    api.capstone(choosing);
    const { container } = render(<Capstone />, { route: "/app/capstone" });

    await screen.findByRole("heading", { name: "Task tracker" });
    await expectNoAxeViolations(container);
  });

  /**
   * Stage 2 is the only screen here with real form controls — a radio per
   * repository — so it is the one where a missing label would actually cost
   * somebody the ability to finish.
   */
  it("has no axe violations while connecting", async () => {
    api.capstone(connecting);
    api.githubConnection({ connected: true, login: "learner-x", repositories: [repository] });
    const { container } = render(<Capstone />, { route: "/app/capstone" });

    await screen.findByLabelText("learner/task-tracker");
    await expectNoAxeViolations(container);
  });

  it("has no axe violations when locked", async () => {
    api.capstone({ stage: "locked", reason: "Finish the modules on this roadmap." });
    const { container } = render(<Capstone />, { route: "/app/capstone" });

    await screen.findByText(/finish the modules/i);
    await expectNoAxeViolations(container);
  });
});
