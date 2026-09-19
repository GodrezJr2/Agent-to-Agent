import path from "node:path";
import { fileURLToPath } from "node:url";
import { config } from "./config.js";
import { openDb } from "./db.js";
import { createApp } from "./app.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const db = openDb(path.join(config.dataDir, "office.db"));
const { app, office } = createApp({ db, webDist: path.resolve(here, "../../web/dist") });

office.startScheduler();
const server = app.listen(config.port, config.host, () => {
  console.log(`[office] listening on http://${config.host}:${config.port}`);
  console.log(`[office] public URL ${config.publicUrl} · gateway ${config.gateway.baseUrl}`);
});

function shutdown() {
  office.stopAll();
  server.close(() => { db.close(); process.exit(0); });
  setTimeout(() => process.exit(0), 5000).unref();
}
process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);
