/**
 * Loader/spinner component using OpenTUI spinner
 */

import { parseColor, type RGBA } from "@opentui/core"
import "opentui-spinner/solid"
import { Show } from "solid-js"

export interface LoaderProps {
	/** Message to display alongside spinner */
	message?: string
	/** Primary color for spinner */
	color?: RGBA
	/** Dim color for message text */
	dimColor?: RGBA
	/** Animation interval in ms */
	interval?: number
}

// Default spinner frames (bouncing dots style)
const DEFAULT_FRAMES = ["    ", ".   ", "..  ", "... ", "....", " ...", "  ..", "   ."]
const DEFAULT_COLOR = parseColor("#64b4ff")

/**
 * Animated loader with optional message
 *
 * @example
 * ```tsx
 * <Loader message="Loading..." color={theme.primary} />
 * ```
 */
export function Loader(props: LoaderProps) {
	const interval = () => props.interval ?? 120
	const color = () => props.color ?? DEFAULT_COLOR

	return (
		<box flexDirection="row" gap={1}>
			<spinner frames={DEFAULT_FRAMES} interval={interval()} color={color()} />
			<Show when={props.message && props.dimColor}>
				<text fg={props.dimColor!}>{props.message}</text>
			</Show>
			<Show when={props.message && !props.dimColor}>
				<text>{props.message}</text>
			</Show>
		</box>
	)
}
