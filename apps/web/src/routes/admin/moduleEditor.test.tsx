import { beforeEach, describe, expect, it } from "vitest";
import { http, HttpResponse } from "msw";
import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Route, Routes } from "react-router";
import { render } from "../../test/render";
import { server } from "../../test/server";
import { expectNoAxeViolations } from "../../test/axe";
import { ModuleEditor } from "./ModuleEditor";

const BASE = "http://localhost:4000";
const MODULE = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const V1 = "11111111-1111-4111-8111-111111111111";
const V2 = "22222222-2222-4222-8222-222222222222";

/**
 * design.md §6.3's module editor and §6.4's impact preview.
 *
 * **What a learner is reading must never change while an author types.** The
 * API has no endpoint that could move them (§6 rule 6 lives in that absence),
 * so what these assert is that the screen never offers it: a published version
 * is shown and not editable, and Publish goes through a dialog that counts who
 * it affects first.
 */

const lesson = (title: string) => ({
  title,
  blocks: [{ type: "paragraph", text: "Something to read." }],
});

const version = (over: Record<string, unknown> = {}) => ({
  id: V1,
  versionNo: 1,
  title: "Components in React",
  description: "Props and JSX",
  estimatedHours: 6,
  status: "published",
  changeSummary: "",
  publishedAt: "2026-10-01T00:00:00Z",
  createdAt: "2026-09-20T00:00:00Z",
  lessons: [lesson("What a component is")],
  ...over,
});

function detail(versions: Record<string, unknown>[]) {
  server.use(
    http.get(`${BASE}/admin/modules/${MODULE}`, () =>
      HttpResponse.json({
        module: {
          id: MODULE,
          slug: "components-in-react",
          kind: "technology",
          status: "published",
          skillName: "Components",
          technologyName: "React",
        },
        versions,
      }),
    ),
  );
}

function impact(over: Record<string, unknown> = {}) {
  server.use(
    http.get(`${BASE}/admin/modules/${MODULE}/versions/${V2}/impact`, () =>
      HttpResponse.json({
        versionNo: 2,
        title: "Components in React",
        currentVersionNo: 1,
        activeRoadmaps: 98,
        takingCurrent: 12,
        passed: 156,
        ...over,
      }),
    ),
  );
}

/**
 * The editor reads `:moduleId` from the route, so it is mounted under a
 * `<Routes>` the way `certificates.test.tsx` mounts the verification page.
 */
const editor = () => (
  <Routes>
    <Route path="/admin/modules/:moduleId" element={<ModuleEditor />} />
  </Routes>
);
const at = { route: `/admin/modules/${MODULE}` };

beforeEach(() => {
  detail([version()]);
  impact();
});

describe("with no draft", () => {
  it("shows what learners are reading and offers a draft", async () => {
    render(editor(), at);

    expect(await screen.findByText("Published: version 1")).toBeInTheDocument();
    expect(screen.getByText("No draft")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /start a draft/i })).toBeInTheDocument();
  });

  /**
   * **A published version is not editable here.** Learners are reading it, and
   * the screen must not suggest otherwise.
   */
  it("offers no way to edit the published version", async () => {
    render(editor(), at);
    await screen.findByText("Published: version 1");

    expect(screen.queryByLabelText(/^title$/i)).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /save draft/i })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /^publish$/i })).not.toBeInTheDocument();
  });

  it("says a draft leaves learners where they are", async () => {
    render(editor(), at);

    expect(
      await screen.findByText(/they keep reading this version until you publish/i),
    ).toBeInTheDocument();
  });

  it("starts a draft", async () => {
    let asked = false;
    server.use(
      http.post(`${BASE}/admin/modules/${MODULE}/versions`, () => {
        asked = true;
        return HttpResponse.json({ versionId: V2, versionNo: 2, reused: false });
      }),
    );
    render(editor(), at);

    await userEvent.click(await screen.findByRole("button", { name: /start a draft/i }));

    await waitFor(() => expect(asked).toBe(true));
  });
});

describe("editing a draft", () => {
  beforeEach(() => {
    detail([
      version(),
      version({ id: V2, versionNo: 2, status: "draft", publishedAt: null }),
    ]);
  });

  it("shows both the draft and what is published", async () => {
    render(editor(), at);

    expect(await screen.findByText("Version 2 (draft)")).toBeInTheDocument();
    expect(screen.getByText("Published: version 1")).toBeInTheDocument();
  });

  it("edits a lesson's blocks", async () => {
    let sent: unknown;
    server.use(
      http.patch(`${BASE}/admin/modules/${MODULE}/versions/${V2}`, () =>
        HttpResponse.json({ ok: true }),
      ),
      http.put(`${BASE}/admin/modules/${MODULE}/versions/${V2}/lessons`, async ({ request }) => {
        sent = await request.json();
        return HttpResponse.json({ lessons: 1 });
      }),
    );
    render(editor(), at);

    const paragraph = await screen.findByLabelText("Paragraph");
    await userEvent.clear(paragraph);
    await userEvent.type(paragraph, "Rewritten.");
    await userEvent.click(screen.getByRole("button", { name: /save draft/i }));

    await waitFor(() =>
      expect(sent).toEqual({
        lessons: [
          { title: "What a component is", blocks: [{ type: "paragraph", text: "Rewritten." }] },
        ],
      }),
    );
  });

  it("adds a block of each type the renderer can draw", async () => {
    render(editor(), at);
    await screen.findByText("Version 2 (draft)");

    for (const label of [/add heading/i, /add list/i, /add code/i, /add callout/i]) {
      expect(screen.getByRole("button", { name: label })).toBeInTheDocument();
    }
  });

  /** A version with nothing to read is a module a learner opens and finds empty. */
  it("will not offer publish with no lessons", async () => {
    detail([
      version(),
      version({ id: V2, versionNo: 2, status: "draft", publishedAt: null, lessons: [] }),
    ]);
    render(editor(), at);

    await screen.findByText("Version 2 (draft)");
    expect(screen.getByRole("button", { name: /^publish$/i })).toBeDisabled();
  });

  it("discards the draft", async () => {
    let asked = false;
    server.use(
      http.delete(`${BASE}/admin/modules/${MODULE}/versions/${V2}`, () => {
        asked = true;
        return HttpResponse.json({ discarded: 2 });
      }),
    );
    render(editor(), at);

    await userEvent.click(await screen.findByRole("button", { name: /discard draft/i }));

    await waitFor(() => expect(asked).toBe(true));
  });
});

describe("the impact dialog", () => {
  beforeEach(() => {
    detail([
      version(),
      version({ id: V2, versionNo: 2, status: "draft", publishedAt: null }),
    ]);
  });

  /** §6.4's numbers are promises about real people, so they are counted first. */
  it("counts who it affects before publishing", async () => {
    render(editor(), at);

    await userEvent.click(await screen.findByRole("button", { name: /^publish$/i }));

    expect(await screen.findByRole("dialog")).toBeInTheDocument();
    expect(screen.getByText("98")).toBeInTheDocument();
    expect(screen.getByText(/active roadmaps include this module/i)).toBeInTheDocument();
    expect(screen.getByText("12")).toBeInTheDocument();
    expect(screen.getByText("156")).toBeInTheDocument();
  });

  /**
   * §6 rule 6, said to the person about to rely on it. These three sentences
   * are the reason the dialog exists at all.
   */
  it("states what happens to learners already on the old version", async () => {
    render(editor(), at);
    await userEvent.click(await screen.findByRole("button", { name: /^publish$/i }));

    await screen.findByRole("dialog");
    expect(screen.getByText(/learners taking version 1 will finish it/i)).toBeInTheDocument();
    expect(screen.getByText(/learners who passed keep their credit/i)).toBeInTheDocument();
    expect(screen.getByText(/new learners get version 2/i)).toBeInTheDocument();
  });

  it("publishes on confirmation", async () => {
    let asked = false;
    server.use(
      http.post(`${BASE}/admin/modules/${MODULE}/versions/${V2}/publish`, () => {
        asked = true;
        return HttpResponse.json({
          versionNo: 2,
          title: "Components in React",
          supersededVersionNo: 1,
        });
      }),
    );
    render(editor(), at);

    await userEvent.click(await screen.findByRole("button", { name: /^publish$/i }));
    await userEvent.click(
      await screen.findByRole("button", { name: /publish version 2/i }),
    );

    await waitFor(() => expect(asked).toBe(true));
  });

  it("publishes nothing on cancel", async () => {
    let asked = false;
    server.use(
      http.post(`${BASE}/admin/modules/${MODULE}/versions/${V2}/publish`, () => {
        asked = true;
        return HttpResponse.json({ versionNo: 2, title: "x", supersededVersionNo: 1 });
      }),
    );
    render(editor(), at);

    await userEvent.click(await screen.findByRole("button", { name: /^publish$/i }));
    await userEvent.click(await screen.findByRole("button", { name: /cancel/i }));

    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(asked).toBe(false);
  });

  it("surfaces a refusal from the API", async () => {
    server.use(
      http.post(`${BASE}/admin/modules/${MODULE}/versions/${V2}/publish`, () =>
        HttpResponse.json(
          { error: "Add at least one lesson before publishing this version." },
          { status: 400 },
        ),
      ),
    );
    render(editor(), at);

    await userEvent.click(await screen.findByRole("button", { name: /^publish$/i }));
    await userEvent.click(await screen.findByRole("button", { name: /publish version 2/i }));

    expect(await screen.findByRole("alert")).toHaveTextContent(/at least one lesson/i);
  });
});

describe("history", () => {
  it("keeps a superseded version and says why", async () => {
    detail([
      version({ id: V2, versionNo: 2, status: "published" }),
      version({ id: V1, versionNo: 1, status: "superseded" }),
    ]);
    render(editor(), at);

    await userEvent.click(await screen.findByRole("button", { name: /history/i }));

    expect(screen.getByText("superseded")).toBeInTheDocument();
    expect(screen.getByText(/learners who were partway through them finish them/i)).toBeInTheDocument();
  });
});

describe("accessibility", () => {
  it("has no axe violations with a draft open", async () => {
    detail([
      version(),
      version({ id: V2, versionNo: 2, status: "draft", publishedAt: null }),
    ]);
    const { container } = render(editor(), at);

    await screen.findByText("Version 2 (draft)");
    await expectNoAxeViolations(container);
  });

  it("has no axe violations in the impact dialog", async () => {
    detail([
      version(),
      version({ id: V2, versionNo: 2, status: "draft", publishedAt: null }),
    ]);
    const { container } = render(editor(), at);

    await userEvent.click(await screen.findByRole("button", { name: /^publish$/i }));
    await screen.findByRole("dialog");
    await expectNoAxeViolations(container);
  });
});
