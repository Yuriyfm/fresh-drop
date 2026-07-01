import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import process from 'node:process';
import { Pool } from 'pg';

const databaseUrl = process.env.DATABASE_URL;

async function main(): Promise<void> {
  assertSafeDevReset(databaseUrl, process.env);

  const pool = new Pool({ connectionString: databaseUrl });

  try {
    await pool.query('drop schema public cascade');
    await pool.query('create schema public');
    await pool.query(readFileSync(resolve(process.cwd(), 'db/schema.sql'), 'utf8'));
    console.info('Development database reset and schema applied.');
  } finally {
    await pool.end();
  }
}

function assertSafeDevReset(url: string | undefined, env: NodeJS.ProcessEnv): asserts url is string {
  if (env.ALLOW_DB_RESET !== 'true') {
    throw new Error('Refusing to reset database. Set ALLOW_DB_RESET=true for local dev reset.');
  }

  if (!url) {
    throw new Error('DATABASE_URL is required for db:reset.');
  }

  const parsed = new URL(url);
  const safeHosts = new Set(['localhost', '127.0.0.1', '[::1]', 'db', 'fresh-drop-postgres']);

  if (!safeHosts.has(parsed.hostname)) {
    throw new Error(`Refusing to reset non-local database host "${parsed.hostname}".`);
  }

  if (!parsed.pathname.includes('fresh_drop')) {
    throw new Error(`Refusing to reset database "${parsed.pathname.slice(1)}"; expected a fresh_drop dev database.`);
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : 'Development database reset failed.');
  process.exitCode = 1;
});
