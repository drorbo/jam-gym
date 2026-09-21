// Jam Gym server: the static site plus the /api for tracks. `npm start` runs this; so does the Docker image.

import { createServer } from 'node:http';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createApp } from './app.js';
import { scheduleBackups } from './backup.js';
import { loadConfig } from './config.js';
import { openDatabase } from './db.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

/** Build (but don't start) a server. Tests call this with an in-memory database. */
export function buildServer({ config = loadConfig(), dbFile = join(config.dataDir, 'jamgym.sqlite'), root = ROOT } = {}) {
  const db = openDatabase(dbFile);
  const handler = createApp({ db, config, root });
  const server = createServer((req, res) => { handler(req, res); });
  server.requestTimeout = 30_000;
  server.headersTimeout = 15_000;
  return { server, db, config };
}

export async function start() {
  const config = loadConfig();
  const { server, db } = buildServer({ config });
  let stopBackups = () => {};
  if (config.backups) stopBackups = scheduleBackups(db, join(config.dataDir, 'backups'), { keep: config.backupKeep });

  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(config.port, config.host, resolve);
  });
  console.log(`Jam Gym running at http://${config.host === '0.0.0.0' ? 'localhost' : config.host}:${config.port}  (data: ${config.dataDir})`);

  const shutdown = (signal) => {
    console.log(`${signal}: shutting down`);
    stopBackups();
    server.close(() => { db.close(); process.exit(0); });
    setTimeout(() => process.exit(1), 10_000).unref();
  };
  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));
  return { server, db };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  start().catch((err) => { console.error(err); process.exit(1); });
}
