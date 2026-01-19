/**
 * Transform .jsx files with babel-preset-solid to generate proper @opentui/solid calls.
 * tsc with jsx: "preserve" outputs .jsx files, this script converts them to .js.
 */
import { transformAsync } from "@babel/core";
import babelSolid from "babel-preset-solid";
import { readFile, unlink, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const distDir = join(__dirname, "..", "dist");

// Dynamically import Bun's Glob
const { Glob } = await import("bun");

// Transform .jsx files with babel-preset-solid
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

// Fix .jsx imports in all .js files to use .js extension
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
console.log("Build complete!");
