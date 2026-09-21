import { describe, expect, it } from "vitest";
import { screen } from "@testing-library/react";
import { Route, Routes } from "react-router";
import { render } from "../test/render";
import { api, ADMIN, LEARNER } from "../test/server";
import {
  RedirectIfSignedIn,
  RequireAdmin,
  RequireAuth,
  RequireLearner,
  RequireOnboardingStep,
} from "./guards";

/**
 * Guards decide what renders, not what data comes back (AGENT.md §6 rule 3).
 * These tests say what a learner is shown; the API's own tests say what a
 * learner is allowed.
 */

const ONBOARDING = ["about", "target", "placement", "generating"];

/** A whole onboarding tree behind the guards, each page naming itself. */
function tree() {
  return (
    <Routes>
      <Route element={<RequireAuth />}>
        <Route element={<RequireLearner needsOnboarding />}>
          <Route element={<RequireOnboardingStep />}>
            {ONBOARDING.map((step) => (
              <Route key={step} path={`/onboarding/${step}`} element={<p>page: {step}</p>} />
            ))}
          </Route>
        </Route>
        <Route element={<RequireLearner />}>
          <Route path="/app" element={<p>page: app</p>} />
        </Route>
        <Route element={<RequireAdmin />}>
          <Route path="/admin" element={<p>page: admin</p>} />
        </Route>
      </Route>
      <Route path="/login" element={<p>page: login</p>} />
    </Routes>
  );
}

const at = (step: string | null, route: string) => {
  api.signedIn(LEARNER, step);
  render(tree(), { route });
};

describe("RequireOnboardingStep", () => {
  /** §5.4: "sent back to the first unfinished step". */
  it.each([
    ["about", "/onboarding/placement", "about"],
    ["about", "/onboarding/generating", "about"],
    ["target", "/onboarding/generating", "target"],
  ])("from %s, %s lands on %s", async (step, asked, shown) => {
    at(step, asked);
    expect(await screen.findByText(`page: ${shown}`)).toBeInTheDocument();
  });

  /** Back is how §5.4 says earlier answers get changed, so it must not bounce. */
  it.each([
    ["placement", "/onboarding/about"],
    ["placement", "/onboarding/target"],
    ["generating", "/onboarding/placement"],
  ])("from %s, going back to %s is allowed", async (step, asked) => {
    at(step, asked);
    const page = asked.replace("/onboarding/", "");
    expect(await screen.findByText(`page: ${page}`)).toBeInTheDocument();
  });

  it("lets a learner stay on their own step", async () => {
    at("target", "/onboarding/target");
    expect(await screen.findByText("page: target")).toBeInTheDocument();
  });
});

describe("RequireLearner", () => {
  /** A finished learner has no business on an onboarding page. */
  it("sends a finished learner from onboarding to the app", async () => {
    at(null, "/onboarding/about");
    expect(await screen.findByText("page: app")).toBeInTheDocument();
  });

  /** And an unfinished one is pulled back to where they stopped. */
  it("sends an unfinished learner from the app to their step", async () => {
    at("target", "/app");
    expect(await screen.findByText("page: target")).toBeInTheDocument();
  });
});

/**
 * §13.6: "Guards render nothing while the session loads, so protected content
 * never flashes."
 *
 * Each of these is mounted **alone**, without `RequireAuth` above it. In the
 * router that never happens — which is exactly why it is worth asserting. A
 * guard that treats an unloaded session as an answer redirects on a null it has
 * not earned, and `RequireLearner` did: it sent a learner mid-onboarding to
 * `/app` before the session arrived.
 */
describe("every guard waits for the session", () => {
  const alone = (guard: React.ReactElement) =>
    render(
      <Routes>
        <Route element={guard}>
          <Route path="/here" element={<p>protected</p>} />
        </Route>
        <Route path="/app" element={<p>page: app</p>} />
        <Route path="/admin" element={<p>page: admin</p>} />
        <Route path="/onboarding/about" element={<p>page: about</p>} />
      </Routes>,
      { route: "/here" },
    );

  it.each([
    ["RequireLearner", <RequireLearner key="l" />],
    ["RequireLearner needsOnboarding", <RequireLearner key="o" needsOnboarding />],
    ["RequireAdmin", <RequireAdmin key="a" />],
    ["RequireOnboardingStep", <RequireOnboardingStep key="s" />],
  ])("%s redirects nowhere while loading", (_name, guard) => {
    api.signedIn(LEARNER, "about");
    alone(guard);

    expect(screen.getByRole("status")).toBeInTheDocument();
    expect(screen.queryByText(/^page: /)).not.toBeInTheDocument();
    expect(screen.queryByText("protected")).not.toBeInTheDocument();
  });
});

/**
 * §4.3: "Anyone signed in | `/login` or `/signup` | Sent to their own area."
 *
 * The rule that was missing. Without it a signed-in learner opening the site is
 * shown a log-in page as though they were a stranger, and can sign in as
 * somebody else without ever signing out — which reads as "the site does not
 * hold my session", when it was holding it all along.
 */
describe("RedirectIfSignedIn", () => {
  const atLogin = () =>
    render(
      <Routes>
        <Route element={<RedirectIfSignedIn />}>
          <Route path="/login" element={<p>page: login</p>} />
        </Route>
        <Route path="/app" element={<p>page: app</p>} />
        <Route path="/admin" element={<p>page: admin</p>} />
        {ONBOARDING.map((step) => (
          <Route key={step} path={`/onboarding/${step}`} element={<p>page: {step}</p>} />
        ))}
      </Routes>,
      { route: "/login" },
    );

  it("sends a signed-in learner to the app", async () => {
    api.signedIn(LEARNER, null);
    atLogin();
    expect(await screen.findByText("page: app")).toBeInTheDocument();
  });

  /** Their own area is where they stopped, not a generic landing. */
  it("sends a learner mid-onboarding back to their step", async () => {
    api.signedIn(LEARNER, "target");
    atLogin();
    expect(await screen.findByText("page: target")).toBeInTheDocument();
  });

  it("sends a signed-in admin to the admin area", async () => {
    api.signedIn(ADMIN, null);
    atLogin();
    expect(await screen.findByText("page: admin")).toBeInTheDocument();
  });

  /** And it still lets the people who need it through. */
  it("shows the page to a signed-out visitor", async () => {
    api.signedOut();
    atLogin();
    expect(await screen.findByText("page: login")).toBeInTheDocument();
  });

  it("shows nothing while the session loads", () => {
    api.signedIn(LEARNER, null);
    atLogin();
    expect(screen.getByRole("status")).toBeInTheDocument();
    expect(screen.queryByText("page: login")).not.toBeInTheDocument();
  });
});

describe("RequireAuth and RequireAdmin", () => {
  it("sends a signed-out visitor to log in", async () => {
    api.signedOut();
    render(tree(), { route: "/app" });
    expect(await screen.findByText("page: login")).toBeInTheDocument();
  });

  it("renders nothing of the page while the session is still loading", () => {
    api.signedIn(LEARNER, null);
    render(tree(), { route: "/app" });
    // The guard shows a loading status, never the protected content.
    expect(screen.getByRole("status")).toBeInTheDocument();
    expect(screen.queryByText("page: app")).not.toBeInTheDocument();
  });

  it("keeps a learner out of the admin area", async () => {
    at(null, "/admin");
    expect(await screen.findByText("page: app")).toBeInTheDocument();
    expect(screen.queryByText("page: admin")).not.toBeInTheDocument();
  });

  it("keeps an admin out of the learner area", async () => {
    api.signedIn(ADMIN, null);
    render(tree(), { route: "/app" });
    expect(await screen.findByText("page: admin")).toBeInTheDocument();
  });
});
