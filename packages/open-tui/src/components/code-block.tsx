import type { CodeRenderable } from "@opentui/core"
import { getTreeSitterClient } from "@opentui/core"
import type { JSX } from "@opentui/solid"
import { Show, createSignal, splitProps, type Accessor } from "solid-js"
import { useTheme } from "../context/theme.js"

export type CodeBlockProps = Omit<JSX.IntrinsicElements["box"], "children"> & {
	content: string
	filetype?: string
	title?: string
	showLineNumbers?: boolean
	wrapMode?: "word" | "char" | "none"
	streaming?: boolean
	conceal?: boolean
}

export function CodeBlock(props: CodeBlockProps): JSX.Element {
	const { theme, syntaxStyle } = useTheme()
	const [local, rest] = splitProps(props, [
		"content",
		"filetype",
		"title",
		"showLineNumbers",
		"wrapMode",
		"streaming",
		"conceal",
	])

	const [codeRef, setCodeRef] = createSignal<CodeRenderable | undefined>(undefined)

	const showLineNumbers = () => local.showLineNumbers ?? true

	// Minimal: no border, subtle bg tint
	return (
		<box
			flexDirection="column"
			backgroundColor={theme.backgroundElement}
			paddingLeft={1}
			paddingRight={1}
			{...rest}
		>
			<Show when={local.title}>
				<box flexDirection="row" alignItems="center" gap={1} paddingBottom={1}>
					<text fg={theme.textMuted}>
						{local.title}
					</text>
				</box>
			</Show>
			<box flexDirection="row">
				<Show when={showLineNumbers() && codeRef()}>
					{(ref: Accessor<CodeRenderable>) => (
						<line_number
							target={ref()}
							fg={theme.diffLineNumberFg}
							bg={theme.diffLineNumberBg}
							paddingRight={1}
							flexShrink={0}
						/>
					)}
				</Show>
				<code
					ref={setCodeRef}
					content={local.content}
					filetype={local.filetype ?? "text"}
					syntaxStyle={syntaxStyle}
					treeSitterClient={getTreeSitterClient()}
					wrapMode={local.wrapMode ?? "word"}
					streaming={local.streaming ?? false}
					conceal={local.conceal ?? false}
					drawUnstyledText
					selectionBg={theme.selectionBg}
					selectionFg={theme.selectionFg}
					width="100%"
					height="100%"
				/>
			</box>
		</box>
	)
}
