import type { Response } from "express";
import type { Pool } from "pg";

/**
 * Server-sent events (docs/database-schema.md §8.2 step 5, §8.3 step 5).
 *
 * The worker writes a result to the database, then posts to `/internal/events`
 * so the API can push it to that learner's open streams. The post is a
 * best-effort hint, not the source of truth — if it never arrives, the sweep
 * below finds the row anyway. That is why the worker treats a failed notify as
 * non-fatal.
 *
 * **State lives in one process.** Render runs a single free instance, so a
 * connection registry in memory is correct today. If the API is ever scaled to
 * two instances, a learner connected to instance A will not receive a notify
 * delivered to instance B — the sweep would still find it, just later. Moving
 * to Postgres `LISTEN/NOTIFY` is not the fix, because the pooler does not
 * support it; a shared bus would be.
 */

export interface StreamCursor {
  createdAt: Date;
  id: string;
}

interface Connection {
  userId: string;
  res: Response;
  cursor: StreamCursor | null;
}

export interface OutputRow {
  id: string;
  source_type: string;
  source_id: string;
  content: unknown;
  created_at: Date;
}

const HEARTBEAT_MS = 25_000;
const SWEEP_MS = 10_000;
const CATCH_UP_LIMIT = 50;

export class EventHub {
  private readonly connections = new Set<Connection>();
  private heartbeat: NodeJS.Timeout | null = null;
  private sweep: NodeJS.Timeout | null = null;

  constructor(private readonly pool: Pool) {}

  /** Open streams, for tests and for the health surface. */
  get size(): number {
    return this.connections.size;
  }

  /**
   * Registers a stream. Returns a function that closes it.
   *
   * `cursor` comes from the `Last-Event-ID` header the browser replays on
   * reconnect, so anything written while the connection was down is delivered
   * rather than lost.
   */
  add(userId: string, res: Response, cursor: StreamCursor | null): () => void {
    const connection: Connection = { userId, res, cursor };
    this.connections.add(connection);
    this.start();

    return () => {
      this.connections.delete(connection);
      if (this.connections.size === 0) this.stop();
    };
  }

  /** Sends one event to every stream this user has open. */
  send(userId: string, event: string, row: OutputRow): void {
    for (const connection of this.connections) {
      if (connection.userId !== userId) continue;
      writeEvent(connection.res, event, row);
      connection.cursor = { createdAt: row.created_at, id: row.id };
    }
  }

  /**
   * Pushes everything this user has waiting since each stream's cursor.
   *
   * Called when the worker notifies us, and on a timer as the backstop for a
   * notify that never arrived.
   */
  async flush(userId: string): Promise<void> {
    for (const connection of this.connections) {
      if (connection.userId !== userId) continue;

      const rows = await this.since(userId, connection.cursor);
      for (const row of rows) {
        writeEvent(connection.res, "ai_output", row);
        connection.cursor = { createdAt: row.created_at, id: row.id };
      }
    }
  }

  /**
   * Rows newer than the cursor.
   *
   * Ordered by `(created_at, id)` and compared the same way, because two rows
   * can share a timestamp — comparing on the timestamp alone would silently
   * drop one of them.
   */
  private async since(userId: string, cursor: StreamCursor | null): Promise<OutputRow[]> {
    if (!cursor) {
      const { rows } = await this.pool.query<OutputRow>(
        `select id, source_type, source_id, content, created_at
           from ai_outputs
          where user_id = $1
          order by created_at desc, id desc
          limit $2`,
        [userId, CATCH_UP_LIMIT],
      );
      return rows.reverse();
    }

    const { rows } = await this.pool.query<OutputRow>(
      `select id, source_type, source_id, content, created_at
         from ai_outputs
        where user_id = $1
          and (created_at > $2 or (created_at = $2 and id > $3))
        order by created_at, id
        limit $4`,
      [userId, cursor.createdAt, cursor.id, CATCH_UP_LIMIT],
    );
    return rows;
  }

  /** Closes every stream. Called on shutdown. */
  closeAll(): void {
    for (const connection of this.connections) {
      connection.res.end();
    }
    this.connections.clear();
    this.stop();
  }

  private start(): void {
    this.heartbeat ??= setInterval(() => {
      // A comment line keeps proxies from closing an idle connection, and
      // tells the browser the stream is still alive.
      for (const connection of this.connections) connection.res.write(": ping\n\n");
    }, HEARTBEAT_MS).unref();

    this.sweep ??= setInterval(() => {
      const users = new Set([...this.connections].map((c) => c.userId));
      for (const userId of users) {
        this.flush(userId).catch((err: unknown) => {
          console.error("[events] sweep failed:", (err as Error).message);
        });
      }
    }, SWEEP_MS).unref();
  }

  private stop(): void {
    if (this.heartbeat) clearInterval(this.heartbeat);
    if (this.sweep) clearInterval(this.sweep);
    this.heartbeat = null;
    this.sweep = null;
  }
}

/**
 * One SSE frame.
 *
 * The `id` is the cursor the browser sends back as `Last-Event-ID` after a
 * reconnect, so it has to carry both halves of the ordering key.
 */
function writeEvent(res: Response, event: string, row: OutputRow): void {
  const id = `${new Date(row.created_at).toISOString()}|${row.id}`;
  res.write(`id: ${id}\n`);
  res.write(`event: ${event}\n`);
  res.write(
    `data: ${JSON.stringify({
      id: row.id,
      sourceType: row.source_type,
      sourceId: row.source_id,
      content: row.content,
      createdAt: row.created_at,
    })}\n\n`,
  );
}

/** Parses a `Last-Event-ID` back into a cursor, or null if it is unusable. */
export function parseCursor(value: string | undefined): StreamCursor | null {
  if (!value) return null;
  const at = value.indexOf("|");
  if (at < 0) return null;

  const createdAt = new Date(value.slice(0, at));
  const id = value.slice(at + 1);
  if (Number.isNaN(createdAt.getTime()) || !id) return null;

  return { createdAt, id };
}
