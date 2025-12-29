import type { JSX } from "@opentui/solid"
import { Show, splitProps } from "solid-js"
import { TextAttributes } from "@opentui/core"
import { useTheme, type RGBA } from "../context/theme.js"
import { Panel } from "./panel.js"

export type DialogProps = Omit<JSX.IntrinsicElements["box"], "children"> & {
	open: boolean
	title?: string
	borderColor?: RGBA
	closeOnOverlayClick?: boolean
	onClose?: () => void
	children?: JSX.Element
}

export function Dialog(props: DialogProps): JSX.Element {
	const { theme } = useTheme()
	const [local, rest] = splitProps(props, ["open", "title", "borderColor", "closeOnOverlayClick", "onClose", "children"])

	return (
		<Show when={local.open}>
			<box position="absolute" top={0} left={0} width="100%" height="100%" zIndex={900}>
				<box
					position="absolute"
					top={0}
					left={0}
					width="100%"
					height="100%"
					backgroundColor={theme.background}
					opacity={0.8}
					onMouseUp={() => {
						if (local.closeOnOverlayClick === false) return
						local.onClose?.()
					}}
				/>
				<box
					position="absolute"
					top="15%"
					left="15%"
					width="70%"
					maxHeight="70%"
					zIndex={901}
					{...rest}
				>
					<Panel variant="panel" borderColor={local.borderColor ?? theme.borderActive} paddingX={2} paddingY={1}>
						<Show when={local.title}>
							<text fg={theme.text} attributes={TextAttributes.BOLD}>
								{local.title}
							</text>
							<box height={1} />
						</Show>
						{local.children}
					</Panel>
				</box>
			</box>
		</Show>
	)
}
