import { visibleWidth } from "../../utils.js";
import type { EditorState, LayoutLine, VisualLine } from "./types.js";

// Grapheme segmenter for proper Unicode iteration (handles emojis, etc.)
const segmenter = new Intl.Segmenter();

export function layoutText(
	state: EditorState,
	contentWidth: number,
): LayoutLine[] {
	const layoutLines: LayoutLine[] = [];

	if (
		state.lines.length === 0 ||
		(state.lines.length === 1 && state.lines[0] === "")
	) {
		layoutLines.push({
			text: "",
			hasCursor: true,
			cursorPos: 0,
		});
		return layoutLines;
	}

	for (let i = 0; i < state.lines.length; i++) {
		const line = state.lines[i] || "";
		const isCurrentLine = i === state.cursorLine;
		const lineVisibleWidth = visibleWidth(line);

		if (lineVisibleWidth <= contentWidth) {
			if (isCurrentLine) {
				layoutLines.push({
					text: line,
					hasCursor: true,
					cursorPos: state.cursorCol,
				});
			} else {
				layoutLines.push({
					text: line,
					hasCursor: false,
				});
			}
		} else {
			const chunks: { text: string; startIndex: number; endIndex: number }[] =
				[];
			let currentChunk = "";
			let currentWidth = 0;
			let chunkStartIndex = 0;
			let currentIndex = 0;

			for (const seg of segmenter.segment(line)) {
				const grapheme = seg.segment;
				const graphemeWidth = visibleWidth(grapheme);

				if (
					currentWidth + graphemeWidth > contentWidth &&
					currentChunk !== ""
				) {
					chunks.push({
						text: currentChunk,
						startIndex: chunkStartIndex,
						endIndex: currentIndex,
					});
					currentChunk = grapheme;
					currentWidth = graphemeWidth;
					chunkStartIndex = currentIndex;
				} else {
					currentChunk += grapheme;
					currentWidth += graphemeWidth;
				}
				currentIndex += grapheme.length;
			}

			if (currentChunk !== "") {
				chunks.push({
					text: currentChunk,
					startIndex: chunkStartIndex,
					endIndex: currentIndex,
				});
			}

			for (let chunkIndex = 0; chunkIndex < chunks.length; chunkIndex++) {
				const chunk = chunks[chunkIndex];
				if (!chunk) continue;

				const cursorPos = state.cursorCol;
				const isLastChunk = chunkIndex === chunks.length - 1;
				const hasCursorInChunk =
					isCurrentLine &&
					cursorPos >= chunk.startIndex &&
					(isLastChunk
						? cursorPos <= chunk.endIndex
						: cursorPos < chunk.endIndex);

				if (hasCursorInChunk) {
					layoutLines.push({
						text: chunk.text,
						hasCursor: true,
						cursorPos: cursorPos - chunk.startIndex,
					});
				} else {
					layoutLines.push({
						text: chunk.text,
						hasCursor: false,
					});
				}
			}
		}
	}

	return layoutLines;
}

export function buildVisualLineMap(
	lines: string[],
	width: number,
): VisualLine[] {
	const visualLines: VisualLine[] = [];

	for (let i = 0; i < lines.length; i++) {
		const line = lines[i] || "";
		const lineVisWidth = visibleWidth(line);

		if (line.length === 0) {
			visualLines.push({ logicalLine: i, startCol: 0, length: 0 });
		} else if (lineVisWidth <= width) {
			visualLines.push({ logicalLine: i, startCol: 0, length: line.length });
		} else {
			let currentWidth = 0;
			let chunkStartIndex = 0;
			let currentIndex = 0;

			for (const seg of segmenter.segment(line)) {
				const grapheme = seg.segment;
				const graphemeWidth = visibleWidth(grapheme);

				if (
					currentWidth + graphemeWidth > width &&
					currentIndex > chunkStartIndex
				) {
					visualLines.push({
						logicalLine: i,
						startCol: chunkStartIndex,
						length: currentIndex - chunkStartIndex,
					});
					chunkStartIndex = currentIndex;
					currentWidth = graphemeWidth;
				} else {
					currentWidth += graphemeWidth;
				}
				currentIndex += grapheme.length;
			}

			if (currentIndex > chunkStartIndex) {
				visualLines.push({
					logicalLine: i,
					startCol: chunkStartIndex,
					length: currentIndex - chunkStartIndex,
				});
			}
		}
	}

	return visualLines;
}

export function findCurrentVisualLine(
	visualLines: VisualLine[],
	cursorLine: number,
	cursorCol: number,
): number {
	for (let i = 0; i < visualLines.length; i++) {
		const vl = visualLines[i];
		if (!vl) continue;

		if (vl.logicalLine === cursorLine) {
			const colInSegment = cursorCol - vl.startCol;
			const isLastSegmentOfLine =
				i === visualLines.length - 1 ||
				visualLines[i + 1]?.logicalLine !== vl.logicalLine;
			if (
				colInSegment >= 0 &&
				(colInSegment < vl.length ||
					(isLastSegmentOfLine && colInSegment <= vl.length))
			) {
				return i;
			}
		}
	}

	return visualLines.length - 1;
}
