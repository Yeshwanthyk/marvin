import { createComponent, type JSX } from "solid-js"
import { useRenderer } from "@opentui/solid"
import { createDefaultOpenTuiKeymap } from "@opentui/keymap/opentui"
import { reactiveMatcherFromSignal, useBindings, KeymapProvider } from "@opentui/keymap/solid"
import { registerModBindings } from "@opentui/keymap/addons"

export type LaneKeymapDirection = "left" | "right" | "up" | "down"

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
	navMode: () => boolean
	setNavMode: (value: boolean) => void
	modalOpen: () => boolean
	isResponding: () => boolean
	onNavigate: (direction: LaneKeymapDirection) => void
	onJump: () => void
	onArchive: () => void
}

export function TuiLaneKeyBindings(props: TuiLaneKeyBindingsProps): JSX.Element {
	const canEnterNav = () => !props.modalOpen() && !props.isResponding()
	const navActive = () => props.navMode() && !props.modalOpen()
	const canOpenCommand = () => !props.modalOpen()

	useBindings(() => ({
		priority: 1000,
		enabled: reactiveMatcherFromSignal(canEnterNav),
		bindings: ["escape", "ctrl+["].map((key) => ({
			key,
			cmd: () => {
				props.setNavMode(true)
				return true
			},
		})),
	}))

	useBindings(() => ({
		priority: 1000,
		enabled: reactiveMatcherFromSignal(navActive),
		bindings: [
			{
				key: "return",
				cmd: () => {
					props.setNavMode(false)
					return true
				},
			},
			...(["left", "right", "up", "down"] as const).map((direction) => ({
				key: direction,
				cmd: () => {
					props.onNavigate(direction)
					return true
				},
			})),
		],
	}))

	useBindings(() => ({
		priority: 1000,
		enabled: reactiveMatcherFromSignal(canOpenCommand),
		bindings: [
			...["mod+k", "super+k", "meta+k", "ctrl+k"].map((key) => ({
				key,
				cmd: () => {
					props.onJump()
					return true
				},
			})),
			...["mod+shift+a", "super+shift+a", "ctrl+shift+a"].map((key) => ({
				key,
				cmd: () => {
					props.onArchive()
					return true
				},
			})),
		],
	}))

	return undefined
}
