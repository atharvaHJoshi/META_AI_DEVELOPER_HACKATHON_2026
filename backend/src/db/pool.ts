import pg from "pg";
import { config } from "../config.js";

// Return DATE columns as YYYY-MM-DD strings rather than timezone-shifted Dates.
pg.types.setTypeParser(1082, (value: string) => value);
// Return timestamps as ISO strings so every API contract stays JSON-safe.
pg.types.setTypeParser(1114, (value: string) => new Date(`${value}Z`).toISOString());
pg.types.setTypeParser(1184, (value: string) => new Date(value).toISOString());

export const pool = new pg.Pool({
  connectionString: config.databaseUrl,
  max: 12,
  idleTimeoutMillis: 30_000,
  connectionTimeoutMillis: 5_000,
});

export type Queryable = Pick<pg.Pool, "query"> | pg.PoolClient;

export async function query<T extends pg.QueryResultRow = pg.QueryResultRow>(
  text: string,
  params: unknown[] = [],
): Promise<pg.QueryResult<T>> {
  return pool.query<T>(text, params);
}

export async function one<T extends pg.QueryResultRow = pg.QueryResultRow>(
  text: string,
  params: unknown[] = [],
): Promise<T | null> {
  const result = await pool.query<T>(text, params);
  return result.rows[0] ?? null;
}

export async function withTransaction<T>(
  fn: (client: pg.PoolClient) => Promise<T>,
): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const result = await fn(client);
    await client.query("COMMIT");
    return result;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

export async function closePool(): Promise<void> {
  await pool.end();
}
