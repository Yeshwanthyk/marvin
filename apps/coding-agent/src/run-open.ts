/**
 * Runner for OpenTUI-based TUI
 * Uses the solid plugin for JSX transformation
 */
import solidPlugin from "@opentui/solid/bun-plugin"

// Register the plugin before importing TSX
Bun.plugin(solidPlugin)

// Now import and run
const { runTuiOpen } = await import("./tui-app-open.js")

await runTuiOpen()
