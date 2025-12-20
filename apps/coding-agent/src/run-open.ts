/**
 * Runner for OpenTUI-based TUI
 * Uses the solid plugin for JSX transformation
 */
import solidPlugin from "@opentui/solid/bun-plugin"
import { parseArgs } from "./args.js"

// Register the plugin before importing TSX
Bun.plugin(solidPlugin)

// Parse CLI args before importing TSX
const argv = process.argv.slice(2)
const args = parseArgs(argv)

// Now import and run with parsed args
const { runTuiOpen } = await import("./tui-app-open.js")

await runTuiOpen({
	configDir: args.configDir,
	configPath: args.configPath,
	provider: args.provider,
	model: args.model,
	thinking: args.thinking,
	continueSession: args.continue,
	resumeSession: args.resume,
})
