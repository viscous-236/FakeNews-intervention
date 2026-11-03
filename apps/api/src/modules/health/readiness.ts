import { readdir } from 'node:fs/promises';
import path from 'node:path';
import { getPool } from '../../db/pool.js';
import { config } from '../../config.js';
import { checkDetectorHealth } from '../../detection/client.js';

export async function getReadiness(): Promise<{
  db: boolean;
  migrations: boolean;
  detector: boolean;
}> {
  const detectorCheck = checkDetectorHealth({ timeoutMs: config.DETECTOR_TIMEOUT_MS }).then(
    (health) => health.ok && health.modelLoaded,
    () => false,
  );
  let db = false;
  let migrations = false;
  try {
    await getPool().query('SELECT 1');
    db = true;
    // SQL files are copied alongside compiled code during the API build.
    const files = await readdir(path.join(__dirname, '../../db/migrations'));
    const expected = files.filter((file) => file.endsWith('.sql')).map((file) => file.slice(0, -4));
    const applied = await getPool().query<{ name: string }>('SELECT name FROM pgmigrations');
    const names = new Set(applied.rows.map((row) => row.name));
    migrations = expected.length > 0 && expected.every((name) => names.has(name));
  } catch {
    // Database failures and missing migration artifacts make readiness fail closed.
  }
  return { db, migrations, detector: await detectorCheck };
}
