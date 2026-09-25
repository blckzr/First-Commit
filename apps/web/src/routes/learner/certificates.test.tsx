import { beforeEach, describe, expect, it } from "vitest";
import { http, HttpResponse } from "msw";
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Route, Routes } from "react-router";
import { render } from "../../test/render";
import { server } from "../../test/server";
import { expectNoAxeViolations } from "../../test/axe";
import { Certificates } from "./Certificates";
import { Verify } from "../public/Verify";

const BASE = "http://localhost:4000";
const CODE = "FC-7K2M-94QX";

const certificate = {
  publicCode: CODE,
  type: "completion" as const,
  title: "Junior Web Developer, Frontend track with React",
  recipientName: "Jan Kevin Gerona",
  skills: ["CSS", "Git", "HTML", "JavaScript", "React"],
  status: "valid" as const,
  issuedAt: "2026-09-02T10:00:00Z",
  revokedAt: null,
  roadmapId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
  verifyPath: `/verify/${CODE}`,
};

const listing = (over: Record<string, unknown> = {}) =>
  server.use(
    http.get(`${BASE}/certificates`, () =>
      HttpResponse.json({
        certificates: [],
        progress: [],
        projectCertificate: { available: false, reason: "capstone-not-built" },
        ...over,
      }),
    ),
  );

beforeEach(() => listing());

const openList = async () => {
  const view = render(<Certificates />);
  await screen.findByRole("heading", { name: "Certificates" });
  return view;
};

describe("§5.15 — the learner's certificates", () => {
  it("shows an earned certificate with its id and skills", async () => {
    listing({ certificates: [certificate] });
    await openList();

    expect(await screen.findByText("Certificate of Completion")).toBeInTheDocument();
    expect(
      screen.getByRole("heading", { name: "Junior Web Developer, Frontend track with React" }),
    ).toBeInTheDocument();
    expect(screen.getByText(CODE)).toBeInTheDocument();
    expect(screen.getByText(/Skills verified: CSS, Git, HTML, JavaScript, React/)).toBeInTheDocument();
  });

  /** §5.15's empty state, word for word. */
  it("tells a learner with none what to do", async () => {
    await openList();

    expect(
      await screen.findByText("Finish your roadmap to earn your first certificate."),
    ).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /View roadmap/ })).toHaveAttribute(
      "href",
      "/app/roadmaps",
    );
  });

  it("links View at the same page a stranger would open", async () => {
    listing({ certificates: [certificate] });
    await openList();

    expect(await screen.findByRole("link", { name: "View" })).toHaveAttribute(
      "href",
      `/verify/${CODE}`,
    );
  });

  it("copies the verification link", async () => {
    const copied: string[] = [];
    Object.assign(navigator, {
      clipboard: { writeText: (t: string) => (copied.push(t), Promise.resolve()) },
    });
    listing({ certificates: [certificate] });
    await openList();

    await userEvent.click(await screen.findByRole("button", { name: "Copy verification link" }));

    await waitFor(() => expect(screen.getByRole("button", { name: "Link copied" })).toBeInTheDocument());
    expect(copied[0]).toContain(`/verify/${CODE}`);
  });

  /**
   * §5.15 offers "Download PDF". The PDF is generated to Supabase Storage and
   * served through a signed URL, and none of that is built — so the control is
   * absent rather than dead. Four of those were removed earlier in this project;
   * this test stops a fifth appearing.
   */
  it("offers no download until the PDF exists", async () => {
    listing({ certificates: [certificate] });
    await openList();

    await screen.findByText("Certificate of Completion");
    expect(screen.queryByRole("button", { name: /Download/i })).not.toBeInTheDocument();
    expect(screen.queryByRole("link", { name: /Download/i })).not.toBeInTheDocument();
  });

  /** §8: status is icon + text + colour, never colour alone. */
  it("says in words that a revoked certificate is revoked", async () => {
    listing({
      certificates: [{ ...certificate, status: "revoked", revokedAt: "2026-09-20T10:00:00Z" }],
    });
    await openList();

    // A "Revoked" section heading *and* a badge on the card — both say it.
    expect(await screen.findByRole("heading", { name: "Revoked" })).toBeInTheDocument();
    const card = screen
      .getByRole("heading", { name: "Junior Web Developer, Frontend track with React" })
      .closest("li") as HTMLElement;
    expect(within(card).getByText("Revoked")).toBeInTheDocument();
    // Nothing to copy or view: it no longer verifies.
    expect(screen.queryByRole("button", { name: /Copy/ })).not.toBeInTheDocument();
  });

  it("shows the project certificate as locked, with an honest reason", async () => {
    listing({ certificates: [certificate] });
    await openList();

    expect(await screen.findByRole("heading", { name: "Project Certificate" })).toBeInTheDocument();
    expect(screen.getByText(/Capstones aren't built yet/)).toBeInTheDocument();
  });

  describe("a roadmap that has not earned one", () => {
    it("shows how far along it is", async () => {
      listing({
        progress: [
          { roadmapId: "r1", title: "Junior Web Developer", required: 16, completed: 6, blockedBy: null },
        ],
      });
      await openList();

      expect(await screen.findByText("6 of 16 modules passed")).toBeInTheDocument();
    });

    /** §9: "0 of 0 modules" is true and useless. Say why instead. */
    it("explains an empty roadmap rather than showing 0 of 0", async () => {
      listing({
        progress: [
          { roadmapId: "r1", title: "Junior Web Developer", required: 0, completed: 0, blockedBy: "no-modules" },
        ],
      });
      await openList();

      expect(await screen.findByText(/no modules yet/)).toBeInTheDocument();
      expect(screen.queryByText("0 of 0 modules passed")).not.toBeInTheDocument();
    });

    it("explains an unanswered technology choice", async () => {
      listing({
        progress: [
          { roadmapId: "r1", title: "Junior Web Developer, Frontend track", required: 12, completed: 12, blockedBy: "technology-not-chosen" },
        ],
      });
      await openList();

      expect(await screen.findByText(/Choose your framework/)).toBeInTheDocument();
    });
  });

  it("has no axe violations", async () => {
    listing({
      certificates: [certificate],
      progress: [
        { roadmapId: "r2", title: "Junior Data Analyst", required: 14, completed: 3, blockedBy: null },
      ],
    });
    const { container } = await openList();
    await screen.findByText("Certificate of Completion");
    await expectNoAxeViolations(container);
  });
});

describe("§5.15 — the public verification page", () => {
  const verification = (result: Record<string, unknown>) =>
    server.use(http.get(`${BASE}/verify/:code`, () => HttpResponse.json({ result })));

  const openVerify = () =>
    render(
      <Routes>
        <Route path="/verify/:code" element={<Verify />} />
      </Routes>,
      { route: `/verify/${CODE}` },
    );

  it("confirms a valid certificate", async () => {
    verification({
      status: "valid",
      code: CODE,
      type: "completion",
      recipientName: "Jan Kevin Gerona",
      title: "Junior Web Developer, Frontend track with React",
      issuedAt: "2026-09-02T10:00:00Z",
      skills: ["HTML", "CSS", "JavaScript", "Git", "React"],
      projectTitle: null,
      repository: null,
    });
    openVerify();

    expect(await screen.findByText("Valid certificate")).toBeInTheDocument();
    expect(screen.getByText("Jan Kevin Gerona")).toBeInTheDocument();
    expect(screen.getByText(CODE)).toBeInTheDocument();
    expect(screen.getByText(/Skills verified: HTML, CSS, JavaScript, Git, React/)).toBeInTheDocument();
  });

  /**
   * §4.3 puts this in the public area. A stranger — an employer, most likely —
   * opens it, and must not be shown an account they do not have.
   */
  it("offers nothing to sign into and no way into the app", async () => {
    verification({
      status: "valid",
      code: CODE,
      type: "completion",
      recipientName: "Jan Kevin Gerona",
      title: "Junior Web Developer",
      issuedAt: "2026-09-02T10:00:00Z",
      skills: [],
      projectTitle: null,
      repository: null,
    });
    const { container } = openVerify();
    await screen.findByText("Valid certificate");

    expect(screen.queryByRole("navigation")).not.toBeInTheDocument();
    expect(screen.queryByRole("link", { name: /log in|sign up|dashboard/i })).not.toBeInTheDocument();
    expect(container.querySelector('a[href^="/app"]')).toBeNull();
  });

  /** §5.15: the date, and never the reason. */
  it("reports a revocation with its date and nothing else", async () => {
    verification({ status: "revoked", code: CODE, revokedAt: "2026-09-20T10:00:00Z" });
    openVerify();

    expect(await screen.findByText(/This certificate was revoked on/)).toBeInTheDocument();
    expect(screen.queryByText("Jan Kevin Gerona")).not.toBeInTheDocument();
    expect(screen.queryByText(/Skills verified/)).not.toBeInTheDocument();
  });

  /** §5.15's wording for an unknown id, and §9: explain and direct. */
  it("says an unknown id was not found and what to do", async () => {
    verification({ status: "not-found", code: "FC-0000-0000" });
    openVerify();

    expect(await screen.findByText(/No certificate found with ID FC-0000-0000/)).toBeInTheDocument();
    expect(screen.getByText("Check the ID and try again.")).toBeInTheDocument();
  });

  it("says so when the check itself fails", async () => {
    server.use(http.get(`${BASE}/verify/:code`, () => HttpResponse.error()));
    openVerify();

    expect(await screen.findByText(/couldn't check this certificate/)).toBeInTheDocument();
  });

  it("has no axe violations", async () => {
    verification({
      status: "valid",
      code: CODE,
      type: "project",
      recipientName: "Jan Kevin Gerona",
      title: "Junior Web Developer, Frontend track with React",
      issuedAt: "2026-09-20T10:00:00Z",
      skills: ["HTML", "React"],
      projectTitle: "Task tracker",
      repository: "github.com/you/task-tracker",
    });
    const { container } = openVerify();
    await screen.findByText("Valid certificate");
    await expectNoAxeViolations(container);
  });
});
