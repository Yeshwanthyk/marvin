import { parseColor } from "@opentui/core"
import type { JSX } from "@opentui/solid"
import { splitProps } from "solid-js"
import { useTheme, type RGBA } from "../context/theme.js"

const transparentBg = parseColor("transparent")

export type PanelVariant = "panel" | "element" | "menu" | "transparent"

export type PanelProps = JSX.IntrinsicElements["box"] & {
	variant?: PanelVariant
	paddingX?: number | `${number}%`
	paddingY?: number | `${number}%`
	accentLeft?: RGBA
	accentWidth?: number
}

export function Panel(props: PanelProps): JSX.Element {
	const { theme } = useTheme()

	const [local, rest] = splitProps(props, [
		"variant",
		"padding",
		"paddingLeft",
		"paddingRight",
		"paddingTop",
		"paddingBottom",
		"paddingX",
		"paddingY",
		"backgroundColor",
		"border",
		"borderColor",
		"accentLeft",
		"accentWidth",
		"children",
	])

	const resolvedBg = (): RGBA => {
		if (local.backgroundColor !== undefined) return local.backgroundColor as RGBA
		switch (local.variant ?? "panel") {
			case "element":
				return theme.backgroundElement
			case "menu":
				return theme.backgroundMenu
			case "transparent":
				return transparentBg
			case "panel":
			default:
				return theme.backgroundPanel
		}
	}

	const resolvedBorder = () => local.border ?? true
	const resolvedBorderColor = (): RGBA => (local.borderColor as RGBA | undefined) ?? theme.borderSubtle

	const paddingLeft = () => local.paddingLeft ?? local.paddingX ?? local.padding ?? 1
	const paddingRight = () => local.paddingRight ?? local.paddingX ?? local.padding ?? 1
	const paddingTop = () => local.paddingTop ?? local.paddingY ?? local.padding ?? 0
	const paddingBottom = () => local.paddingBottom ?? local.paddingY ?? local.padding ?? 0

	return (
		<box flexDirection="row" {...rest}>
			{local.accentLeft && (
				<box
					width={local.accentWidth ?? 1}
					backgroundColor={local.accentLeft}
					flexShrink={0}
				/>
			)}
			<box
				flexDirection="column"
				backgroundColor={resolvedBg()}
				border={resolvedBorder()}
				borderColor={resolvedBorderColor()}
				paddingLeft={paddingLeft()}
				paddingRight={paddingRight()}
				paddingTop={paddingTop()}
				paddingBottom={paddingBottom()}
				flexGrow={1}
			>
				{local.children}
			</box>
		</box>
	)
}
