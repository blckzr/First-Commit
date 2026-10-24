import { beforeEach, describe, expect, it } from "vitest";
import { http, HttpResponse } from "msw";
import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { render } from "../../test/render";
import { server } from "../../test/server";
import { expectNoAxeViolations } from "../../test/axe";
import { Certificates } from "./Certificates";

const BASE = "http://localhost:4000";
const ID = "ffffffff-ffff-4fff-8fff-ffffffffffff";

/**
 * design.md §6.7 — Certificates (admin).
 *
 * The screen's job is lookup and withdrawal. What is asserted here is mostly
 * what it **cannot** do: there is no issue button (§6.7 and §6 rule 1), nothing
 * can be withdrawn without a reason, and an already-revoked certificate offers
 * no second revoke — which matches the endpoint, where a repeat is a 404 rather
 * than a second log entry.
 */

const certificate = (over: Record<string, unknown> = {}) => ({
  id: ID,
  publicCode: "FC-7Q2M-4KPX",
  type: "completion",
  title: "Junior Web Developer",
  recipientName: "Jan Kevin Gerona",
  status: "valid",
  issuedAt: "2026-10-18T08:00:00Z",
  revokedAt: null,
  revokedReason: null,
  learner: { id: "u1", email: "learner@example.com" },
  ...over,
});

function listing(certificates: Record<string, unknown>[], seen?: (url: URL) => void) {
  server.use(
    http.get(`${BASE}/admin/certificates`, ({ request }) => {
      seen?.(new URL(request.url));
      return HttpResponse.json({ certificates });
    }),
  );
}

beforeEach(() => {
  listing([certificate()]);
});

describe("the lookup", () => {
  it("shows the recipient, the type, the code and the learner's email", async () => {
    render(<Certificates />, { route: "/admin/certificates" });

    expect(await screen.findByText("Jan Kevin Gerona")).toBeInTheDocument();
    expect(screen.getByText(/certificate of completion/i)).toBeInTheDocument();
    expect(screen.getByText("FC-7Q2M-4KPX")).toBeInTheDocument();
    expect(screen.getByText("learner@example.com")).toBeInTheDocument();
  });

  it("sends what was typed to the API", async () => {
    let asked: URL | undefined;
    listing([certificate()], (url) => (asked = url));
    render(<Certificates />, { route: "/admin/certificates" });

    await userEvent.type(await screen.findByLabelText(/search by name/i), "FC-7Q2M");

    await waitFor(() => expect(asked?.searchParams.get("q")).toBe("FC-7Q2M"));
  });

  it("links the public verification page", async () => {
    render(<Certificates />, { route: "/admin/certificates" });

    const link = await screen.findByRole("link", { name: /open public page/i });
    expect(link).toHaveAttribute("href", "/verify/FC-7Q2M-4KPX");
  });

  it("says so when a search matches nothing", async () => {
    listing([]);
    render(<Certificates />, { route: "/admin/certificates" });

    await userEvent.type(await screen.findByLabelText(/search by name/i), "nobody");

    expect(await screen.findByText(/nothing matches that search/i)).toBeInTheDocument();
  });

  it("says so when none have been issued", async () => {
    listing([]);
    render(<Certificates />, { route: "/admin/certificates" });

    expect(await screen.findByText(/no certificates have been issued/i)).toBeInTheDocument();
  });

  /** §8: status is text as well as colour. */
  it("names the status rather than only colouring it", async () => {
    listing([certificate({ status: "revoked", revokedAt: "2026-10-20T08:00:00Z" })]);
    render(<Certificates />, { route: "/admin/certificates" });

    // Twice on purpose: the badge, and the line carrying the date and reason.
    expect(await screen.findAllByText(/^Revoked/)).toHaveLength(2);
  });
});

describe("what an admin cannot do", () => {
  /**
   * §6.7: "Certificates are issued automatically when requirements are met;
   * there is no manual issue button." §6 rule 1 is the reason, and this is the
   * assertion that the screen never grows one.
   */
  it("offers no way to issue a certificate", async () => {
    render(<Certificates />, { route: "/admin/certificates" });
    await screen.findByText("Jan Kevin Gerona");

    expect(screen.queryByRole("button", { name: /issue/i })).not.toBeInTheDocument();
    expect(screen.getByText(/no manual issue button/i)).toBeInTheDocument();
  });

  /** The endpoint filters on `status = 'valid'`; the screen agrees with it. */
  it("offers no revoke on a certificate that is already revoked", async () => {
    listing([certificate({ status: "revoked", revokedReason: "The repository was copied." })]);
    render(<Certificates />, { route: "/admin/certificates" });

    await screen.findByText("Revoked");
    expect(screen.queryByRole("button", { name: /^revoke$/i })).not.toBeInTheDocument();
    expect(screen.getByText(/the repository was copied/i)).toBeInTheDocument();
  });
});

describe("revoking", () => {
  it("will not revoke without a reason", async () => {
    render(<Certificates />, { route: "/admin/certificates" });

    await userEvent.click(await screen.findByRole("button", { name: /^revoke$/i }));

    expect(screen.getByRole("button", { name: /revoke certificate/i })).toBeDisabled();
  });

  it("sends the reason", async () => {
    let sent: unknown;
    server.use(
      http.patch(`${BASE}/admin/certificates/${ID}/revoke`, async ({ request }) => {
        sent = await request.json();
        return HttpResponse.json({ status: "revoked" });
      }),
    );
    render(<Certificates />, { route: "/admin/certificates" });

    await userEvent.click(await screen.findByRole("button", { name: /^revoke$/i }));
    await userEvent.type(screen.getByLabelText(/why is this being withdrawn/i), "Name misspelled.");
    await userEvent.click(screen.getByRole("button", { name: /revoke certificate/i }));

    await waitFor(() => expect(sent).toEqual({ reason: "Name misspelled." }));
  });

  it("surfaces a refusal from the API", async () => {
    server.use(
      http.patch(`${BASE}/admin/certificates/${ID}/revoke`, () =>
        HttpResponse.json({ error: "That certificate is not valid." }, { status: 404 }),
      ),
    );
    render(<Certificates />, { route: "/admin/certificates" });

    await userEvent.click(await screen.findByRole("button", { name: /^revoke$/i }));
    await userEvent.type(screen.getByLabelText(/why is this being withdrawn/i), "x");
    await userEvent.click(screen.getByRole("button", { name: /revoke certificate/i }));

    expect(await screen.findByRole("alert")).toHaveTextContent(/not valid/i);
  });
});

describe("accessibility", () => {
  it("has no axe violations, with the revoke form open", async () => {
    const { container } = render(<Certificates />, { route: "/admin/certificates" });

    await userEvent.click(await screen.findByRole("button", { name: /^revoke$/i }));
    await screen.findByLabelText(/why is this being withdrawn/i);
    await expectNoAxeViolations(container);
  });
});
