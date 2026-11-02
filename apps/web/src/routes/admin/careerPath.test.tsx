import { beforeEach, describe, expect, it } from "vitest";
import { http, HttpResponse } from "msw";
import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { render } from "../../test/render";
import { server } from "../../test/server";
import { expectNoAxeViolations } from "../../test/axe";
import { CareerPaths } from "./CareerPath";

const BASE = "http://localhost:4000";
const PATH = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const MOD_A = "11111111-1111-4111-8111-111111111111";
const MOD_B = "22222222-2222-4222-8222-222222222222";

/**
 * design.md §6.2 — the career path editor.
 *
 * What is asserted here is the two things §6.2 validates, because they are what
 * silently break a roadmap: a **circular prerequisite** makes a module
 * unreachable, and a **technology option with no module for a concept skill**
 * leaves one group of learners with a gap nothing else notices.
 */

const module = (id: string, slug: string, over: Record<string, unknown> = {}) => ({
  id,
  slug,
  title: slug,
  kind: "core",
  technologyId: null,
  technologyName: null,
  requiredForCertificate: true,
  requires: [],
  ...over,
});

function path(over: Record<string, unknown> = {}) {
  server.use(
    http.get(`${BASE}/admin/paths`, () =>
      HttpResponse.json({
        paths: [
          { id: PATH, slug: "jwd", title: "Junior Web Developer", status: "published", tracks: 1, skills: 1 },
        ],
      }),
    ),
    http.get(`${BASE}/admin/paths/${PATH}`, () =>
      HttpResponse.json({
        path: { id: PATH, slug: "jwd", title: "Junior Web Developer", status: "published" },
        tracks: [],
        skills: [
          {
            pathSkillId: "ps1",
            trackId: null,
            layer: "core",
            skillId: "s1",
            slug: "js",
            name: "JavaScript",
            modules: [module(MOD_A, "js-basics"), module(MOD_B, "js-functions")],
          },
        ],
        warnings: [],
        ...over,
      }),
    ),
  );
}

beforeEach(() => path());

describe("the gap warning", () => {
  /** §6.2 renders this as "Vue has no module for State." */
  it("names a technology with no module for a concept skill", async () => {
    path({ warnings: [{ trackId: "t1", technology: "Vue", skill: "State" }] });
    render(<CareerPaths />, { route: "/admin/paths" });

    expect(await screen.findByText(/gaps a learner would hit/i)).toBeInTheDocument();
    expect(screen.getByText("Vue")).toBeInTheDocument();
    expect(screen.getByText("State")).toBeInTheDocument();
  });

  it("shows no banner when nothing is missing", async () => {
    render(<CareerPaths />, { route: "/admin/paths" });

    await screen.findByText("JavaScript");
    expect(screen.queryByText(/gaps a learner would hit/i)).not.toBeInTheDocument();
  });
});

describe("prerequisites", () => {
  it("adds one", async () => {
    let sent: { requires: string[] } | undefined;
    server.use(
      http.put(`${BASE}/admin/paths/${PATH}/modules/${MOD_B}/prerequisites`, async ({ request }) => {
        sent = (await request.json()) as typeof sent;
        return HttpResponse.json({ requires: 1 });
      }),
    );
    render(<CareerPaths />, { route: "/admin/paths" });

    await userEvent.selectOptions(
      await screen.findByLabelText(/add a prerequisite to js-functions/i),
      MOD_A,
    );

    await waitFor(() => expect(sent!.requires).toEqual([MOD_A]));
  });

  /**
   * **The loop message is the author's, not the database's.** §9: say what
   * happened, in their terms — the API names the path round the loop by slug.
   */
  it("shows the loop the API refused", async () => {
    server.use(
      http.put(`${BASE}/admin/paths/${PATH}/modules/${MOD_B}/prerequisites`, () =>
        HttpResponse.json(
          { error: "This connection creates a loop: js-functions → js-basics → js-functions" },
          { status: 400 },
        ),
      ),
    );
    render(<CareerPaths />, { route: "/admin/paths" });

    await userEvent.selectOptions(
      await screen.findByLabelText(/add a prerequisite to js-functions/i),
      MOD_A,
    );

    expect(await screen.findByRole("alert")).toHaveTextContent(/creates a loop/i);
  });

  it("names an existing prerequisite by title, not by id", async () => {
    path({
      skills: [
        {
          pathSkillId: "ps1",
          trackId: null,
          layer: "core",
          skillId: "s1",
          slug: "js",
          name: "JavaScript",
          modules: [
            module(MOD_A, "js-basics"),
            module(MOD_B, "js-functions", { requires: [MOD_A] }),
          ],
        },
      ],
    });
    render(<CareerPaths />, { route: "/admin/paths" });

    await screen.findByText("JavaScript");
    expect(screen.getByRole("button", { name: /remove/i })).toBeInTheDocument();
    expect(screen.queryByText(MOD_A)).not.toBeInTheDocument();
  });

  /** A module cannot require itself, so it is not offered. */
  it("does not offer a module as its own prerequisite", async () => {
    render(<CareerPaths />, { route: "/admin/paths" });

    const select = await screen.findByLabelText(/add a prerequisite to js-basics/i);
    const options = [...select.querySelectorAll("option")].map((o) => o.textContent);

    expect(options).not.toContain("js-basics");
    expect(options).toContain("js-functions");
  });
});

describe("certificate rules", () => {
  it("marks a module optional", async () => {
    let sent: { requiredForCertificate: boolean } | undefined;
    server.use(
      http.patch(
        `${BASE}/admin/paths/${PATH}/skills/ps1/modules/${MOD_A}`,
        async ({ request }) => {
          sent = (await request.json()) as typeof sent;
          return HttpResponse.json({ requiredForCertificate: false });
        },
      ),
    );
    render(<CareerPaths />, { route: "/admin/paths" });

    const boxes = await screen.findAllByRole("checkbox");
    await userEvent.click(boxes[0]);

    await waitFor(() => expect(sent!.requiredForCertificate).toBe(false));
  });

  it("says what the checkbox decides", async () => {
    render(<CareerPaths />, { route: "/admin/paths" });

    expect(
      (await screen.findAllByLabelText(/required for the certificate of completion/i)).length,
    ).toBe(2);
  });
});

describe("what it does not do", () => {
  /** §6.2's drag-and-drop placement still lives in the seed files. */
  it("says placement is not built", async () => {
    render(<CareerPaths />, { route: "/admin/paths" });

    expect(await screen.findByText(/still lives in the seed files/i)).toBeInTheDocument();
  });
});

describe("accessibility", () => {
  it("has no axe violations", async () => {
    path({ warnings: [{ trackId: "t1", technology: "Vue", skill: "State" }] });
    const { container } = render(<CareerPaths />, { route: "/admin/paths" });

    await screen.findByText("JavaScript");
    await expectNoAxeViolations(container);
  });
});
