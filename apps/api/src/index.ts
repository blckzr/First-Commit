import { createApp } from "./app.js";
import { config } from "./config.js";
import { pool } from "./db.js";

const app = createApp();

const server = app.listen(config.port, () => {
  console.log(`First Commit API listening on :${config.port} (${config.nodeEnv})`);
  console.log(`  allowing origin ${config.appOrigin}`);
  console.log(`  mail transport: ${app.locals.mailer.name}`);
  if (!config.workerSecret) {
    console.log("  WORKER_SECRET unset: the worker cannot announce finished jobs");
  }
});

/**
 * Render sends SIGTERM before replacing an instance. Finish in-flight requests
 * and release the pool rather than dropping connections mid-query.
 */
async function shutdown(signal: string) {
  console.log(`\n${signal} received, shutting down...`);
  server.close(async () => {
    await pool.end();
    console.log("Closed.");
    process.exit(0);
  });
  // Don't hang forever on a stuck connection.
  setTimeout(() => process.exit(1), 10_000).unref();
}

process.on("SIGTERM", () => void shutdown("SIGTERM"));
process.on("SIGINT", () => void shutdown("SIGINT"));
