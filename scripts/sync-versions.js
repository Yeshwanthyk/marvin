#!/usr/bin/env node

/**
 * Syncs ALL @marvin-agents/* package dependency versions to match their current versions.
 * Ensures lockstep versioning across the monorepo.
 *
 * Usage: node scripts/sync-versions.js
 */

import { readFileSync, writeFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

const packagesDir = join(process.cwd(), "packages");
const appsDir = join(process.cwd(), "apps");

const SYNC_PACKAGES = ["ai", "agent", "base-tools", "lsp", "runtime-effect", "sdk"];

function readPkg(dir) {
  const pkgPath = join(dir, "package.json");
  try {
    return { path: pkgPath, data: JSON.parse(readFileSync(pkgPath, "utf8")) };
  } catch {
    return null;
  }
}

const packages = new Map();
const versionMap = new Map();

for (const name of SYNC_PACKAGES) {
  const pkg = readPkg(join(packagesDir, name));
  if (pkg) {
    packages.set(name, pkg);
    versionMap.set(pkg.data.name, pkg.data.version);
  }
}

for (const name of readdirSync(appsDir, { withFileTypes: true })
  .filter((d) => d.isDirectory())
  .map((d) => d.name)) {
  const pkg = readPkg(join(appsDir, name));
  if (pkg) packages.set(`apps/${name}`, pkg);
}

console.log("Current versions:");
for (const [name, version] of [...versionMap.entries()].sort()) {
  console.log(`  ${name}: ${version}`);
}

const versions = new Set(versionMap.values());
if (versions.size > 1) {
  console.error("\n❌ ERROR: Not all packages have the same version!");
  console.error("Run: npm run version:patch (or minor/major)");
  process.exit(1);
}

console.log("\n✅ All packages at same version (lockstep)");

let totalUpdates = 0;

for (const [, pkg] of packages) {
  let updated = false;

  for (const depType of ["dependencies", "devDependencies"]) {
    const deps = pkg.data[depType];
    if (!deps) continue;

    for (const [depName, currentVersion] of Object.entries(deps)) {
      const targetVersion = versionMap.get(depName);
      if (targetVersion) {
        const newVersion = `^${targetVersion}`;
        if (currentVersion !== newVersion && !currentVersion.startsWith("file:")) {
          console.log(`${pkg.data.name}: ${depName} ${currentVersion} → ${newVersion}`);
          deps[depName] = newVersion;
          updated = true;
          totalUpdates++;
        }
      }
    }
  }

  if (updated) {
    writeFileSync(pkg.path, JSON.stringify(pkg.data, null, 2) + "\n");
  }
}

if (totalUpdates === 0) {
  console.log("All inter-package dependencies in sync.");
} else {
  console.log(`\n✅ Updated ${totalUpdates} dependency version(s)`);
}
