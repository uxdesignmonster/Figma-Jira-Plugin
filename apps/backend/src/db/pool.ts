import pg from "pg";

const { Pool } = pg;
export type DbPool = pg.Pool;

/**
 * Build a Postgres connection pool from a connection string. We keep this
 * thin on purpose — everything interesting lives in the per-repository store
 * classes, which accept a pool and return cleanly-typed domain objects.
 *
 * The `ssl` knob reads from the URL (`?sslmode=require`) when present, and
 * otherwise defaults to `false` locally / `{ rejectUnauthorized: false }`
 * for hosted Postgres services that use managed certs.
 */
export function createPool(connectionString: string): DbPool {
  const needsSsl = shouldUseSsl(connectionString);
  return new Pool({
    connectionString,
    max: 10,
    idleTimeoutMillis: 30_000,
    ssl: needsSsl ? { rejectUnauthorized: false } : false,
  });
}

function shouldUseSsl(url: string): boolean {
  if (/sslmode=disable/i.test(url)) return false;
  if (/sslmode=/i.test(url)) return true;
  // Common managed-Postgres hostnames — auto-enable SSL so deploys Just Work.
  return /(neon\.tech|supabase\.co|render\.com|railway\.app|rds\.amazonaws\.com)/i.test(
    url,
  );
}
