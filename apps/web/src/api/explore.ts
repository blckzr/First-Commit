import { z } from "zod";
import { apiRequest } from "./client.js";

/**
 * Explore modules (design.md §5.13).
 *
 * **The status on a row is the server's answer, not a calculation here.**
 * Whether a module is passed, in progress or locked depends on
 * `module_completions` and `module_prerequisites`, and §6 rule 7 makes the
 * first of those cross-roadmap. A screen that worked it out from a roadmap it
 * happened to be holding would be right about one roadmap and wrong about the
 * learner.
 */

const Named = z.object({ id: z.string(), name: z.string() });

const ExploreModule = z.object({
  id: z.string(),
  title: z.string(),
  description: z.string(),
  kind: z.string(),
  estimatedHours: z.number(),
  skill: Named,
  /** Only a `technology` module has one — §5.13's badge "(if any)". */
  technology: Named.nullable(),
  /** §5.13's path badges, and §2.1's "Also in: Data". */
  paths: z.array(z.string()),
  progress: z.enum(["passed", "in_progress", "not_started"]),
  method: z.string().nullable(),
  score: z.number().nullable(),
  /**
   * Titles of modules that must be passed first; empty once they are.
   *
   * Not a boolean, because §9's copy names the module — "Pass JavaScript basics
   * to unlock this module." A flag would force the screen to say "Locked",
   * which tells the learner nothing they can act on.
   */
  locked: z.array(z.string()),
  onRoadmap: z.boolean(),
});
export type ExploreModule = z.infer<typeof ExploreModule>;

const ExplorePage = z.object({
  modules: z.array(ExploreModule),
  total: z.number(),
  page: z.number(),
  pageSize: z.number(),
});
export type ExplorePage = z.infer<typeof ExplorePage>;

const FilterOptions = z.object({
  skills: z.array(Named),
  technologies: z.array(Named),
  careerPaths: z.array(Named),
});
export type FilterOptions = z.infer<typeof FilterOptions>;

export interface ExploreQuery {
  q?: string;
  skillId?: string;
  technologyId?: string;
  careerPathId?: string;
  status?: string;
  page?: number;
}

export const exploreKey = (query: ExploreQuery) => ["explore", query] as const;
export const exploreFiltersKey = ["explore", "filters"] as const;

function search(query: ExploreQuery): string {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) {
    // An empty filter is absent rather than blank: `?skillId=` is a value the
    // API then has to decide how to ignore.
    if (value !== undefined && value !== "" && value !== 1) params.set(key, String(value));
  }
  const text = params.toString();
  return text ? `?${text}` : "";
}

export const exploreApi = {
  list: (query: ExploreQuery, signal?: AbortSignal) =>
    apiRequest(`/explore${search(query)}`, { schema: ExplorePage, signal }),

  filters: (signal?: AbortSignal) =>
    apiRequest("/explore/filters", { schema: FilterOptions, signal }),

  /**
   * §5.13's "add a module to a roadmap".
   *
   * Sends a module id and nothing else. `added: false` is a success — the
   * module is already there, which is what the learner wanted — so the screen
   * reports it rather than treating it as an error.
   */
  addToRoadmap: (roadmapId: string, moduleId: string) =>
    apiRequest(`/roadmaps/${roadmapId}/items`, {
      method: "POST",
      body: { moduleId },
      schema: z.object({
        added: z.boolean(),
        reason: z.string().optional(),
        title: z.string(),
      }),
    }),
};
