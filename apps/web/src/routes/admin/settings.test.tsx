import { beforeEach, describe, expect, it } from "vitest";
import { http, HttpResponse } from "msw";
import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { render } from "../../test/render";
import { server } from "../../test/server";
import { expectNoAxeViolations } from "../../test/axe";
import { Settings } from "./Settings";

const BASE = "http://localhost:4000";

/**
 * design.md §6.11 — Settings.
 *
 * The thing worth testing is that the screen is **honest about which of its
 * three sections does anything**. §6.11 asks for prompt editing, context
 * limits and prompt testing; none is possible, and a screen that simply left
 * them out would read as unfinished rather than as decided. So each absence is
 * asserted to be *stated*, and the one section that writes is asserted to say
 * which of its rules the platform actually reads.
 */

const rule = (over: Record<string, unknown> = {}) => ({
  key: "passing_score_default",
  label: "Pass mark for a new quiz",
  affects: "The score a new quiz starts at in the module editor (§6.3).",
  enforced: true,
  min: 1,
  max: 100,
  unit: "percent",
  value: 70,
  stored: false,
  updatedAt: null,
  ...over,
});

const prompt = (over: Record<string, unknown> = {}) => ({
  component: "code_feedback",
  versionNo: 2,
  content: "You are a patient senior developer.",
  createdAt: "2026-09-01T00:00:00Z",
  model: "qwen3.5:9b",
  lastRunAt: "2026-10-30T00:00:00Z",
  runs: 17,
  ...over,
});

function settings(over: {
  rules?: Record<string, unknown>[];
  prompts?: Record<string, unknown>[];
  github?: Record<string, unknown>;
} = {}) {
  server.use(
    http.get(`${BASE}/admin/settings/learning`, () =>
      HttpResponse.json({ rules: over.rules ?? [rule()] }),
    ),
    http.get(`${BASE}/admin/settings/ai`, () =>
      HttpResponse.json({
        prompts: over.prompts ?? [prompt()],
        editable: false,
        editableReason:
          "Prompt text lives in the worker's source and is registered in ai_prompts on start. The worker refuses to start if a stored version's text differs from the code's, so editing a prompt here would stop it.",
        notBuilt: [
          { what: "Context limits", why: "The context window is the worker's own configuration." },
          {
            what: "Test a prompt against sample input",
            why: "Running a prompt needs Ollama, which only the worker can reach.",
          },
        ],
      }),
    ),
    http.get(`${BASE}/admin/settings/github`, () =>
      HttpResponse.json({
        configured: false,
        implementation: "development",
        byType: [],
        recent: [],
        editable: false,
        editableReason:
          "The App's id, client secret and private key are environment configuration on Render. They are never read or shown here.",
        ...over.github,
      }),
    ),
  );
}

const at = { route: "/admin/settings" };

beforeEach(() => settings());

describe("learning rules", () => {
  /**
   * **The default is shown as a default.** `platform_settings` starts empty,
   * and a page that showed 70 as though somebody chose it would make an unset
   * rule indistinguishable from a set one.
   */
  it("says when a value is the platform's default rather than a choice", async () => {
    render(<Settings />, at);

    expect(
      await screen.findByText(/not set — the platform is using its default of 70/i),
    ).toBeInTheDocument();
  });

  it("says when it was set, once it has been", async () => {
    settings({ rules: [rule({ value: 75, stored: true, updatedAt: "2026-10-30T00:00:00Z" })] });
    render(<Settings />, at);

    expect(await screen.findByText(/^Set on /i)).toBeInTheDocument();
  });

  it("sends the new value", async () => {
    let sent: { value: number } | undefined;
    server.use(
      http.put(`${BASE}/admin/settings/learning/passing_score_default`, async ({ request }) => {
        sent = (await request.json()) as typeof sent;
        return HttpResponse.json({ rules: [rule({ value: 65, stored: true })] });
      }),
    );
    render(<Settings />, at);

    const field = await screen.findByLabelText("Percent");
    await userEvent.clear(field);
    await userEvent.type(field, "65");
    await userEvent.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() => expect(sent).toEqual({ value: 65 }));
  });

  /** Nothing to save is not an action. */
  it("will not save an unchanged value", async () => {
    render(<Settings />, at);

    expect(await screen.findByRole("button", { name: "Save" })).toBeDisabled();
  });

  it("confirms the change is in the activity log", async () => {
    server.use(
      http.put(`${BASE}/admin/settings/learning/passing_score_default`, () =>
        HttpResponse.json({ rules: [rule({ value: 65, stored: true })] }),
      ),
    );
    render(<Settings />, at);

    const field = await screen.findByLabelText("Percent");
    await userEvent.clear(field);
    await userEvent.type(field, "65");
    await userEvent.click(screen.getByRole("button", { name: "Save" }));

    expect(await screen.findByText(/saved\. recorded in the activity log/i)).toBeInTheDocument();
  });

  /**
   * **A rule nothing reads says so on the page.** This is the assertion that
   * keeps the section from being a form over a table nobody looks at — storing
   * a value is not the same as the platform obeying it.
   */
  it("marks a rule nothing enforces yet", async () => {
    settings({
      rules: [
        rule(),
        rule({
          key: "reinforcement_after_attempts",
          label: "Failed attempts before a reinforcement module is added",
          affects: "Nothing yet. No code adds one.",
          enforced: false,
          unit: "attempts",
          value: 2,
        }),
      ],
    });
    render(<Settings />, at);

    expect(await screen.findByText("Stored, not used yet")).toBeInTheDocument();
    expect(screen.getByText(/nothing yet\. no code adds one/i)).toBeInTheDocument();
  });

  /** §6.11: "shows what it affects". */
  it("names what reads a rule that is in use", async () => {
    render(<Settings />, at);

    expect(await screen.findByText("In use")).toBeInTheDocument();
    expect(screen.getByText(/the score a new quiz starts at/i)).toBeInTheDocument();
  });

  /**
   * **The range is enforced twice over, and this covers the second.** `min` and
   * `max` on the input mean the browser refuses an out-of-range value before a
   * request is made — which is why this test sends a *valid* number and has the
   * API refuse for its own reason. Typing `0` would never reach the handler, so
   * a test built that way would be asserting against the browser rather than
   * against this screen.
   */
  it("shows the API's refusal", async () => {
    server.use(
      http.put(`${BASE}/admin/settings/learning/passing_score_default`, () =>
        HttpResponse.json({ error: "That isn't a setting this platform has." }, { status: 404 }),
      ),
    );
    render(<Settings />, at);

    const field = await screen.findByLabelText("Percent");
    await userEvent.clear(field);
    await userEvent.type(field, "65");
    await userEvent.click(screen.getByRole("button", { name: "Save" }));

    expect(await screen.findByRole("alert")).toHaveTextContent(/isn't a setting/i);
  });

  /** And the first layer: the browser will not send a value out of range. */
  it("will not send a value below the rule's minimum", async () => {
    let asked = false;
    server.use(
      http.put(`${BASE}/admin/settings/learning/passing_score_default`, () => {
        asked = true;
        return HttpResponse.json({ rules: [rule()] });
      }),
    );
    render(<Settings />, at);

    const field = await screen.findByLabelText("Percent");
    await userEvent.clear(field);
    await userEvent.type(field, "0");
    await userEvent.click(screen.getByRole("button", { name: "Save" }));

    expect(asked).toBe(false);
  });
});

describe("the AI section", () => {
  /**
   * §6.11 says "edit the prompts". AGENT.md §7 makes the worker refuse to start
   * if a stored prompt differs from its source, so an edit box here would stop
   * the worker — and the first symptom would be learners getting no feedback.
   */
  it("offers no way to edit a prompt, and says why", async () => {
    render(<Settings />, at);

    await screen.findByText("Code Review AI");

    expect(screen.getByText(/prompts are read-only here/i)).toBeInTheDocument();
    expect(screen.getByText(/refuses to start/i)).toBeInTheDocument();
    expect(screen.queryByRole("textbox", { name: /prompt/i })).not.toBeInTheDocument();
  });

  it("shows the prompt text and its version", async () => {
    render(<Settings />, at);

    expect(await screen.findByText("Version 2")).toBeInTheDocument();
    /* Collapsed behind a disclosure — the prompt is long and not the headline. */
    await userEvent.click(screen.getByText("Prompt text"));
    expect(screen.getByText(/patient senior developer/i)).toBeInTheDocument();
  });

  /**
   * **The model is what ran, not what was configured.** The API cannot read the
   * worker's environment, and reporting what it was told rather than what it
   * did is how a settings page starts lying.
   */
  it("names the model that actually ran, with how many jobs", async () => {
    render(<Settings />, at);

    expect(await screen.findByText(/last run on qwen3\.5:9b · 17 jobs/i)).toBeInTheDocument();
  });

  it("says nothing has run rather than naming a model", async () => {
    settings({ prompts: [prompt({ model: null, runs: 0, lastRunAt: null })] });
    render(<Settings />, at);

    expect(
      await screen.findByText(/nothing has run through this component yet/i),
    ).toBeInTheDocument();
  });

  /** §6.11 asks for both; neither is something the API can do. */
  it("names what is not built, with the reason", async () => {
    render(<Settings />, at);

    expect(await screen.findByText(/Context limits\./)).toBeInTheDocument();
    expect(screen.getByText(/only the worker can reach/i)).toBeInTheDocument();
  });
});

describe("the GitHub section", () => {
  it("says the development client is in use when no App is configured", async () => {
    render(<Settings />, at);

    expect(await screen.findByText("Development client")).toBeInTheDocument();
    expect(screen.getByText(/invents a consistent account and repository/i)).toBeInTheDocument();
  });

  it("says an App is configured when one is", async () => {
    settings({ github: { configured: true, implementation: "rest" } });
    render(<Settings />, at);

    expect(await screen.findByText("Configured")).toBeInTheDocument();
  });

  /** AGENT.md's secrets rule: a credential field would be in a browser cache. */
  it("offers no field for a credential", async () => {
    render(<Settings />, at);

    await screen.findByText("Development client");

    expect(screen.queryByLabelText(/private key/i)).not.toBeInTheDocument();
    expect(screen.queryByLabelText(/client secret/i)).not.toBeInTheDocument();
    expect(screen.getByText(/never read or shown here/i)).toBeInTheDocument();
  });

  it("counts deliveries by type", async () => {
    settings({
      github: {
        byType: [
          {
            eventType: "push",
            received: 12,
            processed: 10,
            failed: 2,
            lastReceivedAt: "2026-10-30T00:00:00Z",
          },
        ],
      },
    });
    render(<Settings />, at);

    expect(await screen.findByText(/12 received, 10 processed, 2 failed/i)).toBeInTheDocument();
  });

  /** The error is the only thing that makes a failed delivery actionable. */
  it("shows a failed delivery's error", async () => {
    settings({
      github: {
        recent: [
          {
            deliveryId: "d1",
            eventType: "push",
            receivedAt: "2026-10-30T00:00:00Z",
            processedAt: null,
            error: "No project for that repository",
          },
        ],
      },
    });
    render(<Settings />, at);

    expect(await screen.findByText("No project for that repository")).toBeInTheDocument();
  });

  it("says nothing has arrived yet rather than showing an empty table", async () => {
    render(<Settings />, at);

    expect(await screen.findByText(/no webhook deliveries yet/i)).toBeInTheDocument();
  });
});

describe("accessibility", () => {
  it("has no axe violations", async () => {
    const { container } = render(<Settings />, at);

    await screen.findByText("Code Review AI");
    await expectNoAxeViolations(container);
  });
});
