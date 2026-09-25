import { describe, expect, it, beforeEach } from "vitest";
import { http, HttpResponse } from "msw";
import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { render } from "../../test/render";
import { server } from "../../test/server";
import { AiPanel } from "./AiPanel";

const BASE = "http://localhost:4000";
const OUTPUT = "33333333-3333-3333-3333-333333333333";

/** What the endpoint actually received, so the test can check the body. */
let sent: { reason?: string } | null = null;

beforeEach(() => {
  sent = null;
  server.use(
    http.post(`${BASE}/ai-outputs/:id/flags`, async ({ request }) => {
      sent = (await request.json()) as { reason?: string };
      return HttpResponse.json(
        { flag: { id: "f1", status: "open", createdAt: new Date().toISOString() } },
        { status: 201 },
      );
    }),
  );
});

describe("AiPanel", () => {
  /** §7: labelled as AI, carries a reason, and is flaggable — all three. */
  it("labels the output and offers the flag", () => {
    render(<AiPanel aiOutputId={OUTPUT}>I put you on the Frontend track.</AiPanel>);

    expect(screen.getByText("AI")).toBeInTheDocument();
    expect(screen.getByText("I put you on the Frontend track.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Is this wrong?" })).toBeEnabled();
  });

  it("sends the reason and says the flag landed", async () => {
    const user = userEvent.setup();
    render(<AiPanel aiOutputId={OUTPUT}>Frontend track.</AiPanel>);

    await user.click(screen.getByRole("button", { name: "Is this wrong?" }));
    await user.type(
      screen.getByLabelText("What is wrong with it?"),
      "I already know React.",
    );
    await user.click(screen.getByRole("button", { name: "Send flag" }));

    await waitFor(() => {
      expect(screen.getByText(/You flagged this/)).toBeInTheDocument();
    });
    expect(sent).toEqual({ reason: "I already know React." });
    expect(screen.queryByRole("button", { name: "Is this wrong?" })).not.toBeInTheDocument();
  });

  /** §12: focus moves into the form when it opens. */
  it("puts focus in the reason field", async () => {
    const user = userEvent.setup();
    render(<AiPanel aiOutputId={OUTPUT}>Frontend track.</AiPanel>);

    await user.click(screen.getByRole("button", { name: "Is this wrong?" }));
    await waitFor(() => {
      expect(screen.getByLabelText("What is wrong with it?")).toHaveFocus();
    });
  });

  /** §12: and returns to the control that opened it on close. */
  it("returns focus when the form is cancelled", async () => {
    const user = userEvent.setup();
    render(<AiPanel aiOutputId={OUTPUT}>Frontend track.</AiPanel>);

    await user.click(screen.getByRole("button", { name: "Is this wrong?" }));
    await user.click(screen.getByRole("button", { name: "Cancel" }));

    expect(screen.getByRole("button", { name: "Is this wrong?" })).toHaveFocus();
  });

  it("will not send an empty reason", async () => {
    const user = userEvent.setup();
    render(<AiPanel aiOutputId={OUTPUT}>Frontend track.</AiPanel>);

    await user.click(screen.getByRole("button", { name: "Is this wrong?" }));
    expect(screen.getByRole("button", { name: "Send flag" })).toBeDisabled();
    expect(sent).toBeNull();
  });

  /**
   * §9: explain and direct. The panel keeps the form open with what they
   * wrote still in it, so a failed send does not cost them the note.
   */
  it("keeps the reason when the send fails", async () => {
    server.use(
      http.post(`${BASE}/ai-outputs/:id/flags`, () =>
        HttpResponse.json({ error: "Say what is wrong with it." }, { status: 400 }),
      ),
    );
    const user = userEvent.setup();
    render(<AiPanel aiOutputId={OUTPUT}>Frontend track.</AiPanel>);

    await user.click(screen.getByRole("button", { name: "Is this wrong?" }));
    await user.type(screen.getByLabelText("What is wrong with it?"), "wrong track");
    await user.click(screen.getByRole("button", { name: "Send flag" }));

    await waitFor(() => {
      expect(screen.getByRole("alert")).toHaveTextContent("Say what is wrong with it.");
    });
    expect(screen.getByLabelText("What is wrong with it?")).toHaveValue("wrong track");
  });

  /** Nothing to point a flag at, so nothing is offered rather than offered broken. */
  it("offers no flag without an output id", () => {
    render(<AiPanel aiOutputId={null}>Frontend track.</AiPanel>);
    expect(screen.queryByRole("button", { name: "Is this wrong?" })).not.toBeInTheDocument();
  });

  it("shows an already-flagged output as flagged", () => {
    render(
      <AiPanel aiOutputId={OUTPUT} flagged>
        Frontend track.
      </AiPanel>,
    );
    expect(screen.getByText(/You flagged this/)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Is this wrong?" })).not.toBeInTheDocument();
  });

  it("takes a different label for code feedback", () => {
    render(
      <AiPanel aiOutputId={OUTPUT} label="AI feedback">
        Your loop starts at index 1.
      </AiPanel>,
    );
    expect(screen.getByText("AI feedback")).toBeInTheDocument();
  });
});
