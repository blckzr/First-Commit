import { z } from "zod";
import { apiRequest } from "./client.js";

/**
 * Home (design.md §5.6), validated at the boundary.
 *
 * `continue` is a discriminated union on `kind` with one member today. §5.6
 * says the capstone replaces the lesson panel with a milestone one, so when
 * that arrives the exhaustive switch in the screen stops compiling until it is
 * rendered — which is the point of shaping it this way now.
 */
const ContinuePanel = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("module"),
    moduleId: z.string(),
    moduleTitle: z.string(),
    skillTitle: z.string(),
    estimatedHours: z.number(),
    lessonNumber: z.number().nullable(),
    lessonCount: z.number(),
    lessonId: z.string().nullable(),
    started: z.boolean(),
  }),
]);
export type ContinuePanel = z.infer<typeof ContinuePanel>;

const HomeUpdate = z.object({
  id: z.string(),
  kind: z.enum(["ai_added", "module_updated"]),
  text: z.string(),
  moduleId: z.string(),
  fromAi: z.boolean(),
});
export type HomeUpdate = z.infer<typeof HomeUpdate>;

export const HomeSummary = z.object({
  roadmap: z
    .object({
      id: z.string(),
      careerPathTitle: z.string(),
      trackTitle: z.string(),
      passedCount: z.number(),
      totalCount: z.number(),
    })
    .nullable(),
  continue: ContinuePanel.nullable(),
  updates: z.array(HomeUpdate),
});
export type HomeSummary = z.infer<typeof HomeSummary>;

const HomeResponse = z.object({ home: HomeSummary });

export const homeApi = {
  get: (signal?: AbortSignal) =>
    apiRequest("/home", { schema: HomeResponse, signal }).then((r) => r.home),
};
