#!/usr/bin/env bun
/**
 * Build script for npm package distribution.
 *
 * Strategy:
 * 1. Use tsc with jsx: "preserve" - outputs .jsx files with JSX syntax intact
 * 2. Transform .jsx files with babel-preset-solid to generate proper @opentui/solid calls
 * 3. Run tsc-alias to fix path aliases
 */
import { transformAsync } from "@babel/core";
// @ts-expect-error - No types
import babelSolid from "babel-preset-solid";
import { readFile, rename, unlink, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { Glob } from "bun";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const projectRoot = join(__dirname, "..");
const distDir = join(projectRoot, "dist");

// Step 1: Run tsc for compilation (with jsx: preserve, outputs .jsx files)
console.log("Running TypeScript compiler...");
const tscResult = Bun.spawnSync({
	cmd: ["tsc", "-b", "tsconfig.build.json", "--force"],
	cwd: projectRoot,
	stdout: "inherit",
	stderr: "inherit",
});

if (tscResult.exitCode !== 0) {
	console.error("TypeScript compilation failed");
	process.exit(1);
}

// Step 2: Transform .jsx files with babel-preset-solid
console.log("Transforming JSX with babel-preset-solid...");
const jsxGlob = new Glob("**/*.jsx");
let transformedCount = 0;

for await (const file of jsxGlob.scan({ cwd: distDir, absolute: true })) {
	const content = await readFile(file, "utf8");

	const result = await transformAsync(content, {
		filename: file,
		presets: [[babelSolid, { moduleName: "@opentui/solid", generate: "universal" }]],
	});

	if (result?.code) {
		// Write as .js file
		const jsFile = file.replace(/\.jsx$/, ".js");
		await writeFile(jsFile, result.code);
		// Remove the .jsx file
		await unlink(file);
		transformedCount++;
	}
}

console.log(`Transformed ${transformedCount} JSX files`);

// Step 3: Fix .jsx imports in all .js files to use .js extension
console.log("Fixing import extensions...");
const jsGlob = new Glob("**/*.js");
let fixedCount = 0;

for await (const file of jsGlob.scan({ cwd: distDir, absolute: true })) {
	const content = await readFile(file, "utf8");
	// Replace .jsx imports with .js
	const fixed = content.replace(/from\s+["']([^"']+)\.jsx["']/g, 'from "$1.js"');
	if (fixed !== content) {
		await writeFile(file, fixed);
		fixedCount++;
	}
}

console.log(`Fixed imports in ${fixedCount} files`);

// Step 4: Run tsc-alias to fix path aliases
console.log("Fixing path aliases...");
const aliasResult = Bun.spawnSync({
	cmd: ["npx", "tsc-alias", "-p", "tsconfig.alias.json"],
	cwd: projectRoot,
	stdout: "inherit",
	stderr: "inherit",
});

if (aliasResult.exitCode !== 0) {
	console.error("tsc-alias failed");
	process.exit(1);
}

console.log("Build complete!");
