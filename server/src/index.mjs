import http from "node:http";
import { routeRequest } from "./router.mjs";

const port = Number(process.env.PORT || 8787);
const host = process.env.HOST || "0.0.0.0";

const server = http.createServer((req, res) => {
  routeRequest(req, res);
});

server.listen(port, host, () => {
  console.log(`[openclaw-server] listening on http://${host}:${port}`);
});
