import type { DiffRenderable, LineNumberRenderable } from "@opentui/core"

declare module "@opentui/solid" {
	interface OpenTUIComponents {
		diff: typeof DiffRenderable
		line_number: typeof LineNumberRenderable
	}
}
