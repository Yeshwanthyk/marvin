import type { JSX } from "@opentui/solid"
import { splitProps } from "solid-js"
import { getTreeSitterClient } from "@opentui/core"
import { useTerminalDimensions } from "../context/terminal.js"
import { useTheme } from "../context/theme.js"

export type DiffView = "auto" | "unified" | "split"

export type DiffWrapMode = "word" | "char" | "none"

export type DiffProps = Omit<JSX.IntrinsicElements["diff"], "diff" | "view" | "filetype" | "syntaxStyle" | "treeSitterClient"> & {
	diffText: string
	filetype?: string
	view?: DiffView
	wrapMode?: DiffWrapMode
}

export function Diff(props: DiffProps): JSX.Element {
	const dimensions = useTerminalDimensions()
	const { theme, syntaxStyle } = useTheme()

	const [local, rest] = splitProps(props, ["diffText", "filetype", "view", "wrapMode"])

	const computedView = (): "unified" | "split" => {
		const requested = local.view ?? "auto"
		if (requested === "unified" || requested === "split") return requested
		return dimensions().width > 120 ? "split" : "unified"
	}

	return (
		<diff
			diff={local.diffText}
			view={computedView()}
			filetype={local.filetype ?? "text"}
			wrapMode={local.wrapMode ?? "none"}
			syntaxStyle={syntaxStyle}
			treeSitterClient={getTreeSitterClient()}
			showLineNumbers
			lineNumberFg={theme.diffLineNumberFg}
			lineNumberBg={theme.diffLineNumberBg}
			addedBg={theme.diffAddedBg}
			removedBg={theme.diffRemovedBg}
			contextBg={theme.diffContextBg}
			addedContentBg={theme.diffHighlightAddedBg}
			removedContentBg={theme.diffHighlightRemovedBg}
			addedSignColor={theme.diffAddedSign}
			removedSignColor={theme.diffRemovedSign}
			addedLineNumberBg={theme.diffAddedLineNumberBg}
			removedLineNumberBg={theme.diffRemovedLineNumberBg}
			selectionBg={theme.selectionBg}
			selectionFg={theme.selectionFg}
			{...rest}
		/>
	)
}
