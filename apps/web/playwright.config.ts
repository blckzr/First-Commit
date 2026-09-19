import { defineConfig, devices } from "@playwright/test";

/**
 * design.md §11.4: "Every screen is checked at 360px, 768px, 1024px, and
 * 1440px widths, including resizing live between breakpoints to confirm
 * content reflows without losing state."
 *
 * Those four widths are the projects below. The live-resize case is a test of
 * its own in e2e/responsive.spec.ts, because it needs one context that changes
 * size rather than four fixed ones.
 */
export default defineConfig({
  testDir: "./e2e",
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  reporter: process.env.CI ? "github" : [["list"]],

  use: {
    baseURL: "http://localhost:5173",
    trace: "on-first-retry",
  },

  projects: [
    { name: "360 (sm)", use: { ...devices["Desktop Chrome"], viewport: { width: 360, height: 780 } } },
    { name: "768 (md)", use: { ...devices["Desktop Chrome"], viewport: { width: 768, height: 900 } } },
    { name: "1024 (lg)", use: { ...devices["Desktop Chrome"], viewport: { width: 1024, height: 900 } } },
    { name: "1440 (lg)", use: { ...devices["Desktop Chrome"], viewport: { width: 1440, height: 900 } } },
  ],

  webServer: {
    command: "npm run dev",
    url: "http://localhost:5173",
    reuseExistingServer: !process.env.CI,
    timeout: 60_000,
  },
});
