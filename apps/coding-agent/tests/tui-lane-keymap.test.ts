import { describe, expect, it } from "bun:test"
import type { TestRendererOptions } from "@opentui/core/testing"
import type { LaneKeymapConfig } from "@yeshwanthyk/runtime-effect/config.js"
import type { LaneKeymapDirection, LaneNavMode } from "../src/ui/app-shell/TuiLaneKeymap.js"
import type { HumanTuiHarness } from "./helpers/tui-harness.js"

interface LaneKeymapHarness extends HumanTuiHarness {
	jumps: () => number
	archives: () => number
	restores: () => number
	directions: () => LaneKeymapDirection[]
	navMode: () => LaneNavMode
}

const cloneDefaultLaneKeymap = (): LaneKeymapConfig => ({
	activation: {
		behavior: "sticky",
		enter: ["escape", "ctrl+["],
		exit: ["return"],
	},
	bindings: {
		sessionPrev: ["left"],
		sessionNext: ["right"],
		projectPrev: ["up"],
		projectNext: ["down"],
		jump: ["mod+k", "super+k", "meta+k"],
		archive: ["mod+shift+a", "super+shift+a", "ctrl+shift+a"],
		restore: ["mod+shift+r", "super+shift+r", "ctrl+shift+r"],
	},
})

async function loadTuiModules() {
	await import("../src/solid-preload.js")
	const solid = await import("solid-js")
	const laneKeymap = await import("../src/ui/app-shell/TuiLaneKeymap.js")
	const tuiHarness = await import("./helpers/tui-harness.js")
	return { ...solid, ...laneKeymap, ...tuiHarness }
}

async function renderLaneKeymap(
	options: TestRendererOptions = {},
	keymap: LaneKeymapConfig = cloneDefaultLaneKeymap(),
): Promise<LaneKeymapHarness> {
	const { createComponent, createSignal, TuiLaneKeyBindings, TuiLaneKeymapRoot, renderHumanTui } = await loadTuiModules()
	let jumps = 0
	let archives = 0
	let restores = 0
	const directions: LaneKeymapDirection[] = []
	const [navMode, setNavMode] = createSignal<LaneNavMode>("off")

	const harness = await renderHumanTui(() => {
		return createComponent(TuiLaneKeymapRoot, {
			get children() {
				return createComponent(TuiLaneKeyBindings, {
					navMode,
					setNavMode,
					keymap,
					modalOpen: () => false,
					isResponding: () => false,
					onNavigate: (direction) => {
						directions.push(direction)
					},
					onJump: () => {
						jumps += 1
					},
					onArchive: () => {
						archives += 1
					},
					onRestore: () => {
						restores += 1
					},
				})
			},
		})
	}, options)

	return {
		...harness,
		jumps: () => jumps,
		archives: () => archives,
		restores: () => restores,
		directions: () => [...directions],
		navMode,
	}
}

describe("TuiLaneKeyBindings", () => {
	it("opens jump for terminal Command-K protocols", async () => {
		const scenarios: Array<{
			options: TestRendererOptions
			press: (harness: LaneKeymapHarness) => Promise<void>
		}> = [
			{
				options: { kittyKeyboard: true },
				press: (harness) => harness.pressShortcut("k", { super: true }),
			},
			{
				options: { kittyKeyboard: false, otherModifiersMode: true },
				press: (harness) => harness.pressShortcut("k", { super: true }),
			},
			{
				options: { kittyKeyboard: false },
				press: (harness) => harness.pressShortcut("k", { meta: true }),
			},
		]

		for (const scenario of scenarios) {
			const harness = await renderLaneKeymap(scenario.options)
			try {
				await scenario.press(harness)
				expect(harness.jumps()).toBe(1)
			} finally {
				harness.renderer.destroy()
			}
		}
	})

	it("does not steal Ctrl-K from text editing", async () => {
		const harness = await renderLaneKeymap({ kittyKeyboard: true })
		try {
			await harness.pressShortcut("k", { ctrl: true })
			expect(harness.jumps()).toBe(0)
		} finally {
			harness.renderer.destroy()
		}
	})

	it("keeps sticky lane mode active until an exit key", async () => {
		const keymap = cloneDefaultLaneKeymap()
		keymap.activation = { behavior: "sticky", enter: ["ctrl+[", "escape"], exit: ["return"] }
		const harness = await renderLaneKeymap({ kittyKeyboard: true }, keymap)
		try {
			await harness.pressShortcut("[", { ctrl: true })
			expect(harness.navMode()).toBe("sticky")

			harness.keys.pressArrow("right")
			await harness.flush()
			harness.keys.pressArrow("down")
			await harness.flush()
			expect(harness.directions()).toEqual(["right", "down"])
			expect(harness.navMode()).toBe("sticky")

			harness.keys.pressEnter()
			await harness.flush()
			expect(harness.navMode()).toBe("off")
		} finally {
			harness.renderer.destroy()
		}
	})

	it("uses one-shot lane mode as a single-move prefix", async () => {
		const keymap = cloneDefaultLaneKeymap()
		keymap.activation = { behavior: "oneshot", prefix: ["ctrl+[", "escape"], cancel: ["escape"] }
		const harness = await renderLaneKeymap({ kittyKeyboard: true }, keymap)
		try {
			await harness.pressShortcut("[", { ctrl: true })
			expect(harness.navMode()).toBe("oneshot")

			harness.keys.pressArrow("left")
			await harness.flush()
			expect(harness.directions()).toEqual(["left"])
			expect(harness.navMode()).toBe("off")

			harness.keys.pressArrow("right")
			await harness.flush()
			expect(harness.directions()).toEqual(["left"])
		} finally {
			harness.renderer.destroy()
		}
	})

	it("toggles lane mode on and off with the configured toggle key", async () => {
		const keymap = cloneDefaultLaneKeymap()
		keymap.activation = { behavior: "toggle", toggle: ["ctrl+[", "escape"], exit: ["return"] }
		const harness = await renderLaneKeymap({ kittyKeyboard: true }, keymap)
		try {
			await harness.pressShortcut("[", { ctrl: true })
			expect(harness.navMode()).toBe("sticky")

			await harness.pressShortcut("[", { ctrl: true })
			expect(harness.navMode()).toBe("off")
		} finally {
			harness.renderer.destroy()
		}
	})

	it("uses configured global archive and restore bindings", async () => {
		const keymap = cloneDefaultLaneKeymap()
		keymap.bindings.archive = ["ctrl+a"]
		keymap.bindings.restore = ["ctrl+r"]
		const harness = await renderLaneKeymap({ kittyKeyboard: true }, keymap)
		try {
			await harness.pressShortcut("a", { ctrl: true })
			await harness.pressShortcut("r", { ctrl: true })
			expect(harness.archives()).toBe(1)
			expect(harness.restores()).toBe(1)
		} finally {
			harness.renderer.destroy()
		}
	})
})
