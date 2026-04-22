import { readdir, readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { loadConfig } from "../config.js";
import { createPool } from "./pool.js";

/**
 * Tiny migration runner. Intentionally dependency-free: reads `*.sql` files
 * from `apps/backend/migrations/` in lexical order, records applied names in
 * `_migrations`, and skips already-applied files. Each migration runs inside
 * a transaction.
 */
async function main(): Promise<void> {
  const config = loadConfig();
  if (!config.database.url) {
    throw new Error(
      "DATABASE_URL is required for migrations. Set it in .env and re-run.",
    );
  }

  const pool = createPool(config.database.url);
  const migrationsDir = resolveMigrationsDir();
  const files = (await readdir(migrationsDir))
    .filter((f) => f.endsWith(".sql"))
    .sort();

  const client = await pool.connect();
  try {
    await client.query(`
      CREATE TABLE IF NOT EXISTS _migrations (
        name       TEXT PRIMARY KEY,
        applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);

    const { rows } = await client.query<{ name: string }>(
      "SELECT name FROM _migrations",
    );
    const applied = new Set(rows.map((r) => r.name));

    let ranCount = 0;
    for (const file of files) {
      if (applied.has(file)) continue;
      const sql = await readFile(join(migrationsDir, file), "utf8");
      console.log(`[migrate] applying ${file}`);
      await client.query("BEGIN");
      try {
        await client.query(sql);
        await client.query("INSERT INTO _migrations (name) VALUES ($1)", [
          file,
        ]);
        await client.query("COMMIT");
        ranCount++;
      } catch (err) {
        await client.query("ROLLBACK");
        throw err;
      }
    }

    if (ranCount === 0) {
      console.log("[migrate] already up to date");
    } else {
      console.log(`[migrate] applied ${ranCount} migration(s)`);
    }
  } finally {
    client.release();
    await pool.end();
  }
}

function resolveMigrationsDir(): string {
  // Works both when tsx-running from src/db/ and when compiled to dist/db/.
  const here = dirname(fileURLToPath(import.meta.url));
  return join(here, "..", "..", "migrations");
}

main().catch((err) => {
  console.error("[migrate] failed:", err);
  process.exit(1);
});
