/**
 * Runs before any test module, so `config.ts` finds what it validates for.
 *
 * These are placeholders: endpoint tests inject an in-memory pool and a
 * recording mailer, so nothing here reaches a real service.
 */
process.env.NODE_ENV ??= "test";
process.env.DATABASE_URL ??= "postgresql://localhost:6543/postgres";
process.env.SESSION_SECRET ??= "test-secret-not-used-for-anything-real";
process.env.APP_ORIGIN ??= "http://localhost:5173";
// Without this, /internal/events returns 404 before reaching the secret
// comparison, and that comparison would never be exercised by any test.
process.env.WORKER_SECRET ??= "test-worker-secret";
