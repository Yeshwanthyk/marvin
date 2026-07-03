import { createComponent, onCleanup, type JSX } from "solid-js"
import { useRenderer } from "@opentui/solid"
import { createDefaultOpenTuiKeymap } from "@opentui/keymap/opentui"
import { reactiveMatcherFromSignal, useBindings, KeymapProvider, useKeymap } from "@opentui/keymap/solid"
import { registerModBindings } from "@opentui/keymap/addons"
import type { LaneKeymapConfig } from "@yeshwanthyk/runtime-effect/config.js"

export type LaneKeymapDirection = "left" | "right" | "up" | "down"
export type LaneMoveDirection = "left" | "right" | "up" | "down"
export type LaneNavMode = "off" | "sticky" | "oneshot" | "prefix"

const COMMAND_K_RAW_SEQUENCES = new Set([
	"\x1bk",
	"\x1b[107;9u",
	"\x1b[75;10u",
	"\x1b[27;9;107~",
	"\x1b[27;10;75~",
])

const CTRL_C_RAW_SEQUENCES = new Set(["\x03"])

export interface TuiLaneKeymapRootProps {
	children: JSX.Element
}

export function TuiLaneKeymapRoot(props: TuiLaneKeymapRootProps): JSX.Element {
	const renderer = useRenderer()
	const keymap = createDefaultOpenTuiKeymap(renderer)
	registerModBindings(keymap)

	return createComponent(KeymapProvider, {
		keymap,
		get children() {
			return props.children
		},
	})
}

export interface TuiLaneKeyBindingsProps {
	navMode: () => LaneNavMode
	setNavMode: (value: LaneNavMode) => void
	keymap: LaneKeymapConfig
	modalOpen: () => boolean
	isResponding: () => boolean
	shouldOwnShiftArrows: () => boolean
	onNavigate: (direction: LaneKeymapDirection) => void
	onMove: (direction: LaneMoveDirection) => void
	onOverview: () => void
	onNewSession: () => void
	onRename: () => void
	onJumpProject: (index: number) => void
	onJump: () => void
	onArchive: () => void
	onRestore: () => void
	onDetach: () => void
}

const commandKChords = new Set(["mod+k", "super+k", "meta+k"])

const hasCommandKBinding = (keys: readonly string[]): boolean => keys.some((key) => commandKChords.has(key))

const bindingsForDirection = (config: LaneKeymapConfig, direction: LaneKeymapDirection): readonly string[] => {
	switch (direction) {
		case "left":
			return config.bindings.sessionPrev
		case "right":
			return config.bindings.sessionNext
		case "up":
			return config.bindings.projectPrev
		case "down":
			return config.bindings.projectNext
	}
}

const legacyBindingsForDirection = (direction: LaneKeymapDirection): readonly string[] => {
	switch (direction) {
		case "left":
			return ["left", "h"]
		case "right":
			return ["right", "l"]
		case "up":
			return ["up", "k"]
		case "down":
			return ["down", "j"]
	}
}

const moveBindingsForDirection = (config: LaneKeymapConfig, direction: LaneMoveDirection): readonly string[] => {
	switch (direction) {
		case "left":
			return config.bindings.moveSessionPrev
		case "right":
			return config.bindings.moveSessionNext
		case "up":
			return config.bindings.moveProjectPrev
		case "down":
			return config.bindings.moveProjectNext
	}
}

const jumpProjectBindings = (config: LaneKeymapConfig): Array<{ index: number; keys: readonly string[] }> => [
	{ index: 0, keys: config.bindings.jumpProject1 },
	{ index: 1, keys: config.bindings.jumpProject2 },
	{ index: 2, keys: config.bindings.jumpProject3 },
	{ index: 3, keys: config.bindings.jumpProject4 },
	{ index: 4, keys: config.bindings.jumpProject5 },
	{ index: 5, keys: config.bindings.jumpProject6 },
	{ index: 6, keys: config.bindings.jumpProject7 },
	{ index: 7, keys: config.bindings.jumpProject8 },
	{ index: 8, keys: config.bindings.jumpProject9 },
]

const shiftArrowDirection = (event: { name: string; shift: boolean; ctrl: boolean; meta: boolean; super?: boolean }): LaneKeymapDirection | null => {
	if (!event.shift || event.ctrl || event.meta || event.super === true) return null
	if (event.name === "left" || event.name === "right" || event.name === "up" || event.name === "down") return event.name
	return null
}

const isShiftArrowBinding = (key: string, direction: LaneKeymapDirection): boolean => key === `shift+${direction}`

export function TuiLaneKeyBindings(props: TuiLaneKeyBindingsProps): JSX.Element {
	const keymap = useKeymap()
	const navInactive = () => props.navMode() === "off"
	const navActive = () => (props.navMode() === "sticky" || props.navMode() === "oneshot") && !props.modalOpen()
	const prefixActive = () => props.navMode() === "prefix" && !props.modalOpen()
	const canStartNav = () => !props.modalOpen() && navInactive()
	const canToggleNav = () => !props.modalOpen()
	const canOpenCommand = () => !props.modalOpen()
	const shouldStartFromActivationKey = (key: string): boolean => !(props.isResponding() && key === "escape")

	const disposeShiftArrowInput = keymap.intercept(
		"key",
		(ctx) => {
			if (props.modalOpen()) return
			const direction = shiftArrowDirection(ctx.event)
			if (!direction) return
			if (!props.shouldOwnShiftArrows()) return
			const chord = `shift+${direction}`
			if (prefixActive() && moveBindingsForDirection(props.keymap, direction).includes(chord)) {
				ctx.consume()
				props.onMove(direction)
				props.setNavMode("off")
				return
			}
			if (navInactive() && bindingsForDirection(props.keymap, direction).includes(chord)) {
				ctx.consume()
				props.onNavigate(direction)
			}
		},
		{ priority: 2000 },
	)
	onCleanup(disposeShiftArrowInput)

	const disposeCommandKRawInput = keymap.intercept(
		"raw",
		(ctx) => {
			if (!canOpenCommand() || !hasCommandKBinding(props.keymap.bindings.jump) || !COMMAND_K_RAW_SEQUENCES.has(ctx.sequence)) {
				return
			}

			ctx.stop()
			props.onJump()
		},
		{ priority: 1000 },
	)
	onCleanup(disposeCommandKRawInput)

	const disposeCtrlCRawInput = keymap.intercept(
		"raw",
		(ctx) => {
			if (!CTRL_C_RAW_SEQUENCES.has(ctx.sequence)) return
			ctx.stop()
			props.onDetach()
		},
		{ priority: 2000 },
	)
	onCleanup(disposeCtrlCRawInput)

	useBindings(() => ({
		priority: 2000,
		enabled: true,
		bindings: [{
			key: "ctrl+c",
			cmd: () => {
				props.onDetach()
				return true
			},
		}],
	}))

	useBindings(() => ({
		priority: 1000,
		enabled: reactiveMatcherFromSignal(canStartNav),
		bindings: props.keymap.prefixKey.map((key) => ({
			key,
			cmd: () => {
				props.setNavMode("prefix")
				return true
			},
		})),
	}))

	useBindings(() => ({
		priority: 1000,
		enabled: reactiveMatcherFromSignal(() => canStartNav() && props.keymap.activation.behavior === "sticky"),
		bindings: props.keymap.activation.behavior === "sticky" ? props.keymap.activation.enter.map((key) => ({
			key,
			cmd: () => {
				if (!shouldStartFromActivationKey(key)) return false
				props.setNavMode("sticky")
				return true
			},
		})) : [],
	}))

	useBindings(() => ({
		priority: 1000,
		enabled: reactiveMatcherFromSignal(() => canStartNav() && props.keymap.activation.behavior === "oneshot"),
		bindings: props.keymap.activation.behavior === "oneshot" ? props.keymap.activation.prefix.map((key) => ({
			key,
			cmd: () => {
				if (!shouldStartFromActivationKey(key)) return false
				props.setNavMode("oneshot")
				return true
			},
		})) : [],
	}))

	useBindings(() => ({
		priority: 1000,
		enabled: reactiveMatcherFromSignal(() => canToggleNav() && props.keymap.activation.behavior === "toggle"),
		bindings: props.keymap.activation.behavior === "toggle" ? props.keymap.activation.toggle.map((key) => ({
			key,
			cmd: () => {
				if (props.navMode() === "off" && !shouldStartFromActivationKey(key)) return false
				props.setNavMode(props.navMode() === "off" ? "sticky" : "off")
				return true
			},
		})) : [],
	}))

	useBindings(() => ({
		priority: 1000,
		enabled: reactiveMatcherFromSignal(navActive),
		bindings: [
			...(props.keymap.activation.behavior === "sticky" ? props.keymap.activation.exit : []),
			...(props.keymap.activation.behavior === "oneshot" ? props.keymap.activation.cancel : []),
			...(props.keymap.activation.behavior === "toggle" ? props.keymap.activation.exit : []),
		].map((key) => ({
			key,
			cmd: () => {
				props.setNavMode("off")
				return true
			},
		})),
	}))

	useBindings(() => ({
		priority: 1000,
		enabled: reactiveMatcherFromSignal(navActive),
		bindings: (["left", "right", "up", "down"] as const).flatMap((direction) =>
			[...new Set([...bindingsForDirection(props.keymap, direction), ...legacyBindingsForDirection(direction)])].map((key) => ({
				key,
				cmd: () => {
					const wasOneShot = props.navMode() === "oneshot"
					props.onNavigate(direction)
					if (wasOneShot) props.setNavMode("off")
					return true
				},
			})),
		),
	}))

	useBindings(() => ({
		priority: 1000,
		enabled: reactiveMatcherFromSignal(() => canOpenCommand() && navInactive()),
		bindings: (["left", "right", "up", "down"] as const).flatMap((direction) =>
			bindingsForDirection(props.keymap, direction).filter((key) => isShiftArrowBinding(key, direction)).map((key) => ({
				key,
				cmd: () => {
					if (!props.shouldOwnShiftArrows()) return false
					props.onNavigate(direction)
					return true
				},
			})),
		),
	}))

	useBindings(() => ({
		priority: 1000,
		enabled: reactiveMatcherFromSignal(prefixActive),
		bindings: [
			{
				key: "escape",
				cmd: () => {
					props.setNavMode("off")
					return true
				},
			},
			...(["left", "right", "up", "down"] as const).flatMap((direction) =>
				legacyBindingsForDirection(direction).map((key) => ({
					key,
					cmd: () => {
						props.onNavigate(direction)
						props.setNavMode("off")
						return true
					},
				})),
			),
			...(["left", "right", "up", "down"] as const).flatMap((direction) =>
				moveBindingsForDirection(props.keymap, direction).map((key) => ({
					key,
					cmd: () => {
						props.onMove(direction)
						props.setNavMode("off")
						return true
					},
				})),
			),
			...props.keymap.bindings.overview.map((key) => ({
				key,
				cmd: () => {
					props.onOverview()
					props.setNavMode("off")
					return true
				},
			})),
			...props.keymap.bindings.newSession.map((key) => ({
				key,
				cmd: () => {
					props.onNewSession()
					props.setNavMode("off")
					return true
				},
			})),
			...props.keymap.bindings.rename.map((key) => ({
				key,
				cmd: () => {
					props.onRename()
					props.setNavMode("off")
					return true
				},
			})),
			...jumpProjectBindings(props.keymap).flatMap(({ index, keys }) =>
				keys.map((key) => ({
					key,
					cmd: () => {
						props.onJumpProject(index)
						props.setNavMode("off")
						return true
					},
				})),
			),
		],
	}))

	useBindings(() => ({
		priority: 1000,
		enabled: reactiveMatcherFromSignal(canOpenCommand),
		bindings: [
			...props.keymap.bindings.jump.map((key) => ({
				key,
				cmd: () => {
					props.onJump()
					return true
				},
			})),
			...props.keymap.bindings.archive.map((key) => ({
				key,
				cmd: () => {
					props.onArchive()
					return true
				},
			})),
			...props.keymap.bindings.restore.map((key) => ({
				key,
				cmd: () => {
					props.onRestore()
					return true
				},
			})),
		],
	}))

	return undefined
}
