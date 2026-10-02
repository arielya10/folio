import { DatabaseSync, backup } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { readConfig } from '../lib/config.js';

const config = readConfig();
const directory = path.resolve('backups');
mkdirSync(directory, { recursive: true });
const destination = path.join(directory, `pastes-${new Date().toISOString().replaceAll(':', '-')}.sqlite`);
const db = new DatabaseSync(config.databasePath, { readOnly: true });
try {
  await backup(db, destination);
  console.log(`Consistent SQLite backup saved to ${destination}`);
} finally { db.close(); }
