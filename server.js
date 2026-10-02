import { readConfig } from './lib/config.js';
import { openDatabase } from './lib/database.js';
import { createApp } from './app.js';

const config = readConfig();
const db = openDatabase(config.databasePath);
const server = createApp(config, db).listen(config.port, config.host, () => {
  console.log(`Folio is listening at http://${config.host}:${config.port}`);
});
let closing = false;
for (const signal of ['SIGTERM', 'SIGINT']) process.on(signal, () => {
  if (closing) return;
  closing = true;
  server.close(() => { db.close(); process.exit(0); });
  setTimeout(() => process.exit(1), 8000).unref();
});
