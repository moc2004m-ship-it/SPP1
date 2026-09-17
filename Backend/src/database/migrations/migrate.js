#!/usr/bin/env node
// Stage 3 — Migration runner.
//
// Purpose: run the SQL files in ../schema/ in order, against DATABASE_URL,
// using the `pg` package. This is prepared now so a later stage can
// connect a real database without redesigning anything — but it will NOT
// silently pretend to succeed:
//   - If STAGE3_ENABLE_POSTGRES is not "true", it exits with a clear
//     message and does nothing (no external DB connection in Stage 3).
//   - If `pg` is not installed yet (no network access to npm has ever
//     been available in this environment), it exits with a clear message
//     instead of crashing with a confusing require() error.

const fs = require('fs');
const path = require('path');

const SCHEMA_DIR = path.join(__dirname, '..', 'schema');

async function main() {
  if (process.env.STAGE3_ENABLE_POSTGRES !== 'true') {
    console.log(
      '[migrate] Skipped: STAGE3_ENABLE_POSTGRES is not "true". ' +
        'No external database is connected in Stage 3 — see Database/STAGE3_TODO.md.'
    );
    return;
  }

  if (!process.env.DATABASE_URL) {
    console.error('[migrate] STAGE3_ENABLE_POSTGRES=true but DATABASE_URL is not set. Aborting.');
    process.exitCode = 1;
    return;
  }

  let Pool;
  try {
    ({ Pool } = require('pg'));
  } catch (err) {
    console.error(
      '[migrate] The "pg" package is declared in package.json but not installed yet. ' +
        'Run `npm install` with network access, then retry. See Database/STAGE3_TODO.md.'
    );
    process.exitCode = 1;
    return;
  }

  const files = fs
    .readdirSync(SCHEMA_DIR)
    .filter((f) => f.endsWith('.sql'))
    .sort(); // filenames are zero-padded (001_, 002_, ...) so lexical sort == run order

  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  try {
    for (const file of files) {
      const sql = fs.readFileSync(path.join(SCHEMA_DIR, file), 'utf8');
      console.log(`[migrate] Applying ${file} ...`);
      // eslint-disable-next-line no-await-in-loop
      await pool.query(sql);
    }
    console.log(`[migrate] Done. Applied ${files.length} schema file(s).`);
  } finally {
    await pool.end();
  }
}

main().catch((err) => {
  console.error('[migrate] Failed:', err.message);
  process.exitCode = 1;
});
