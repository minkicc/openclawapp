import { readFileSync } from "node:fs";

const raw = readFileSync(new URL("../openapi/openapi.yaml", import.meta.url), "utf8");

const requiredSnippets = [
  "openapi: 3.1.0",
  "/v1/devices/register",
  "/v1/pair/sessions",
  "/v1/signal/send",
  "/v1/signal/stream",
  "/ws/desktop",
  "/ws/mobile",
];

for (const snippet of requiredSnippets) {
  if (!raw.includes(snippet)) {
    console.error(`Missing required OpenAPI snippet: ${snippet}`);
    process.exit(1);
  }
}

console.log("OpenAPI skeleton check passed.");
