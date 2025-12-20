import type { JSX } from "@opentui/solid"
import { splitProps } from "solid-js"
import { TextAttributes } from "@opentui/core"
import { useTheme, type RGBA } from "../context/theme.js"

export type BadgeVariant = "neutral" | "info" | "success" | "warning" | "error"

export type BadgeProps = Omit<JSX.IntrinsicElements["box"], "children"> & {
	label: string
	variant?: BadgeVariant
	fg?: RGBA
	bg?: RGBA
}

export function Badge(props: BadgeProps): JSX.Element {
	const { theme } = useTheme()
	const [local, rest] = splitProps(props, ["label", "variant", "fg", "bg"])

	const resolvedFg = (): RGBA => {
		if (local.fg) return local.fg
		switch (local.variant ?? "neutral") {
			case "info":
				return theme.info
			case "success":
				return theme.success
			case "warning":
				return theme.warning
			case "error":
				return theme.error
			case "neutral":
			default:
				return theme.textMuted
		}
	}

	const resolvedBg = (): RGBA => local.bg ?? theme.backgroundElement

	return (
		<box
			backgroundColor={resolvedBg()}
			border
			borderColor={theme.borderSubtle}
			paddingLeft={1}
			paddingRight={1}
			paddingTop={0}
			paddingBottom={0}
			flexShrink={0}
			{...rest}
		>
			<text fg={resolvedFg()} attributes={TextAttributes.BOLD}>
				{local.label}
			</text>
		</box>
	)
}
