import http from "node:http";
import { routeRequest } from "./router.mjs";
import { store } from "./store/memory-store.mjs";
import { closePersistence, initPersistence } from "./store/persistence.mjs";

const port = Number(process.env.PORT || 8787);
const host = process.env.HOST || "0.0.0.0";

await initPersistence(store);

const server = http.createServer((req, res) => {
  routeRequest(req, res);
});

server.listen(port, host, () => {
  console.log(`[openclaw-server] listening on http://${host}:${port}`);
});

let shuttingDown = false;
async function shutdown(signal) {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log(`[openclaw-server] received ${signal}, shutting down...`);
  server.close(async () => {
    await closePersistence();
    process.exit(0);
  });
}

process.on("SIGINT", () => {
  void shutdown("SIGINT");
});
process.on("SIGTERM", () => {
  void shutdown("SIGTERM");
});
