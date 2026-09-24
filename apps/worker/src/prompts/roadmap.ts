import type { ChatMessage } from "../ollama.js";
import type { Catalogue, CatalogueModule } from "../roadmap/catalogue.js";

/**
 * The Roadmap AI prompt.
 *
 * AGENT.md §7: "Prompts are versioned in `ai_prompts`, one active per
 * component, and the version is recorded on each job so evaluation results map
 * to an exact prompt. Never change a prompt in place without a new version
 * row."
 *
 * **Bump `PROMPT_VERSION` whenever `SYSTEM` changes.** The worker registers
 * this text under that version on startup and refuses to run if the database
 * already holds different text for the same number — which is what "never
 * change a prompt in place" means in practice, rather than a rule people
 * remember to follow.
 */
export const PROMPT_VERSION = 2;

export const SYSTEM = `You plan learning roadmaps for First Commit, a platform for people learning to program for the first time.

You are given a catalogue of modules an admin has published, and what is known about one learner. You choose a track, decide the order, and explain your reasoning.

Rules:
- Use only the module ids and track ids from the catalogue. Never invent one.
- Include every core module, and every module of the track you choose.
- A module must come after everything it requires. The catalogue is already listed in an order that satisfies this, so you may keep it.
- Do not include technology modules. The learner chooses their framework later, and those modules are added then.
- Never leave a module out. Placement does not remove modules from a roadmap: a learner who proved a skill at placement already has a completion for those modules, and they belong on the roadmap marked as passed rather than missing from it.
- Recommend the track that fits the learner's stated goal and experience. Say why in the explanation.
- The explanation is two or three sentences, spoken to the learner as "you". Plain, specific, no cheerleading. Mention the track you chose and what happens at the technology decision.
- Never state that the learner has passed, failed or mastered anything. You are planning what they will learn, not judging what they have done.`;

export interface RoadmapPromptInput {
  catalogue: Catalogue;
  /** Per track id, the modules a roadmap on that track may contain, in a valid order. */
  eligibleByTrack: Map<string, CatalogueModule[]>;
}

/** How a rating reads in a sentence, rather than as a slug. */
const RATING_WORDS: Record<string, string> = {
  new: "new to them",
  seen: "seen it but not used it",
  with_help: "can use it with help",
  comfortable: "comfortable with it",
};

function describeLearner(catalogue: Catalogue): string {
  const { learner } = catalogue;
  const experience =
    {
      none: "has never written code",
      some: "has tried a bit — a tutorial or two",
      comfortable: "can build small things on their own",
    }[learner.experienceLevel ?? ""] ?? "did not say how much code they have written";

  const goal =
    {
      company_job: "wants a job at a company",
      freelance: "wants freelance or client work",
      undecided: "is not sure what they are working toward yet",
    }[learner.goal ?? ""] ?? "did not say what they are working toward";

  const hours = learner.weeklyHours
    ? `${learner.weeklyHours} hours a week`
    : "did not say how many hours a week they have";

  /**
   * Placement is a set of self-ratings per skill, and the score of any check
   * the learner then sat. It decides **order**, never membership — passing a
   * check already wrote the completions, so a module they proved is listed
   * under `completedModuleIds` below.
   */
  const ratings = (learner.placement as { ratings?: Record<string, string> }).ratings ?? {};
  const placement = Object.keys(ratings).length
    ? `The learner rates themselves, per skill: ${Object.entries(ratings)
        .map(([skill, rating]) => `${skill} — ${RATING_WORDS[rating] ?? rating}`)
        .join("; ")}. Put what they are least sure of earlier.`
    : "No placement ratings recorded. Assume nothing is already known.";

  const passed = catalogue.learner.completedModuleIds.length
    ? `Already passed, at placement or on another roadmap: ${catalogue.learner.completedModuleIds.join(", ")}. Keep these on the roadmap — the chart shows them as passed.`
    : "Nothing passed yet.";

  return [`The learner ${experience}, ${goal}, and has ${hours}.`, placement, passed].join("\n");
}

function describeModule(module: CatalogueModule, catalogue: Catalogue): string {
  const byId = new Map(catalogue.modules.map((m) => [m.id, m]));
  const requires = module.requires
    .map((id) => byId.get(id)?.title)
    .filter(Boolean)
    .join(", ");

  return [
    `  - ${module.id}`,
    `    ${module.title} (${module.skillName}, ${module.estimatedHours}h)`,
    `    ${module.description}`,
    requires ? `    requires: ${requires}` : null,
    module.requiredForCertificate ? "    required for certificate" : "    optional",
  ]
    .filter(Boolean)
    .join("\n");
}

export function buildRoadmapMessages(input: RoadmapPromptInput): ChatMessage[] {
  const { catalogue, eligibleByTrack } = input;

  const tracks = catalogue.tracks
    .map((track) => {
      const modules = eligibleByTrack.get(track.id) ?? [];
      const core = modules.filter((m) => m.layer === "core");
      const concept = modules.filter((m) => m.layer === "concept");
      const decisions = track.decisions.map((d) => d.title).join(", ") || "none";

      return `Track ${track.id} — ${track.title}
  ${track.description}
  Who it suits: ${track.audience}
  Technology decision: ${decisions}

  Core modules (every learner on this path takes these, in this order):
${core.map((m) => describeModule(m, catalogue)).join("\n")}

  ${track.title} modules:
${concept.map((m) => describeModule(m, catalogue)).join("\n")}`;
    })
    .join("\n\n");

  return [
    { role: "system", content: SYSTEM },
    {
      role: "user",
      content: `Career path: ${catalogue.careerPathTitle}

${describeLearner(catalogue)}

Catalogue
=========
${tracks}

Choose one track. Return every core module and every module of that track, in an order where each one comes after everything it requires.`,
    },
  ];
}
