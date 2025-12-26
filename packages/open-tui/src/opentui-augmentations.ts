import type { CodeRenderable, DiffRenderable, LineNumberRenderable } from "@opentui/core"

declare module "@opentui/solid" {
	interface OpenTUIComponents {
		code: typeof CodeRenderable
		diff: typeof DiffRenderable
		line_number: typeof LineNumberRenderable
	}
}
