import { describe, expect, it } from "bun:test"
import type { TestRendererOptions } from "@opentui/core/testing"
import type { LaneKeymapConfig } from "@yeshwanthyk/runtime-effect/config.js"
import type { LaneKeymapDirection, LaneMoveDirection, LaneNavMode } from "../src/ui/app-shell/TuiLaneKeymap.js"
import type { HumanTuiHarness } from "./helpers/tui-harness.js"

interface LaneKeymapHarness extends HumanTuiHarness {
	jumps: () => number
	archives: () => number
	restores: () => number
	detaches: () => number
	directions: () => LaneKeymapDirection[]
	moves: () => LaneMoveDirection[]
	overviews: () => number
	newSessions: () => number
	renames: () => number
	helps: () => number
	projectJumps: () => number[]
	navMode: () => LaneNavMode
}

const cloneDefaultLaneKeymap = (): LaneKeymapConfig => ({
	activation: {
		behavior: "sticky",
		enter: [],
		exit: ["return"],
	},
	prefixKey: ["ctrl+b"],
	bindings: {
		sessionPrev: ["shift+left"],
		sessionNext: ["shift+right"],
		projectPrev: ["shift+up"],
		projectNext: ["shift+down"],
		moveSessionPrev: ["shift+left", "shift+h"],
		moveSessionNext: ["shift+right", "shift+l"],
		moveProjectPrev: ["shift+up", "shift+k"],
		moveProjectNext: ["shift+down", "shift+j"],
		overview: ["o"],
		newSession: ["n"],
		rename: ["$"],
		help: ["?"],
		jump: ["mod+k", "super+k", "meta+k"],
		jumpProject1: ["1"],
		jumpProject2: ["2"],
		jumpProject3: ["3"],
		jumpProject4: ["4"],
		jumpProject5: ["5"],
		jumpProject6: ["6"],
		jumpProject7: ["7"],
		jumpProject8: ["8"],
		jumpProject9: ["9"],
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
	state: { isResponding?: boolean; shouldOwnShiftArrows?: boolean } = {},
): Promise<LaneKeymapHarness> {
	const { createComponent, createSignal, TuiLaneKeyBindings, TuiLaneKeymapRoot, renderHumanTui } = await loadTuiModules()
	let jumps = 0
	let archives = 0
	let restores = 0
	let detaches = 0
	const directions: LaneKeymapDirection[] = []
	const moves: LaneMoveDirection[] = []
	let overviews = 0
	let newSessions = 0
	let renames = 0
	let helps = 0
	const projectJumps: number[] = []
	const [navMode, setNavMode] = createSignal<LaneNavMode>("off")

	const harness = await renderHumanTui(() => {
		return createComponent(TuiLaneKeymapRoot, {
			get children() {
				return createComponent(TuiLaneKeyBindings, {
					navMode,
					setNavMode,
					keymap,
					modalOpen: () => false,
					isResponding: () => state.isResponding ?? false,
					shouldOwnShiftArrows: () => state.shouldOwnShiftArrows ?? true,
					onNavigate: (direction) => {
						directions.push(direction)
					},
					onMove: (direction) => {
						moves.push(direction)
					},
					onOverview: () => {
						overviews += 1
					},
					onNewSession: () => {
						newSessions += 1
					},
					onRename: () => {
						renames += 1
					},
					onHelp: () => {
						helps += 1
					},
					onJumpProject: (index) => {
						projectJumps.push(index)
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
					onDetach: () => {
						detaches += 1
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
		detaches: () => detaches,
		directions: () => [...directions],
		moves: () => [...moves],
		overviews: () => overviews,
		newSessions: () => newSessions,
		renames: () => renames,
		helps: () => helps,
		projectJumps: () => [...projectJumps],
		navMode,
	}
}

describe("TuiLaneKeyBindings", () => {
	it("refuses cross-project moves while the focused session is streaming", async () => {
		const { canMoveFocusedSessionAcrossProject } = await import("../src/ui/app-shell/lane-actions.js")

		expect(canMoveFocusedSessionAcrossProject("streaming", false)).toBe(false)
		expect(canMoveFocusedSessionAcrossProject("warm", true)).toBe(false)
		expect(canMoveFocusedSessionAcrossProject("warm", false)).toBe(true)
	})

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

	it("uses Shift-arrows for global lane focus", async () => {
		const harness = await renderLaneKeymap({ kittyKeyboard: true })
		try {
			harness.keys.pressArrow("right", { shift: true })
			await harness.flush()
			harness.keys.pressArrow("down", { shift: true })
			await harness.flush()
			expect(harness.directions()).toEqual(["right", "down"])
			expect(harness.navMode()).toBe("off")
		} finally {
			harness.renderer.destroy()
		}
	})

	it("leaves Shift-arrows to the composer while text selection is active", async () => {
		const harness = await renderLaneKeymap({ kittyKeyboard: true }, cloneDefaultLaneKeymap(), { shouldOwnShiftArrows: false })
		try {
			harness.keys.pressArrow("right", { shift: true })
			await harness.flush()
			expect(harness.directions()).toEqual([])
		} finally {
			harness.renderer.destroy()
		}
	})

	it("does not treat legacy plain arrow bindings as global no-prefix navigation", async () => {
		const keymap = cloneDefaultLaneKeymap()
		keymap.activation = { behavior: "sticky", enter: ["ctrl+[", "escape"], exit: ["return"] }
		keymap.bindings.sessionNext = ["right"]
		const harness = await renderLaneKeymap({ kittyKeyboard: true }, keymap)
		try {
			harness.keys.pressArrow("right")
			await harness.flush()
			expect(harness.directions()).toEqual([])

			await harness.pressShortcut("[", { ctrl: true })
			harness.keys.pressArrow("right")
			await harness.flush()
			expect(harness.directions()).toEqual(["right"])
		} finally {
			harness.renderer.destroy()
		}
	})

	it("does not start sticky lane mode from Escape or Ctrl-[ by default", async () => {
		const harness = await renderLaneKeymap({ kittyKeyboard: true })
		try {
			harness.keys.pressEscape()
			await harness.flush()
			expect(harness.navMode()).toBe("off")

			await harness.pressShortcut("[", { ctrl: true })
			expect(harness.navMode()).toBe("off")
		} finally {
			harness.renderer.destroy()
		}
	})

	it("starts sticky lane mode while a stream is responding", async () => {
		const keymap = cloneDefaultLaneKeymap()
		keymap.activation = { behavior: "sticky", enter: ["ctrl+[", "escape"], exit: ["return"] }
		const harness = await renderLaneKeymap({ kittyKeyboard: true }, keymap, { isResponding: true })
		try {
			await harness.pressShortcut("[", { ctrl: true })
			expect(harness.navMode()).toBe("sticky")

			harness.keys.pressArrow("right")
			await harness.flush()
			expect(harness.directions()).toEqual(["right"])
		} finally {
			harness.renderer.destroy()
		}
	})

	it("starts sticky lane mode from encoded Ctrl-[ while responding", async () => {
		const keymap = cloneDefaultLaneKeymap()
		keymap.activation = { behavior: "sticky", enter: ["ctrl+[", "escape"], exit: ["return"] }
		const harness = await renderLaneKeymap({ kittyKeyboard: false, otherModifiersMode: true }, keymap, { isResponding: true })
		try {
			await harness.pressShortcut("[", { ctrl: true })
			expect(harness.navMode()).toBe("sticky")
		} finally {
			harness.renderer.destroy()
		}
	})

	it("does not steal bare Escape from abort while responding", async () => {
		const keymap = cloneDefaultLaneKeymap()
		keymap.activation = { behavior: "sticky", enter: ["ctrl+[", "escape"], exit: ["return"] }
		const harness = await renderLaneKeymap({ kittyKeyboard: true }, keymap, { isResponding: true })
		try {
			harness.keys.pressEscape()
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

	it("dispatches Ctrl-B prefix focus, move, command, and project-jump chords", async () => {
		const harness = await renderLaneKeymap({ kittyKeyboard: true })
		try {
			await harness.pressShortcut("b", { ctrl: true })
			expect(harness.navMode()).toBe("prefix")
			harness.keys.pressArrow("right")
			await harness.flush()
			expect(harness.directions()).toEqual(["right"])
			expect(harness.navMode()).toBe("off")

			await harness.pressShortcut("b", { ctrl: true })
			harness.keys.pressArrow("left", { shift: true })
			await harness.flush()
			expect(harness.moves()).toEqual(["left"])

			await harness.pressShortcut("b", { ctrl: true })
			await harness.pressShortcut("n", {})
			await harness.pressShortcut("b", { ctrl: true })
			await harness.pressShortcut("$", {})
			await harness.pressShortcut("b", { ctrl: true })
			await harness.pressShortcut("o", {})
			await harness.pressShortcut("b", { ctrl: true })
			await harness.pressShortcut("3", {})
			await harness.pressShortcut("b", { ctrl: true })
			await harness.pressShortcut("?", {})
			expect(harness.newSessions()).toBe(1)
			expect(harness.renames()).toBe(1)
			expect(harness.overviews()).toBe(1)
			expect(harness.helps()).toBe(1)
			expect(harness.projectJumps()).toEqual([2])
		} finally {
			harness.renderer.destroy()
		}
	})

	it("cancels Ctrl-B prefix mode with Escape", async () => {
		const harness = await renderLaneKeymap({ kittyKeyboard: true })
		try {
			await harness.pressShortcut("b", { ctrl: true })
			expect(harness.navMode()).toBe("prefix")

			harness.keys.pressEscape()
			await harness.flush()
			expect(harness.navMode()).toBe("off")
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

	it("detaches globally with Ctrl-C", async () => {
		const harness = await renderLaneKeymap({ kittyKeyboard: true })
		try {
			await harness.pressShortcut("c", { ctrl: true })
			expect(harness.detaches()).toBe(1)
		} finally {
			harness.renderer.destroy()
		}
	})
})
