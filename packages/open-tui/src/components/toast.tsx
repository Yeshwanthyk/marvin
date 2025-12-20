import type { JSX } from "@opentui/solid"
import { For, Show, splitProps } from "solid-js"
import { useTheme } from "../context/theme.js"
import { Badge } from "./badge.js"
import { Panel } from "./panel.js"

export type ToastVariant = "info" | "success" | "warning" | "error"

export interface ToastItem {
	id: string
	title: string
	message?: string
	variant?: ToastVariant
}

export type ToastViewportPosition = "top-right" | "bottom-right" | "top-left" | "bottom-left"

export type ToastViewportProps = Omit<JSX.IntrinsicElements["box"], "children"> & {
	toasts: ToastItem[]
	position?: ToastViewportPosition
	maxToasts?: number
}

export function ToastViewport(props: ToastViewportProps): JSX.Element {
	const [local, rest] = splitProps(props, ["toasts", "position", "maxToasts"])

	const position = () => local.position ?? "top-right"
	const maxToasts = () => local.maxToasts ?? 3

	const anchorProps = (): Pick<JSX.IntrinsicElements["box"], "top" | "right" | "bottom" | "left"> => {
		switch (position()) {
			case "top-left":
				return { top: 1, left: 2 }
			case "bottom-left":
				return { bottom: 1, left: 2 }
			case "bottom-right":
				return { bottom: 1, right: 2 }
			case "top-right":
			default:
				return { top: 1, right: 2 }
		}
	}

	return (
		<box
			position="absolute"
			zIndex={1000}
			flexDirection="column"
			gap={1}
			{...anchorProps()}
			{...rest}
		>
			<For each={local.toasts.slice(0, maxToasts())}>{(toast) => <Toast toast={toast} />}</For>
		</box>
	)
}

export function Toast(props: { toast: ToastItem }): JSX.Element {
	const { theme } = useTheme()

	const borderColor = () => {
		switch (props.toast.variant ?? "info") {
			case "success":
				return theme.success
			case "warning":
				return theme.warning
			case "error":
				return theme.error
			case "info":
			default:
				return theme.info
		}
	}

	return (
		<Panel variant="menu" borderColor={borderColor()} paddingX={1} paddingY={0}>
			<box flexDirection="row" gap={1} alignItems="center">
				<Badge label={(props.toast.variant ?? "info").toUpperCase()} variant={props.toast.variant ?? "info"} />
				<text fg={theme.text}>{props.toast.title}</text>
			</box>
			<Show when={props.toast.message}>
				<box height={1} />
				<text fg={theme.textMuted}>{props.toast.message}</text>
			</Show>
		</Panel>
	)
}
