/**
 * Runner script that uses the solid plugin for JSX transformation
 */
import solidPlugin from "@opentui/solid/bun-plugin"

// Register the plugin
Bun.plugin(solidPlugin)

// Now import and run the demo
await import("./demo.tsx")
