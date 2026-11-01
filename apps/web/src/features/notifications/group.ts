import type { Notification } from "../../api/notifications";

export interface NotificationGroup {
  heading: string;
  items: Notification[];
}

/**
 * §5.17's three groups, by the reader's clock.
 *
 * "This week" is the last seven days rather than the calendar week, because a
 * calendar week makes Monday morning show an empty "This week" and bury
 * Sunday's notification under "Earlier".
 *
 * **`nowMs` is a parameter so the boundaries can be tested at a chosen hour.**
 * The screen never passes it. The tests do, because the interesting cases are
 * local midnight and the seven-day edge, and a test that waits to run at 00:30
 * to exercise one of them is sampling the boundary rather than testing it —
 * which is how a fixture built as "an hour ago" passed for a week and then
 * failed. Faking the system clock instead breaks MSW and TanStack Query, which
 * need real timers.
 */
export function group(items: Notification[], nowMs: number = Date.now()): NotificationGroup[] {
  const now = nowMs;
  const startOfToday = new Date(nowMs);
  startOfToday.setHours(0, 0, 0, 0);

  const today: Notification[] = [];
  const week: Notification[] = [];
  const earlier: Notification[] = [];

  for (const item of items) {
    const at = new Date(item.createdAt).getTime();
    if (at >= startOfToday.getTime()) today.push(item);
    else if (now - at < 7 * 24 * 60 * 60 * 1000) week.push(item);
    else earlier.push(item);
  }

  return [
    { heading: "Today", items: today },
    { heading: "This week", items: week },
    { heading: "Earlier", items: earlier },
  ].filter((section) => section.items.length > 0);
}
