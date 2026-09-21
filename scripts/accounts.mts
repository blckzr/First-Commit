#!/usr/bin/env node
/**
 * Creates the development accounts you sign in with while building.
 *
 *   npm run db:accounts
 *   npm run db:accounts -- --password "something else"
 *   npm run db:accounts -- reset
 *
 * **This is the sanctioned way to make an admin.** AGENT.md §6 rule 8: "No
 * endpoint updates `users.role`. The first admin is set by running SQL
 * directly." Sign-up always creates a learner, so without this there is no way
 * to reach `/admin` at all.
 *
 * Passwords are hashed with the same argon2id function the API uses, so these
 * accounts log in through the real path — no test-only branch, nothing that
 * exists in development and not in production.
 *
 * **It refuses to run against production.** These are known-password accounts
 * whose whole purpose is being easy to get into; that is exactly what must
 * never exist on a deployed database.
 */
import { createInterface } from "node:readline/promises";
import pg from "pg";
// The API's own hashing, not a copy of it — if the argon2id parameters are
// ever tuned, these accounts are hashed the same way and keep working.
import { hashPassword } from "../apps/api/src/auth/passwords.js";

const args = process.argv.slice(2);
const passwordArg = args.indexOf("--password");
const password = passwordArg >= 0 ? args[passwordArg + 1] : "first-commit-dev";

/**
 * A positional, not a flag: npm strips unknown `--flags` in a nested workspace
 * run, and a silently ignored `--reset` would be a delete that looked like it
 * happened and did not.
 */
const reset = args.includes("reset") || args.includes("--reset");

if (process.env.NODE_ENV === "production") {
  console.error(
    "\n  Refusing to run: NODE_ENV is production.\n\n" +
      "  These accounts have a known password. They belong on a development\n" +
      "  database and nowhere else.\n",
  );
  process.exit(1);
}

const url = process.env.DATABASE_URL;
if (!url) {
  console.error(
    "\n  DATABASE_URL is not set. Put your connection string in apps/api/.env,\n" +
      "  then run:\n\n    npm run db:accounts\n",
  );
  process.exit(1);
}

/**
 * Three accounts, because the three states are different to look at:
 * an admin, a learner who has not started, and one mid-roadmap.
 */
const ACCOUNTS = [
  {
    email: "admin@firstcommit.test",
    fullName: "Admin Account",
    role: "admin",
    note: "the /admin area",
  },
  {
    email: "learner@firstcommit.test",
    fullName: "New Learner",
    role: "learner",
    onboardingStep: "about",
    note: "starts at onboarding, so you can walk the whole flow",
  },
  {
    email: "student@firstcommit.test",
    fullName: "Jan Kevin Gerona",
    role: "learner",
    onboardingStep: "about",
    note: "a second learner, for checking one cannot see the other's data",
  },
];

const client = new pg.Client({
  connectionString: url,
  ssl:
    url.includes("localhost") || url.includes("127.0.0.1")
      ? false
      : { rejectUnauthorized: false },
});

/**
 * Puts a development learner back to their first day.
 *
 * **Only ever for the `@firstcommit.test` accounts**, and only from this
 * script, which refuses to run in production. It deletes real evidence —
 * completions, attempts, roadmaps — which is precisely what AGENT.md §6 rule 5
 * forbids anywhere near a learner who earned it. Nothing in the API can do
 * this, and nothing should.
 *
 * Order matters: `certificates` and `capstone_projects` hold
 * `on delete restrict` references to a roadmap, so they go first or the delete
 * is refused.
 */
async function resetLearner(id: string): Promise<Record<string, number>> {
  const counts: Record<string, number> = {};
  const wipe = async (label: string, sql: string) => {
    const r = await client.query(sql, [id]);
    if (r.rowCount) counts[label] = r.rowCount;
  };

  await wipe("certificates", "delete from certificates where user_id = $1");
  await wipe("capstone projects", "delete from capstone_projects where user_id = $1");
  await wipe("roadmaps", "delete from roadmaps where user_id = $1");
  await wipe("completions", "delete from module_completions where user_id = $1");
  await wipe("enrolments", "delete from module_enrollments where user_id = $1");
  await wipe("lesson progress", "delete from lesson_progress where user_id = $1");
  await wipe("quiz attempts", "delete from assessment_attempts where user_id = $1");
  await wipe("code submissions", "delete from code_submissions where user_id = $1");
  await wipe("placement results", "delete from placement_results where user_id = $1");
  await wipe("AI outputs", "delete from ai_outputs where user_id = $1");
  await wipe("AI jobs", "delete from ai_jobs where user_id = $1");
  await wipe("notifications", "delete from notifications where user_id = $1");

  await client.query(
    `update learner_profiles
        set onboarding_step = 'about',
            experience_level = null,
            goal = null,
            weekly_hours = null,
            survey_answers = '{}',
            updated_at = now()
      where user_id = $1`,
    [id],
  );

  return counts;
}

async function upsertAccount(
  account: (typeof ACCOUNTS)[number],
  passwordHash: string,
): Promise<{ id: string; existed: boolean }> {
  const existing = await client.query<{ id: string }>(
    "select id from users where lower(email) = lower($1)",
    [account.email],
  );

  const id: string = existing.rows[0]
    ? (
        await client.query<{ id: string }>(
          `update users
              set password_hash = $1,
                  full_name = $2,
                  role = $3,
                  status = 'active',
                  email_verified_at = coalesce(email_verified_at, now())
            where id = $4
            returning id`,
          [passwordHash, account.fullName, account.role, existing.rows[0].id],
        )
      ).rows[0].id
    : (
        await client.query<{ id: string }>(
          `insert into users (email, password_hash, full_name, role, status, email_verified_at)
           values ($1, $2, $3, $4, 'active', now())
           returning id`,
          [account.email, passwordHash, account.fullName, account.role],
        )
      ).rows[0].id;

  // Verified on purpose: the verification link goes to the console transport in
  // development, and clicking through it every time proves nothing.

  if (account.role === "learner") {
    await client.query(
      `insert into learner_profiles (user_id, onboarding_step)
       values ($1, $2)
       on conflict (user_id) do update set onboarding_step = excluded.onboarding_step`,
      [id, account.onboardingStep ?? "about"],
    );
  }

  // Signing in again should be a clean slate, not a resumed session.
  await client.query("delete from sessions where user_id = $1", [id]);

  return { id, existed: Boolean(existing.rows[0]) };
}

try {
  await client.connect();

  const target = new URL(url.replace(/^postgres(ql)?:\/\//, "https://"));
  console.log(`\nDevelopment accounts on ${target.hostname}\n`);

  /**
   * `NODE_ENV=production` is refused outright above. This is for the ambiguous
   * case: a remote database with no stated environment, which might be someone's
   * deployment. An explicit `development` — or `--yes` — says it is not.
   *
   * It only asks when someone is there to answer. A non-interactive run with no
   * `--yes` stops rather than hanging on a prompt nobody will see.
   */
  const remote = !url.includes("localhost") && !url.includes("127.0.0.1");
  const declared = (process.env.NODE_ENV ?? "").toLowerCase() === "development";
  const confirmed = args.includes("--yes");

  if (remote && !declared && !confirmed) {
    if (!process.stdin.isTTY) {
      console.error(
        "  This is a remote database and NODE_ENV is not `development`.\n" +
          "  Re-run with --yes if it is safe to create known-password accounts on it.\n",
      );
      process.exit(1);
    }
    const rl = createInterface({ input: process.stdin, output: process.stdout });
    const answer = await rl.question(
      "  This is a remote database. Create known-password accounts on it? [y/N] ",
    );
    rl.close();
    if (answer.trim().toLowerCase() !== "y") {
      console.log("\n  Nothing was written.\n");
      process.exit(0);
    }
    console.log("");
  }

  const passwordHash = await hashPassword(password);

  for (const account of ACCOUNTS) {
    const { id, existed } = await upsertAccount(account, passwordHash);
    console.log(
      `  ${existed ? "updated" : "created"}  ${account.email.padEnd(26)} ${account.role.padEnd(7)}  ${account.note}`,
    );

    if (reset && account.role === "learner") {
      const counts = await resetLearner(id);
      const removed = Object.entries(counts)
        .map(([label, n]) => `${n} ${label}`)
        .join(", ");
      console.log(`            reset to onboarding${removed ? ` — removed ${removed}` : ""}`);
    }
  }

  console.log(`\n  Password for all three: ${password}\n`);
  console.log("  Sign in at http://localhost:5173/login\n");
} catch (err) {
  console.error(`\n  ✗ ${err.message}\n`);
  process.exitCode = 1;
} finally {
  await client.end();
}
