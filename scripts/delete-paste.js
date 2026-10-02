import { openDatabase } from '../lib/database.js';
import { readConfig } from '../lib/config.js';

const id = process.argv[2];
if (!/^[A-Za-z0-9_-]{12}$/.test(id || '')) {
  console.error('Usage: npm run delete-paste -- PASTE_ID');
  process.exit(1);
}
const db = openDatabase(readConfig().databasePath);
try {
  const result = db.prepare('DELETE FROM pastes WHERE id = ?').run(id);
  console.log(result.changes ? `Removed paste ${id}.` : 'Paste not found.');
} finally { db.close(); }
