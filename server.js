import { readConfig } from './lib/config.js';
import { openDatabase, purgeExpired } from './lib/database.js';
import { createApp } from './app.js';

const config = readConfig();
const db = openDatabase(config.databasePath);
purgeExpired(db);
const cleanup = setInterval(() => purgeExpired(db), 60_000);
cleanup.unref();
const server = createApp(config, db).listen(config.port, config.host, error => {
  if (error) {
    clearInterval(cleanup);
    db.close();
    console.error(error.code === 'EADDRINUSE'
      ? `Cannot start Folio: port ${config.port} is already in use. Stop the other server or change PORT in .env.`
      : `Cannot start Folio: ${error.message}`);
    process.exitCode = 1;
    return;
  }
  console.log(`Folio is listening at http://${config.host}:${config.port}`);
});
let closing = false;
for (const signal of ['SIGTERM', 'SIGINT']) process.on(signal, () => {
  if (closing) return;
  closing = true;
  clearInterval(cleanup);
  server.close(() => { db.close(); process.exit(0); });
  setTimeout(() => process.exit(1), 8000).unref();
});
