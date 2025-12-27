#!/usr/bin/env bun
/**
 * Build script for marvin CLI
 * 
 * Uses solid plugin to transform JSX, then compiles to single executable.
 * Patches dynamic imports to static for bundling.
 */
import solidPlugin from "@opentui/solid/bun-plugin";
import { copyFileSync, existsSync, mkdirSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";

const outfile = process.argv[2] || join(process.env.HOME!, "commands", "marvin");
const require = createRequire(import.meta.url);

const resolveWorkerPaths = (): { workerPath: string; workerMapPath: string } => {
  const packageJsonPath = require.resolve("@opentui/core/package.json");
  const workerPath = join(dirname(packageJsonPath), "parser.worker.js");
  return { workerPath, workerMapPath: `${workerPath}.map` };
};

const copyWorkerAssets = (targetDir: string): void => {
  const { workerPath, workerMapPath } = resolveWorkerPaths();
  mkdirSync(targetDir, { recursive: true });
  copyFileSync(workerPath, join(targetDir, "parser.worker.js"));
  if (existsSync(workerMapPath)) {
    copyFileSync(workerMapPath, join(targetDir, "parser.worker.js.map"));
  }
};

// Step 1: Bundle with solid plugin (transforms JSX)
const bundleResult = await Bun.build({
  entrypoints: ["./src/index.ts"],
  outdir: "./dist",
  target: "bun",
  minify: false,
  plugins: [solidPlugin],
});

if (!bundleResult.success) {
  console.error("Bundle failed:");
  for (const log of bundleResult.logs) {
    console.error(log);
  }
  process.exit(1);
}

console.log(`Bundled ${bundleResult.outputs.length} files`);

// Find the main JS output  
const mainOutput = bundleResult.outputs.find(o => o.path.endsWith("index.js"));
if (!mainOutput) {
  console.error("No index.js output found");
  process.exit(1);
}

// Step 2: Patch the bundled code to resolve dynamic platform import
let bundledCode = await Bun.file(mainOutput.path).text();

// Find the dylib path
const dylibPath = require.resolve("@opentui/core-darwin-arm64/libopentui.dylib");

// Replace the entire dynamic platform loading block with direct dylib import
// The pattern loads the platform-specific module which just exports the dylib path
const dynamicImportPattern = /import\(`@opentui\/core-\$\{process\.platform\}-\$\{process\.arch\}\/index\.ts`\)/g;
const staticImport = `import("${dylibPath}", { with: { type: "file" } }).then(m => ({ default: m.default }))`;
bundledCode = bundledCode.replace(dynamicImportPattern, staticImport);

// Write patched code
await Bun.write(mainOutput.path, bundledCode);
console.log("Patched dynamic platform imports");

copyWorkerAssets(join(process.cwd(), "dist"));
console.log("Copied Tree-sitter worker assets");

// Step 3: Compile to single executable
const proc = Bun.spawn(["bun", "build", "--compile", mainOutput.path, "--outfile", outfile], {
  stdout: "inherit",
  stderr: "inherit",
  cwd: process.cwd(),
});

const exitCode = await proc.exited;
if (exitCode === 0) {
  copyWorkerAssets(dirname(outfile));
  console.log("Copied Tree-sitter worker assets to output directory");
  console.log(`Built: ${outfile}`);
}
process.exit(exitCode);
