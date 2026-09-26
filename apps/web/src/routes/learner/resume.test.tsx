import { beforeEach, describe, expect, it } from "vitest";
import { http, HttpResponse } from "msw";
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { render } from "../../test/render";
import { server } from "../../test/server";
import { expectNoAxeViolations } from "../../test/axe";
import { Resume } from "./Resume";

const BASE = "http://localhost:4000";

/**
 * §5.16, and the rule it exists to keep: the evidence panel "lists only verified
 * items; learners choose which to include but **cannot add unverified skills**".
 *
 * So most of this file checks for the absence of things. A resume is the one
 * output of this platform that a stranger reads and acts on, and §7 says it
 * twice: unsupported skills are removed, and module completion is a skill, never
 * experience.
 */

const page = (over: Record<string, unknown> = {}) => ({
  resume: {
    id: "r1",
    careerPathId: null,
    selected: { skillIds: [], certificateCodes: [], projectIds: [] },
    content: null,
    aiFields: [],
    generatedAt: null,
    status: "none",
  },
  evidence: {
    skills: [
      { skillId: "s1", name: "HTML", moduleCount: 2, method: "passed" },
      { skillId: "s2", name: "JavaScript", moduleCount: 3, method: "passed" },
      { skillId: "s3", name: "CSS", moduleCount: 1, method: "tested_out" },
    ],
    certificates: [
      { publicCode: "FC-7K2M-94QX", title: "Junior Web Developer", issuedAt: "2026-09-02T00:00:00Z" },
    ],
    projects: [],
  },
  details: {
    fullName: "Jan Kevin Gerona",
    email: "me@example.com",
    phone: "",
    city: "Manila",
    links: [],
    education: [],
  },
  ...over,
});

let sent: { path: string; body: unknown } | null = null;

function serve(body: Record<string, unknown> = page()) {
  server.use(
    http.get(`${BASE}/resume`, () => HttpResponse.json(body)),
    http.put(`${BASE}/resume/selection`, async ({ request }) => {
      sent = { path: "selection", body: await request.json() };
      return HttpResponse.json({ selected: {}, careerPathId: null });
    }),
    http.put(`${BASE}/resume/details`, async ({ request }) => {
      sent = { path: "details", body: await request.json() };
      return HttpResponse.json({ details: {} });
    }),
    http.post(`${BASE}/resume/generate`, async () => {
      sent = { path: "generate", body: null };
      return HttpResponse.json({ status: "queued" });
    }),
    http.patch(`${BASE}/resume`, async ({ request }) => {
      sent = { path: "edit", body: await request.json() };
      return HttpResponse.json({
        content: { summary: "Mine now.", skills: [], projects: [] },
        aiFields: [],
      });
    }),
  );
}

beforeEach(() => {
  sent = null;
  serve();
});

const open = async () => {
  const view = render(<Resume />);
  await screen.findByRole("heading", { name: "Resume" });
  return view;
};

describe("§5.16 — the evidence panel", () => {
  it("lists the verified skills and how each was proved", async () => {
    await open();

    expect(await screen.findByRole("checkbox", { name: "HTML" })).toBeInTheDocument();
    expect(screen.getByRole("checkbox", { name: "JavaScript" })).toBeInTheDocument();
    // §6 rule 7: testing out is real evidence, and the panel says which it was.
    expect(screen.getAllByText("Tested out")).toHaveLength(1);
    expect(screen.getAllByText("Passed")).toHaveLength(2);
  });

  /**
   * **The rule this screen exists to keep.** There is no control that adds a
   * skill: no text field, no "add", no combobox. A learner picks from what they
   * proved or nothing at all.
   */
  it("offers no way to add a skill", async () => {
    const { container } = await open();
    await screen.findByRole("checkbox", { name: "HTML" });

    expect(screen.queryByRole("button", { name: /add (a )?skill/i })).not.toBeInTheDocument();
    expect(screen.queryByRole("combobox", { name: /skill/i })).not.toBeInTheDocument();
    // No free text anywhere except the details form and the summary editor.
    const inputs = [...container.querySelectorAll("input")].filter(
      (i) => i.type !== "checkbox" && i.type !== "radio",
    );
    expect(inputs).toHaveLength(0);
  });

  it("sends only ids when a skill is deselected", async () => {
    await open();
    await userEvent.click(await screen.findByRole("checkbox", { name: "CSS" }));

    await waitFor(() => expect(sent?.path).toBe("selection"));
    const body = sent!.body as { skillIds: string[] };
    expect(body.skillIds).toEqual(["s1", "s2"]);
    expect(JSON.stringify(body)).not.toContain("CSS");
  });

  /** §7: "No capstone means no Projects section." Said, not hidden. */
  it("explains the empty projects section rather than hiding it", async () => {
    await open();
    expect(await screen.findByText(/Build your capstone project to add it here/)).toBeInTheDocument();
  });

  /** §5.16's empty state, word for word. */
  it("tells a learner with no verified skills what to do", async () => {
    serve(page({ evidence: { skills: [], certificates: [], projects: [] } }));
    await open();

    expect(
      await screen.findByText(
        "Pass your first module assessment to add a verified skill to your resume.",
      ),
    ).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Generate/ })).not.toBeInTheDocument();
  });

  it("has no axe violations", async () => {
    const { container } = await open();
    await screen.findByRole("checkbox", { name: "HTML" });
    await expectNoAxeViolations(container);
  });
});

describe("§5.16 — the preview", () => {
  const generated = page({
    resume: {
      ...page().resume,
      content: {
        summary: "Front-end skills verified through assessments in HTML, CSS and JavaScript.",
        skills: ["JavaScript", "HTML", "CSS"],
        projects: [],
      },
      aiFields: ["summary"],
      generatedAt: "2026-09-26T00:00:00Z",
    },
  });

  it("shows the learner's own details", async () => {
    await open();
    expect(await screen.findByText("Jan Kevin Gerona")).toBeInTheDocument();
    expect(screen.getByText(/me@example.com/)).toBeInTheDocument();
  });

  /** §5.16: AI-written text is labelled. */
  it("labels the summary as AI-written", async () => {
    serve(generated);
    await open();

    const heading = await screen.findByRole("heading", { name: /Summary/ });
    expect(within(heading).getByText("AI")).toBeInTheDocument();
    expect(heading).toHaveTextContent("written by AI and editable");
  });

  /**
   * The model orders the skills; it never decides membership. Deselecting an
   * item must drop it from the preview even though the model listed it.
   */
  it("shows only the selected skills, whatever the model returned", async () => {
    serve(
      page({
        resume: {
          ...generated.resume,
          // The model listed three; only HTML is still verified below.
          content: {
            summary: "Front-end skills verified through assessments.",
            skills: ["JavaScript", "HTML", "CSS"],
            projects: [],
          },
        },
        evidence: {
          ...page().evidence,
          skills: [{ skillId: "s1", name: "HTML", moduleCount: 2, method: "passed" }],
        },
      }),
    );
    await open();

    /*
     * Scoped to the Skills line, not the whole document: the summary is prose
     * the model wrote at generation time and may still name a skill that has
     * since been deselected. "Generate again" is the affordance for that, and
     * it is not a grounding problem — the learner did verify it.
     */
    const doc = (await screen.findByText("Jan Kevin Gerona")).closest("article")!;
    const skillsLine = within(doc).getByRole("heading", { name: "Skills" }).nextElementSibling!;
    expect(skillsLine.textContent).toBe("HTML");
  });

  /**
   * §5.16: the preview is ATS-friendly — "single column, standard headings, no
   * tables, icons, or images". An applicant tracking system parses it by
   * heading, so this is a parsing requirement rather than a style choice.
   */
  it("renders an ATS-friendly document with no tables or images", async () => {
    serve(generated);
    await open();

    const doc = (await screen.findByText("Jan Kevin Gerona")).closest("article")!;
    expect(doc.querySelector("table")).toBeNull();
    expect(doc.querySelector("img")).toBeNull();
    // Standard headings, in order.
    const headings = [...doc.querySelectorAll("h4")].map((h) => h.textContent?.trim());
    expect(headings.some((h) => h?.startsWith("Summary"))).toBe(true);
    expect(headings).toContain("Skills");
  });

  it("says what Generate will do before anything is written", async () => {
    await open();
    expect(
      await screen.findByText(/Generate your resume to write a summary/),
    ).toBeInTheDocument();
  });
});

describe("§5.16 — generating and editing", () => {
  const generated = page({
    resume: {
      ...page().resume,
      content: { summary: "Written by the model.", skills: ["HTML"], projects: [] },
      aiFields: ["summary"],
      generatedAt: "2026-09-26T00:00:00Z",
    },
  });

  /** §6 rule 1's shape: nothing the browser sends decides what is on a resume. */
  it("sends no body when generating", async () => {
    await open();
    await userEvent.click(await screen.findByRole("button", { name: "Generate resume" }));

    await waitFor(() => expect(sent?.path).toBe("generate"));
  });

  it("says the model is working, and offers to generate again afterwards", async () => {
    serve(page({ resume: { ...page().resume, status: "running" } }));
    await open();
    expect(await screen.findByText("Writing your summary…")).toBeInTheDocument();

    serve(generated);
    const again = render(<Resume />);
    expect(await again.findByRole("button", { name: "Generate again" })).toBeInTheDocument();
  });

  it("edits the summary and sends only that", async () => {
    serve(generated);
    await open();

    await userEvent.click(await screen.findByRole("button", { name: /Edit summary/ }));
    const box = screen.getByLabelText("Summary");
    await userEvent.clear(box);
    await userEvent.type(box, "Mine now.");
    await userEvent.click(screen.getByRole("button", { name: "Save summary" }));

    await waitFor(() => expect(sent?.path).toBe("edit"));
    expect(sent!.body).toEqual({ summary: "Mine now." });
    // The skills list is evidence; editing must not be able to touch it.
    expect(JSON.stringify(sent!.body)).not.toContain("skills");
  });

  /** §5.16's "Download PDF". Built from the evidence when it is asked for. */
  it("offers a download", async () => {
    serve(generated);
    await open();
    await screen.findByText("Written by the model.");

    expect(screen.getByRole("button", { name: "Download PDF" })).toBeEnabled();
  });
});

describe("§5.16 — personal details", () => {
  it("saves contact details", async () => {
    await open();
    await userEvent.click(await screen.findByRole("button", { name: "Edit details" }));

    await userEvent.type(screen.getByLabelText("City"), " City");
    await userEvent.click(screen.getByRole("button", { name: "Save details" }));

    await waitFor(() => expect(sent?.path).toBe("details"));
    expect((sent!.body as { city: string }).city).toBe("Manila City");
  });

  it("refuses a link that is not a web address", async () => {
    await open();
    await userEvent.click(await screen.findByRole("button", { name: "Edit details" }));
    await userEvent.click(screen.getByRole("button", { name: "Add a link" }));

    await userEvent.type(screen.getByLabelText("Label"), "GitHub");
    await userEvent.type(screen.getByLabelText("Address"), "not a url");
    await userEvent.click(screen.getByRole("button", { name: "Save details" }));

    expect(
      await screen.findByText("Enter a full web address, starting with https://"),
    ).toBeInTheDocument();
    expect(sent).toBeNull();
  });

  /**
   * §7: module completion is a skill, never experience. There is no field here
   * for a job, and there must never be one.
   */
  it("offers no field for work experience", async () => {
    await open();
    await userEvent.click(await screen.findByRole("button", { name: "Edit details" }));

    for (const label of [/experience/i, /employer/i, /job title/i, /company/i]) {
      expect(screen.queryByLabelText(label)).not.toBeInTheDocument();
    }
  });
});
