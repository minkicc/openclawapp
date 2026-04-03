#!/usr/bin/env node

import {
  cpSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const scriptDir = dirname(fileURLToPath(import.meta.url));
const desktopRoot = resolve(scriptDir, "..");
const kernelRoot = join(desktopRoot, "resources", "kernel");
const kernelArchivePath = join(desktopRoot, "resources", "kernel.tar");
const kernelMetaPath = join(desktopRoot, "resources", "kernel-meta.json");
const customExtensionsRoot = join(desktopRoot, "extensions");
const openclawPkg = join(kernelRoot, "node_modules", "openclaw", "package.json");
const nodePkg = join(kernelRoot, "node_modules", "node", "package.json");
const kernelRequiredFiles = [
  join(kernelRoot, "node_modules", "openclaw", "openclaw.mjs"),
  join(kernelRoot, "node_modules", "openclaw", "dist", "entry.js"),
  join(kernelRoot, "node_modules", "openclaw", "dist", "control-ui", "index.html"),
  join(kernelRoot, "node_modules", "yaml", "dist", "compose", "composer.js"),
  join(kernelRoot, "node_modules", "yaml", "dist", "doc", "directives.js"),
];

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

function missingKernelFiles() {
  return kernelRequiredFiles.filter((filePath) => !existsSync(filePath));
}

function syncCustomExtensions() {
  if (!existsSync(customExtensionsRoot)) {
    return;
  }
  const openclawExtensionsRoot = join(kernelRoot, "node_modules", "openclaw", "extensions");
  if (!existsSync(openclawExtensionsRoot)) {
    return;
  }

  const entries = readdirSync(customExtensionsRoot, { withFileTypes: true }).filter((entry) =>
    entry.isDirectory()
  );
  if (entries.length === 0) {
    return;
  }

  for (const entry of entries) {
    const src = join(customExtensionsRoot, entry.name);
    const dst = join(openclawExtensionsRoot, entry.name);
    rmSync(dst, { recursive: true, force: true });
    cpSync(src, dst, { recursive: true });
    console.log(`Synced bundled extension: ${entry.name}`);
  }
}

function createKernelArchive() {
  rmSync(kernelArchivePath, { force: true });
  const packed = spawnSync("tar", ["-cf", kernelArchivePath, "-C", kernelRoot, "."], {
    stdio: "inherit",
  });
  if (packed.status !== 0) {
    console.error("Failed to create bundled kernel archive.");
    process.exit(packed.status ?? 1);
  }
  console.log(
    `Packed bundled kernel archive: ${kernelArchivePath} (${formatBytes(
      existsSync(kernelArchivePath) ? statSync(kernelArchivePath).size : 0
    )})`
  );
}

function writeKernelMeta(openclawVersion, nodeVersion) {
  writeFileSync(
    kernelMetaPath,
    `${JSON.stringify(
      {
        openclawVersion: String(openclawVersion || "").trim(),
        nodeVersion: String(nodeVersion || "").trim(),
      },
      null,
      2
    )}\n`
  );
}

mkdirSync(kernelRoot, { recursive: true });

if (forceRefresh) {
  console.log("Refreshing bundled kernel...");
  rmSync(join(kernelRoot, "node_modules"), { recursive: true, force: true });
  rmSync(join(kernelRoot, "package-lock.json"), { force: true });
}

if (existsSync(openclawPkg) && existsSync(nodePkg)) {
  const missing = missingKernelFiles();
  if (missing.length > 0) {
    console.warn("Bundled kernel looks incomplete, reinstalling packages...");
    for (const filePath of missing) {
      console.warn(`  missing: ${filePath}`);
    }
    rmSync(join(kernelRoot, "node_modules"), { recursive: true, force: true });
    rmSync(join(kernelRoot, "package-lock.json"), { force: true });
  } else {
    syncCustomExtensions();
    pruneBundledKernel();
    const openclawVersion = JSON.parse(readFileSync(openclawPkg, "utf8")).version;
    const nodeVersion = JSON.parse(readFileSync(nodePkg, "utf8")).version;
    writeKernelMeta(openclawVersion, nodeVersion);
    createKernelArchive();
    console.log(
      `Bundled kernel already prepared: openclaw@${openclawVersion} + node@${nodeVersion}`
    );
    process.exit(0);
  }
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

const missing = missingKernelFiles();
if (missing.length > 0) {
  console.error("Bundled kernel install is incomplete.");
  for (const filePath of missing) {
    console.error(`  missing: ${filePath}`);
  }
  process.exit(1);
}

syncCustomExtensions();
pruneBundledKernel();
const openclawVersion = JSON.parse(readFileSync(openclawPkg, "utf8")).version;
const nodeVersion = JSON.parse(readFileSync(nodePkg, "utf8")).version;
writeKernelMeta(openclawVersion, nodeVersion);
createKernelArchive();
console.log(`Bundled kernel ready: openclaw@${openclawVersion} + node@${nodeVersion}`);
