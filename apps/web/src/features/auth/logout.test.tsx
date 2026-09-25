import { beforeEach, describe, expect, it } from "vitest";
import { http, HttpResponse } from "msw";
import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Route, Routes, useLocation } from "react-router";
import { render } from "../../test/render";
import { api, server, LEARNER } from "../../test/server";
import { LearnerShell } from "../../app/LearnerShell";

const BASE = "http://localhost:4000";

/** How many times the API was asked to end the session. */
let calls = 0;

/** Reports where the router ended up — MemoryRouter never touches the URL bar. */
function Where() {
  return <span data-testid="where">{useLocation().pathname}</span>;
}

beforeEach(() => {
  calls = 0;
  api.signedIn();
  server.use(
    http.post(`${BASE}/auth/logout`, () => {
      calls += 1;
      return new HttpResponse(null, { status: 204 });
    }),
    http.get(`${BASE}/home`, () => HttpResponse.json({ home: null })),
  );
});

const openShell = async () => {
  const view = render(
    <Routes>
      <Route path="/app" element={<LearnerShell />}>
        <Route index element={<Where />} />
      </Route>
      <Route path="/login" element={<Where />} />
    </Routes>,
    { route: "/app" },
  );
  await screen.findByRole("button", { name: /Log out/ });
  return view;
};

describe("§6.3 — signing out", () => {
  /**
   * The gap this closes: `authApi.logOut()` existed and nothing called it, so a
   * learner could not leave their own account from the interface.
   */
  it("is offered in the profile menu", async () => {
    await openShell();
    expect(screen.getByRole("button", { name: /Log out/ })).toBeEnabled();
  });

  it("asks the API to end the session", async () => {
    await openShell();
    await userEvent.click(screen.getByRole("button", { name: /Log out/ }));

    await waitFor(() => expect(calls).toBe(1));
  });

  it("lands on the log in page", async () => {
    await openShell();
    await userEvent.click(screen.getByRole("button", { name: /Log out/ }));

    await waitFor(() => {
      expect(screen.getByTestId("where")).toHaveTextContent("/login");
    });
  });

  /**
   * §13.6: the cache is cleared on log out, so the next person at the same
   * computer sees nothing of the last one. Asserted through the cache itself —
   * the name being gone from the screen would also be true if the shell had
   * merely unmounted.
   */
  it("clears the query cache", async () => {
    const { client } = await openShell();
    expect(client.getQueryData(["session"])).toBeTruthy();

    await userEvent.click(screen.getByRole("button", { name: /Log out/ }));

    await waitFor(() => {
      expect(client.getQueryCache().getAll()).toHaveLength(0);
    });
  });

  /**
   * A learner who clicked Log out must end up signed out even if the request
   * failed. Leaving them looking at their own account because the network was
   * down is the worse outcome.
   */
  it("signs out anyway when the request fails", async () => {
    server.use(
      http.post(`${BASE}/auth/logout`, () => HttpResponse.error()),
    );
    const { client } = await openShell();

    await userEvent.click(screen.getByRole("button", { name: /Log out/ }));

    await waitFor(() => {
      expect(screen.getByTestId("where")).toHaveTextContent("/login");
    });
    expect(client.getQueryCache().getAll()).toHaveLength(0);
  });

  it("does not send a second request while the first is in flight", async () => {
    await openShell();
    const button = screen.getByRole("button", { name: /Log out/ });

    await userEvent.click(button);
    await userEvent.click(button).catch(() => {});

    await waitFor(() => expect(calls).toBe(1));
  });

  /** §4.2 keeps the profile menu keyboard-operable; log out is part of it. */
  it("is reachable with the keyboard", async () => {
    await openShell();
    const button = screen.getByRole("button", { name: /Log out/ });

    button.focus();
    expect(button).toHaveFocus();
    await userEvent.keyboard("{Enter}");

    await waitFor(() => expect(calls).toBe(1));
  });

  /**
   * The menu renders before `GET /auth/me` resolves — Log out does not depend
   * on knowing who you are — so this waits rather than reading it straight
   * after the button appears.
   */
  it("shows who is signed in beside it", async () => {
    await openShell();
    expect(await screen.findByText(LEARNER.email)).toBeInTheDocument();
  });
});
