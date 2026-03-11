import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

const root = new URL("../schemas/", import.meta.url);
const schemaDir = root.pathname;

function walk(dir) {
  const files = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    const stat = statSync(full);
    if (stat.isDirectory()) {
      files.push(...walk(full));
      continue;
    }
    if (entry.endsWith(".json")) {
      files.push(full);
    }
  }
  return files;
}

const files = walk(schemaDir);
if (files.length === 0) {
  console.error("No schema files found.");
  process.exit(1);
}

for (const file of files) {
  const raw = readFileSync(file, "utf8");
  JSON.parse(raw);
}

console.log(`Protocol schema check passed (${files.length} files).`);
