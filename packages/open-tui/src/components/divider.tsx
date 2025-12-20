import type { JSX } from "@opentui/solid"
import { splitProps } from "solid-js"
import { useTheme, type RGBA } from "../context/theme.js"

export type DividerOrientation = "horizontal" | "vertical"

export type DividerProps = Omit<JSX.IntrinsicElements["box"], "children"> & {
	orientation?: DividerOrientation
	color?: RGBA
}

export function Divider(props: DividerProps): JSX.Element {
	const { theme } = useTheme()
	const [local, rest] = splitProps(props, ["orientation", "color"])

	const color = () => local.color ?? theme.borderSubtle
	const orientation = () => local.orientation ?? "horizontal"

	if (orientation() === "vertical") {
		return <box border={["left"]} borderColor={color()} width={1} height={rest.height ?? "100%"} flexShrink={0} {...rest} />
	}

	return <box border={["top"]} borderColor={color()} height={1} width={rest.width ?? "100%"} flexShrink={0} {...rest} />
}
