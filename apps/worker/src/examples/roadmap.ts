/**
 * Generates one roadmap against the real database.
 *
 *   npm run try:roadmap -- <userId> <careerPathSlug>
 *   npm run try:roadmap -- <userId> <careerPathSlug> stub
 *
 * `stub` is a positional, not a flag, because **npm eats unknown `--flags`** in
 * a nested workspace run: `npm run try:roadmap -- a b --stub` reaches the
 * script as `a b`. A silently ignored flag is worse than none — this one would
 * have quietly called the model when you asked it not to. `--stub` still works
 * when running the file directly with tsx.
 *
 * Stubbing skips Ollama and uses the catalogue's own prerequisite-respecting
 * order as the plan. That is not a test of the model — it is a test of
 * everything around it: the catalogue query, the validator, and the writes. It
 * runs with no GPU, which is what makes the database half of this checkable
 * without a model loaded.
 *
 * Nothing here is a shortcut the worker takes. The stub plan goes through
 * exactly the same validator, and is rejected the same way if it is wrong.
 */
import { Pool } from "pg";
import { dbConfig } from "../config.js";
import { chatJson } from "../ollama.js";
import { RoadmapPlan } from "../schemas.js";
import { buildRoadmapMessages } from "../prompts/roadmap.js";
import { eligibleModules, loadCatalogue, type CatalogueModule } from "../roadmap/catalogue.js";
import { estimateWeeks, validateRoadmapPlan } from "../roadmap/validate.js";
import { applyRoadmapPlan } from "../roadmap/apply.js";

const positional = process.argv.slice(2).filter((a) => !a.startsWith("--"));
const [userId, pathSlug] = positional;
const stub = process.argv.includes("--stub") || positional[2] === "stub";

if (!userId || !pathSlug) {
  console.error("Usage: npm run try:roadmap -- <userId> <careerPathSlug> [stub]");
  process.exit(1);
}

const db = dbConfig();
const pool = new Pool({
  connectionString: db.databaseUrl,
  max: 1,
  ssl: { rejectUnauthorized: false },
});

try {
  const path = await pool.query<{ id: string }>(
    `select id from career_paths where slug = $1 and status = 'published'`,
    [pathSlug],
  );
  if (!path.rows[0]) throw new Error(`No published career path with slug "${pathSlug}"`);
  const careerPathId = path.rows[0].id;

  const catalogue = await loadCatalogue(pool, careerPathId, userId);
  const eligibleByTrack = new Map<string, CatalogueModule[]>(
    catalogue.tracks.map((t) => [t.id, eligibleModules(catalogue, t.id)]),
  );

  console.log(`\nCatalogue for ${catalogue.careerPathTitle}`);
  for (const track of catalogue.tracks) {
    const modules = eligibleByTrack.get(track.id) ?? [];
    console.log(`  ${track.title}: ${modules.length} modules eligible`);
  }
  console.log(
    `  learner: ${catalogue.learner.experienceLevel ?? "?"}, ${catalogue.learner.goal ?? "?"}, ` +
      `${catalogue.learner.weeklyHours ?? "?"}h/week, ${catalogue.learner.completedModuleIds.length} passed`,
  );

  let plan: RoadmapPlan;

  if (stub) {
    const track = catalogue.tracks[0];
    const modules = eligibleByTrack.get(track.id) ?? [];
    plan = {
      recommendedTrackId: track.id,
      skipModuleIds: [],
      orderedModuleIds: modules.map((m) => m.id),
      explanation:
        `This roadmap was built without the model, so this text is a stand-in. ` +
        `It covers the ${track.title} track in prerequisite order.`,
    };
    console.log(`\n  stub: using the catalogue order on ${track.title}, no model call`);
  } else {
    console.log(`\n  Asking the model...`);
    const response = await chatJson({
      schema: RoadmapPlan,
      messages: buildRoadmapMessages({ catalogue, eligibleByTrack }),
      temperature: 0.1,
      validate: (p) =>
        validateRoadmapPlan(p, {
          catalogue,
          eligible: eligibleByTrack.get(p.recommendedTrackId) ?? [],
        }),
    });
    plan = response.data;
    console.log(`  ${response.attempts} attempt(s), ${(response.durationMs / 1000).toFixed(1)}s`);
  }

  // The stub plan is checked too. A path whose own content is inconsistent
  // should fail here rather than reach the database.
  const error = validateRoadmapPlan(plan, {
    catalogue,
    eligible: eligibleByTrack.get(plan.recommendedTrackId) ?? [],
  });
  if (error) throw new Error(`Plan rejected: ${error}`);

  const track = catalogue.tracks.find((t) => t.id === plan.recommendedTrackId);
  const weeks = estimateWeeks(plan.orderedModuleIds, catalogue, catalogue.learner.weeklyHours);

  console.log(`\n  Track: ${track?.title}`);
  console.log(`  ${plan.orderedModuleIds.length} modules${weeks ? `, about ${weeks} weeks` : ""}`);
  console.log(`\n  ${plan.explanation}\n`);

  const byId = new Map(catalogue.modules.map((m) => [m.id, m]));
  for (const [i, id] of plan.orderedModuleIds.entries()) {
    console.log(`   ${String(i + 1).padStart(2)}. ${byId.get(id)?.title}`);
  }

  const roadmap = await pool.query<{ id: string }>(
    `select id from roadmaps where user_id = $1 and career_path_id = $2 order by created_at desc limit 1`,
    [userId, careerPathId],
  );
  if (!roadmap.rows[0]) {
    console.log("\n  No roadmap row for this learner — nothing written. Finish placement first.\n");
  } else {
    await applyRoadmapPlan(pool, {
      roadmapId: roadmap.rows[0].id,
      userId,
      catalogue,
      plan,
      estimatedWeeks: weeks,
    });
    console.log(`\n  ✓ Written to roadmap ${roadmap.rows[0].id}\n`);
  }
} catch (err) {
  console.error(`\n  ✗ ${(err as Error).message}\n`);
  process.exitCode = 1;
} finally {
  await pool.end();
}
