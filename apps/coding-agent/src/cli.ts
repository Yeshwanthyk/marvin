#!/usr/bin/env bun
/**
 * CLI entry point that respawns bun with the solid preload to ensure
 * solid-js loads the browser build instead of server build.
 */
import { spawn } from "bun";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const mainScript = join(__dirname, "index.js");
const preloadPath = join(__dirname, "solid-preload.js");

// Respawn with preload if not already preloaded
if (!process.env.__MARVIN_PRELOADED) {
	const proc = spawn({
		cmd: ["bun", "--conditions=browser", "--preload", preloadPath, mainScript, ...process.argv.slice(2)],
		env: { ...process.env, __MARVIN_PRELOADED: "1" },
		stdio: ["inherit", "inherit", "inherit"],
	});
	const exitCode = await proc.exited;
	process.exit(exitCode);
} else {
	// Already preloaded, run main directly
	await import("./index.js");
}
