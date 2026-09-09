import 'dotenv/config';
import { readdir, readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { getPool, query, closePool } from './pool.js';

const here = dirname(fileURLToPath(import.meta.url));
const MIGRATIONS_DIR = join(here, '..', '..', '..', 'db', 'migrations');

async function ensureTable(): Promise<void> {
  await query(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      name TEXT PRIMARY KEY,
      applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )`);
}

async function up(): Promise<void> {
  await ensureTable();
  const files = (await readdir(MIGRATIONS_DIR)).filter((f) => f.endsWith('.sql')).sort();
  const applied = new Set((await query<{ name: string }>('SELECT name FROM schema_migrations')).map((r) => r.name));

  let count = 0;
  for (const file of files) {
    if (applied.has(file)) continue;
    const sql = await readFile(join(MIGRATIONS_DIR, file), 'utf8');
    const client = await getPool().connect();
    try {
      await client.query('BEGIN');
      await client.query(sql);
      await client.query('INSERT INTO schema_migrations (name) VALUES ($1)', [file]);
      await client.query('COMMIT');
      console.log(`applied ${file}`);
      count++;
    } catch (err) {
      await client.query('ROLLBACK');
      console.error(`FAILED ${file}`);
      throw err;
    } finally {
      client.release();
    }
  }
  console.log(count === 0 ? 'already up to date' : `${count} migration(s) applied`);
}

async function reset(): Promise<void> {
  await query('DROP SCHEMA public CASCADE; CREATE SCHEMA public;');
  console.log('schema dropped');
  await up();
}

const cmd = process.argv[2] ?? 'up';
try {
  if (cmd === 'up') await up();
  else if (cmd === 'reset') await reset();
  else { console.error(`unknown command: ${cmd}`); process.exit(1); }
} catch (err) {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
} finally {
  await closePool();
}
