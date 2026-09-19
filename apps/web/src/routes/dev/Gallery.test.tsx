import { describe, expect, it } from "vitest";
import { render, screen, within } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { Gallery } from "./Gallery";
import { expectNoAxeViolations } from "../../test/axe";

function renderGallery() {
  return render(
    <MemoryRouter>
      <Gallery />
    </MemoryRouter>,
  );
}

describe("Gallery", () => {
  /**
   * The gallery renders every component in every variant, so one axe pass over
   * it covers the whole set at once. This is the cheapest broad guard we have
   * against an accessibility regression in a component nobody is looking at.
   */
  it("has no axe violations across the whole component set", async () => {
    const { container } = renderGallery();
    await expectNoAxeViolations(container);
  }, 30_000);

  it("renders each section", () => {
    renderGallery();
    for (const title of ["Colour", "Contrast", "Type", "Shape and elevation", "Core", "Forms", "Learning", "Navigation"]) {
      expect(screen.getByRole("heading", { name: title, level: 2 })).toBeInTheDocument();
    }
  });

  /**
   * The table's ratios are not asserted here. jsdom does not resolve custom
   * properties from a stylesheet, so every row renders "—" under test. The
   * contrast values are gated by src/styles/contrast.test.ts, which reads
   * tokens.css from disk instead — that is the check that actually protects
   * design.md §12.
   */
  it("renders a contrast row for every pair it tracks", () => {
    renderGallery();
    const rows = within(screen.getByRole("table")).getAllByRole("row").slice(1);
    expect(rows.length).toBeGreaterThanOrEqual(17);
    expect(
      within(rows[0]).getAllByRole("cell")[0].textContent,
    ).toBe("Headings on a card");
  });
});
