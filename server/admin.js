#!/usr/bin/env node
// Moderator command line. Run it on the server, inside the container:
//   docker exec jam-gym-web-1 node server/admin.js stats
// Locally: DATA_DIR=./data node server/admin.js stats

import { join } from 'node:path';
import { loadConfig } from './config.js';
import { openDatabase } from './db.js';
import { createModeration } from './moderation.js';
import { snapshot } from './backup.js';

const HELP = `Jam Gym moderation

  stats                  counts of users, tracks, likes and reports
  reports                reported tracks, most reported first
  show <track-id>        one track's details and its reports
  hide <track-id>        take a track off the public site
  restore <track-id>     put a hidden track back and clear its reports
  delete <track-id>      delete a track for good
  ban <user-id>          stop a user saving, publishing or liking, and hide their tracks (ids look like 4F2K9XQ7)
  unban <user-id>
  backup                 write a database snapshot to the backups folder now
  ids                    every track id, one per line (the deploy script compares these before and after)
`;

const print = (v) => console.log(typeof v === 'string' ? v : JSON.stringify(v, (_, x) => (typeof x === 'bigint' ? Number(x) : x), 2));

export async function run(argv, { db, log = print } = {}) {
  const [cmd, arg] = argv;
  const config = loadConfig();
  const own = !db;
  db ??= openDatabase(join(config.dataDir, 'jamgym.sqlite'));
  const mod = createModeration(db);
  const need = () => { if (!arg) throw new Error(`"${cmd}" needs an id. Run with no arguments for help.`); return arg; };
  try {
    switch (cmd) {
      case 'stats': log(mod.stats()); break;
      case 'reports': {
        const rows = mod.reports();
        log(rows.length ? rows : 'No reported tracks.');
        break;
      }
      case 'show': log(mod.show(need())); break;
      case 'hide': { const t = mod.hide(need()); log(`Hidden: "${t.title}" by ${t.author}`); break; }
      case 'restore': { const t = mod.restore(need()); log(`Restored: "${t.title}" by ${t.author}`); break; }
      case 'delete': { const t = mod.remove(need()); log(`Deleted: "${t.title}" by ${t.author}`); break; }
      case 'ban': { const u = mod.ban(need(), true); log(`Banned ${u.public_id} (${u.display_name})`); break; }
      case 'unban': { const u = mod.ban(need(), false); log(`Unbanned ${u.public_id} (${u.display_name})`); break; }
      case 'ids': log(db.prepare('SELECT id FROM tracks ORDER BY id').all().map((r) => r.id).join('\n')); break;
      case 'backup': log(`Backup written: ${await snapshot(db, join(config.dataDir, 'backups'), config.backupKeep)}`); break;
      default: log(HELP);
    }
  } finally {
    if (own) db.close();
  }
}

if (process.argv[1] && import.meta.url.endsWith(process.argv[1].replace(/\\/g, '/').split('/').pop())) {
  run(process.argv.slice(2)).catch((err) => { console.error(`Error: ${err.message}`); process.exit(1); });
}
