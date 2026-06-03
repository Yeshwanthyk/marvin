import { createComponent, onCleanup, type JSX } from "solid-js"
import { useRenderer } from "@opentui/solid"
import { createDefaultOpenTuiKeymap } from "@opentui/keymap/opentui"
import { reactiveMatcherFromSignal, useBindings, KeymapProvider, useKeymap } from "@opentui/keymap/solid"
import { registerModBindings } from "@opentui/keymap/addons"
import type { LaneKeymapConfig } from "@yeshwanthyk/runtime-effect/config.js"

export type LaneKeymapDirection = "left" | "right" | "up" | "down"
export type LaneNavMode = "off" | "sticky" | "oneshot"

const COMMAND_K_RAW_SEQUENCES = new Set([
	"\x1bk",
	"\x1b[107;9u",
	"\x1b[75;10u",
	"\x1b[27;9;107~",
	"\x1b[27;10;75~",
])

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
	onNavigate: (direction: LaneKeymapDirection) => void
	onJump: () => void
	onArchive: () => void
	onRestore: () => void
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

export function TuiLaneKeyBindings(props: TuiLaneKeyBindingsProps): JSX.Element {
	const keymap = useKeymap()
	const navInactive = () => props.navMode() === "off"
	const navActive = () => props.navMode() !== "off" && !props.modalOpen()
	const canStartNav = () => !props.modalOpen() && !props.isResponding() && navInactive()
	const canToggleNav = () => !props.modalOpen() && (!props.isResponding() || !navInactive())
	const canOpenCommand = () => !props.modalOpen()

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

	useBindings(() => ({
		priority: 1000,
		enabled: reactiveMatcherFromSignal(() => canStartNav() && props.keymap.activation.behavior === "sticky"),
		bindings: props.keymap.activation.behavior === "sticky" ? props.keymap.activation.enter.map((key) => ({
			key,
			cmd: () => {
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
			bindingsForDirection(props.keymap, direction).map((key) => ({
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
