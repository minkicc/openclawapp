#!/usr/bin/env node

import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const scriptDir = dirname(fileURLToPath(import.meta.url));
const desktopRoot = resolve(scriptDir, "..");
const kernelRoot = join(desktopRoot, "resources", "kernel");
const openclawPkg = join(kernelRoot, "node_modules", "openclaw", "package.json");
const nodePkg = join(kernelRoot, "node_modules", "node", "package.json");

const forceRefresh = process.env.OPENCLAW_KERNEL_REFRESH === "1";
const openclawSpec = process.env.OPENCLAW_KERNEL_SPEC || "openclaw@latest";
const nodeSpec = process.env.OPENCLAW_NODE_SPEC || "node@22";

function formatBytes(bytes) {
  if (!bytes) return "0 B";
  const units = ["B", "KB", "MB", "GB"];
  let value = bytes;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  return `${value.toFixed(unit === 0 ? 0 : 1)} ${units[unit]}`;
}

function directorySize(targetPath) {
  if (!existsSync(targetPath)) {
    return 0;
  }
  let total = 0;
  const stack = [targetPath];
  while (stack.length > 0) {
    const current = stack.pop();
    const entries = readdirSync(current, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = join(current, entry.name);
      if (entry.isDirectory()) {
        stack.push(fullPath);
      } else if (entry.isFile()) {
        total += statSync(fullPath).size;
      }
    }
  }
  return total;
}

function pruneSourceMaps(rootPath) {
  if (!existsSync(rootPath)) {
    return { files: 0, bytes: 0 };
  }
  let files = 0;
  let bytes = 0;
  const stack = [rootPath];
  while (stack.length > 0) {
    const current = stack.pop();
    const entries = readdirSync(current, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = join(current, entry.name);
      if (entry.isDirectory()) {
        stack.push(fullPath);
        continue;
      }
      if (!entry.isFile() || !entry.name.endsWith(".map")) {
        continue;
      }
      bytes += statSync(fullPath).size;
      files += 1;
      rmSync(fullPath, { force: true });
    }
  }
  return { files, bytes };
}

function pruneNodeHeaders(nodeRoot) {
  if (!existsSync(nodeRoot)) {
    return { dirs: 0, bytes: 0 };
  }
  let dirs = 0;
  let bytes = 0;
  const nodePackagesRoot = join(nodeRoot, "node_modules", "node", "node_modules");
  if (!existsSync(nodePackagesRoot)) {
    return { dirs, bytes };
  }

  const entries = readdirSync(nodePackagesRoot, { withFileTypes: true });
  for (const entry of entries) {
    if (!entry.isDirectory() || !entry.name.startsWith("node-bin-")) {
      continue;
    }
    const includeDir = join(nodePackagesRoot, entry.name, "include");
    if (!existsSync(includeDir)) {
      continue;
    }
    bytes += directorySize(includeDir);
    dirs += 1;
    rmSync(includeDir, { recursive: true, force: true });
  }

  return { dirs, bytes };
}

function pruneBundledKernel() {
  const nodeModulesRoot = join(kernelRoot, "node_modules");
  if (!existsSync(nodeModulesRoot)) {
    return;
  }
  const sourceMaps = pruneSourceMaps(nodeModulesRoot);
  const nodeHeaders = pruneNodeHeaders(kernelRoot);
  const savedBytes = sourceMaps.bytes + nodeHeaders.bytes;
  if (savedBytes > 0) {
    console.log(
      `Pruned bundled kernel: removed ${sourceMaps.files} source maps and ${nodeHeaders.dirs} Node header dirs (${formatBytes(savedBytes)} saved)`
    );
  }
}

mkdirSync(kernelRoot, { recursive: true });

if (forceRefresh) {
  console.log("Refreshing bundled kernel...");
  rmSync(join(kernelRoot, "node_modules"), { recursive: true, force: true });
  rmSync(join(kernelRoot, "package-lock.json"), { force: true });
}

if (existsSync(openclawPkg) && existsSync(nodePkg)) {
  pruneBundledKernel();
  const openclawVersion = JSON.parse(readFileSync(openclawPkg, "utf8")).version;
  const nodeVersion = JSON.parse(readFileSync(nodePkg, "utf8")).version;
  console.log(
    `Bundled kernel already prepared: openclaw@${openclawVersion} + node@${nodeVersion}`
  );
  process.exit(0);
}

function resolveNpmInvocation() {
  const npmExecPath = process.env.npm_execpath;
  if (npmExecPath && existsSync(npmExecPath)) {
    return {
      command: process.execPath,
      prefixArgs: [npmExecPath],
    };
  }

  const candidates =
    process.platform === "win32" ? ["npm.cmd", "npm"] : ["npm"];

  for (const command of candidates) {
    const check = spawnSync(command, ["--version"], { stdio: "ignore" });
    if (check.status === 0) {
      return {
        command,
        prefixArgs: [],
      };
    }
  }

  return null;
}

const npmInvocation = resolveNpmInvocation();
if (!npmInvocation) {
  console.error("npm not found. Cannot prepare bundled kernel.");
  process.exit(1);
}

console.log(`Installing bundled kernel packages: ${openclawSpec} + ${nodeSpec}`);
const install = spawnSync(
  npmInvocation.command,
  [
    ...npmInvocation.prefixArgs,
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

pruneBundledKernel();

const openclawVersion = JSON.parse(readFileSync(openclawPkg, "utf8")).version;
const nodeVersion = JSON.parse(readFileSync(nodePkg, "utf8")).version;
console.log(`Bundled kernel ready: openclaw@${openclawVersion} + node@${nodeVersion}`);
