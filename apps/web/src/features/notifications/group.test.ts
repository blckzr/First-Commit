import { describe, expect, it } from "vitest";
import { group } from "./group";
import type { Notification } from "../../api/notifications";

/**
 * §5.17's three groups, tested at chosen hours.
 *
 * **Why this is a separate unit test.** The screen test renders through MSW and
 * TanStack Query, which need real timers, so the clock cannot be faked there.
 * And a fixture written as "an hour ago" does not test the Today boundary — it
 * samples it, and passes or fails depending on the hour the suite runs at. That
 * is exactly what happened: these groups passed for a week and then failed on a
 * run that started between midnight and 01:00.
 *
 * `group()` takes `nowMs` for this reason and the screen never passes it.
 */

const at = (iso: string): Notification => ({
  id: iso,
  type: "account_notice",
  title: iso,
  body: "",
  link: null,
  data: {},
  readAt: null,
  createdAt: iso,
});

/** Local time, so the comparison matches `setHours(0,0,0,0)` in any zone. */
const local = (y: number, m: number, d: number, h: number, min = 0) =>
  new Date(y, m - 1, d, h, min, 0, 0);

const headings = (items: Notification[], now: Date) =>
  group(items, now.getTime()).map((section) => section.heading);

describe("the Today boundary", () => {
  /** The case that broke: just after midnight, "an hour ago" is yesterday. */
  it("puts 00:10 in Today and 22:30 the night before in This week", () => {
    const now = local(2026, 11, 2, 0, 30);

    const result = group(
      [
        at(local(2026, 11, 2, 0, 10).toISOString()),
        at(local(2026, 11, 1, 22, 30).toISOString()),
      ],
      now.getTime(),
    );

    expect(result.map((s) => s.heading)).toEqual(["Today", "This week"]);
    expect(result[0].items).toHaveLength(1);
    expect(result[1].items).toHaveLength(1);
  });

  it("counts one minute past midnight as Today", () => {
    const now = local(2026, 11, 2, 0, 30);
    expect(headings([at(local(2026, 11, 2, 0, 1).toISOString())], now)).toEqual(["Today"]);
  });

  it("counts one minute before midnight as This week", () => {
    const now = local(2026, 11, 2, 0, 30);
    expect(headings([at(local(2026, 11, 1, 23, 59).toISOString())], now)).toEqual([
      "This week",
    ]);
  });

  /** Late in the day, the same two timestamps are both Today / This week. */
  it("holds at the other end of the day", () => {
    const now = local(2026, 11, 2, 23, 50);
    expect(headings([at(local(2026, 11, 2, 0, 1).toISOString())], now)).toEqual(["Today"]);
  });
});

describe("the This week boundary", () => {
  /**
   * Seven days, not the calendar week — a calendar week shows Monday morning an
   * empty "This week" with Sunday's notification under "Earlier".
   */
  it("counts six days ago as This week", () => {
    const now = local(2026, 11, 2, 12);
    expect(headings([at(local(2026, 10, 27, 12).toISOString())], now)).toEqual(["This week"]);
  });

  it("counts eight days ago as Earlier", () => {
    const now = local(2026, 11, 2, 12);
    expect(headings([at(local(2026, 10, 25, 12).toISOString())], now)).toEqual(["Earlier"]);
  });

  /**
   * A Monday, with Sunday's notification. The calendar-week reading would put
   * this under "Earlier", which is the bug the seven-day window avoids.
   * 2026-11-02 is a Monday.
   */
  it("keeps Sunday's notification in This week when read on Monday", () => {
    const monday = local(2026, 11, 2, 9);
    expect(headings([at(local(2026, 11, 1, 20).toISOString())], monday)).toEqual([
      "This week",
    ]);
  });
});

describe("empty groups", () => {
  it("omits a group with nothing in it", () => {
    const now = local(2026, 11, 2, 12);
    expect(headings([at(local(2026, 11, 2, 9).toISOString())], now)).toEqual(["Today"]);
  });

  it("returns nothing at all for no notifications", () => {
    expect(group([], local(2026, 11, 2, 12).getTime())).toEqual([]);
  });

  it("keeps the three groups in order", () => {
    const now = local(2026, 11, 2, 12);
    const result = headings(
      [
        at(local(2026, 10, 1, 12).toISOString()),
        at(local(2026, 11, 2, 9).toISOString()),
        at(local(2026, 10, 29, 12).toISOString()),
      ],
      now,
    );

    expect(result).toEqual(["Today", "This week", "Earlier"]);
  });
});
