#!/usr/bin/env node

import { existsSync, mkdirSync, readFileSync, rmSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const scriptDir = dirname(fileURLToPath(import.meta.url));
const rootDir = resolve(scriptDir, "..");

const kernelRoot = join(rootDir, "resources", "kernel");
const openclawPkg = join(kernelRoot, "node_modules", "openclaw", "package.json");
const nodePkg = join(kernelRoot, "node_modules", "node", "package.json");

const forceRefresh = process.env.OPENCLAW_KERNEL_REFRESH === "1";
const openclawSpec = process.env.OPENCLAW_KERNEL_SPEC || "openclaw@latest";
const nodeSpec = process.env.OPENCLAW_NODE_SPEC || "node@22";

mkdirSync(kernelRoot, { recursive: true });

if (forceRefresh) {
  console.log("Refreshing bundled kernel...");
  rmSync(join(kernelRoot, "node_modules"), { recursive: true, force: true });
  rmSync(join(kernelRoot, "package-lock.json"), { force: true });
}

if (existsSync(openclawPkg) && existsSync(nodePkg)) {
  const openclawVersion = JSON.parse(readFileSync(openclawPkg, "utf8")).version;
  const nodeVersion = JSON.parse(readFileSync(nodePkg, "utf8")).version;
  console.log(
    `Bundled kernel already prepared: openclaw@${openclawVersion} + node@${nodeVersion}`
  );
  process.exit(0);
}

const npmCommand = process.platform === "win32" ? "npm.cmd" : "npm";
const npmCheck = spawnSync(npmCommand, ["--version"], { stdio: "ignore" });
if (npmCheck.status !== 0) {
  console.error("npm not found. Cannot prepare bundled kernel.");
  process.exit(1);
}

console.log(`Installing bundled kernel packages: ${openclawSpec} + ${nodeSpec}`);
const install = spawnSync(
  npmCommand,
  [
    "install",
    "--omit=dev",
    "--no-audit",
    "--no-fund",
    "--prefix",
    kernelRoot,
    openclawSpec,
    nodeSpec,
  ],
  { stdio: "inherit" }
);

if (install.status !== 0) {
  process.exit(install.status ?? 1);
}

const openclawVersion = JSON.parse(readFileSync(openclawPkg, "utf8")).version;
const nodeVersion = JSON.parse(readFileSync(nodePkg, "utf8")).version;
console.log(`Bundled kernel ready: openclaw@${openclawVersion} + node@${nodeVersion}`);
