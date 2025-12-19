import { buildVisualLineMap, findCurrentVisualLine } from "./layout.js";
import type { EditorState } from "./types.js";

const WORD_BOUNDARY_REGEX = /\s|[(){}[\]<>.,;:'"!?+\-=*/\\|&%^$#@~`]/;

export class EditorDocument {
	private state: EditorState = {
		lines: [""],
		cursorLine: 0,
		cursorCol: 0,
	};

	getState(): EditorState {
		return this.state;
	}

	isEmpty(): boolean {
		return this.state.lines.length === 1 && this.state.lines[0] === "";
	}

	getText(): string {
		return this.state.lines.join("\n");
	}

	getLines(): string[] {
		return [...this.state.lines];
	}

	getCursor(): { line: number; col: number } {
		return { line: this.state.cursorLine, col: this.state.cursorCol };
	}

	reset(): void {
		this.state = {
			lines: [""],
			cursorLine: 0,
			cursorCol: 0,
		};
	}

	setText(text: string): void {
		const lines = text.replace(/\r\n/g, "\n").replace(/\r/g, "\n").split("\n");
		this.state.lines = lines.length === 0 ? [""] : lines;
		this.state.cursorLine = this.state.lines.length - 1;
		this.state.cursorCol = this.state.lines[this.state.cursorLine]?.length || 0;
	}

	setLinesAndCursor(
		lines: string[],
		cursorLine: number,
		cursorCol: number,
	): void {
		this.state.lines = lines.length === 0 ? [""] : lines;
		this.state.cursorLine = cursorLine;
		this.state.cursorCol = cursorCol;
	}

	insertText(text: string): void {
		const line = this.state.lines[this.state.cursorLine] || "";

		const before = line.slice(0, this.state.cursorCol);
		const after = line.slice(this.state.cursorCol);

		this.state.lines[this.state.cursorLine] = before + text + after;
		this.state.cursorCol += text.length;
	}

	insertMultiLine(pastedLines: string[]): void {
		if (pastedLines.length <= 1) {
			const text = pastedLines[0] || "";
			this.insertText(text);
			return;
		}

		const currentLine = this.state.lines[this.state.cursorLine] || "";
		const beforeCursor = currentLine.slice(0, this.state.cursorCol);
		const afterCursor = currentLine.slice(this.state.cursorCol);

		const newLines: string[] = [];

		for (let i = 0; i < this.state.cursorLine; i++) {
			newLines.push(this.state.lines[i] || "");
		}

		newLines.push(beforeCursor + (pastedLines[0] || ""));

		for (let i = 1; i < pastedLines.length - 1; i++) {
			newLines.push(pastedLines[i] || "");
		}

		newLines.push((pastedLines[pastedLines.length - 1] || "") + afterCursor);

		for (let i = this.state.cursorLine + 1; i < this.state.lines.length; i++) {
			newLines.push(this.state.lines[i] || "");
		}

		this.state.lines = newLines;

		this.state.cursorLine += pastedLines.length - 1;
		this.state.cursorCol = (pastedLines[pastedLines.length - 1] || "").length;
	}

	addNewLine(): void {
		const currentLine = this.state.lines[this.state.cursorLine] || "";

		const before = currentLine.slice(0, this.state.cursorCol);
		const after = currentLine.slice(this.state.cursorCol);

		this.state.lines[this.state.cursorLine] = before;
		this.state.lines.splice(this.state.cursorLine + 1, 0, after);

		this.state.cursorLine++;
		this.state.cursorCol = 0;
	}

	backspace(): void {
		if (this.state.cursorCol > 0) {
			const line = this.state.lines[this.state.cursorLine] || "";

			const before = line.slice(0, this.state.cursorCol - 1);
			const after = line.slice(this.state.cursorCol);

			this.state.lines[this.state.cursorLine] = before + after;
			this.state.cursorCol--;
			return;
		}

		if (this.state.cursorLine > 0) {
			const currentLine = this.state.lines[this.state.cursorLine] || "";
			const previousLine = this.state.lines[this.state.cursorLine - 1] || "";

			this.state.lines[this.state.cursorLine - 1] = previousLine + currentLine;
			this.state.lines.splice(this.state.cursorLine, 1);

			this.state.cursorLine--;
			this.state.cursorCol = previousLine.length;
		}
	}

	deleteForward(): void {
		const currentLine = this.state.lines[this.state.cursorLine] || "";

		if (this.state.cursorCol < currentLine.length) {
			const before = currentLine.slice(0, this.state.cursorCol);
			const after = currentLine.slice(this.state.cursorCol + 1);
			this.state.lines[this.state.cursorLine] = before + after;
			return;
		}

		if (this.state.cursorLine < this.state.lines.length - 1) {
			const nextLine = this.state.lines[this.state.cursorLine + 1] || "";
			this.state.lines[this.state.cursorLine] = currentLine + nextLine;
			this.state.lines.splice(this.state.cursorLine + 1, 1);
		}
	}

	deleteToStartOfLine(): void {
		const currentLine = this.state.lines[this.state.cursorLine] || "";

		if (this.state.cursorCol > 0) {
			this.state.lines[this.state.cursorLine] = currentLine.slice(
				this.state.cursorCol,
			);
			this.state.cursorCol = 0;
			return;
		}

		if (this.state.cursorLine > 0) {
			const previousLine = this.state.lines[this.state.cursorLine - 1] || "";
			this.state.lines[this.state.cursorLine - 1] = previousLine + currentLine;
			this.state.lines.splice(this.state.cursorLine, 1);
			this.state.cursorLine--;
			this.state.cursorCol = previousLine.length;
		}
	}

	deleteToEndOfLine(): void {
		const currentLine = this.state.lines[this.state.cursorLine] || "";

		if (this.state.cursorCol < currentLine.length) {
			this.state.lines[this.state.cursorLine] = currentLine.slice(
				0,
				this.state.cursorCol,
			);
			return;
		}

		if (this.state.cursorLine < this.state.lines.length - 1) {
			const nextLine = this.state.lines[this.state.cursorLine + 1] || "";
			this.state.lines[this.state.cursorLine] = currentLine + nextLine;
			this.state.lines.splice(this.state.cursorLine + 1, 1);
		}
	}

	deleteWordBackwards(): void {
		const currentLine = this.state.lines[this.state.cursorLine] || "";

		if (this.state.cursorCol === 0) {
			if (this.state.cursorLine > 0) {
				const previousLine = this.state.lines[this.state.cursorLine - 1] || "";
				this.state.lines[this.state.cursorLine - 1] =
					previousLine + currentLine;
				this.state.lines.splice(this.state.cursorLine, 1);
				this.state.cursorLine--;
				this.state.cursorCol = previousLine.length;
			}
			return;
		}

		const textBeforeCursor = currentLine.slice(0, this.state.cursorCol);

		let deleteFrom = this.state.cursorCol;
		const lastChar = textBeforeCursor[deleteFrom - 1] ?? "";

		if (this.isWordBoundary(lastChar)) {
			deleteFrom -= 1;
		} else {
			while (deleteFrom > 0) {
				const ch = textBeforeCursor[deleteFrom - 1] ?? "";
				if (this.isWordBoundary(ch)) {
					break;
				}
				deleteFrom -= 1;
			}
		}

		this.state.lines[this.state.cursorLine] =
			currentLine.slice(0, deleteFrom) +
			currentLine.slice(this.state.cursorCol);
		this.state.cursorCol = deleteFrom;
	}

	moveToLineStart(): void {
		this.state.cursorCol = 0;
	}

	moveToLineEnd(): void {
		const currentLine = this.state.lines[this.state.cursorLine] || "";
		this.state.cursorCol = currentLine.length;
	}

	moveCursor(deltaLine: number, deltaCol: number, width: number): void {
		if (deltaLine !== 0) {
			const visualLines = buildVisualLineMap(this.state.lines, width);
			const currentVisualLine = findCurrentVisualLine(
				visualLines,
				this.state.cursorLine,
				this.state.cursorCol,
			);

			const currentVL = visualLines[currentVisualLine];
			const visualCol = currentVL
				? this.state.cursorCol - currentVL.startCol
				: 0;

			const targetVisualLine = currentVisualLine + deltaLine;

			if (targetVisualLine >= 0 && targetVisualLine < visualLines.length) {
				const targetVL = visualLines[targetVisualLine];
				if (targetVL) {
					this.state.cursorLine = targetVL.logicalLine;
					const targetCol =
						targetVL.startCol + Math.min(visualCol, targetVL.length);
					const logicalLine = this.state.lines[targetVL.logicalLine] || "";
					this.state.cursorCol = Math.min(targetCol, logicalLine.length);
				}
			}
		}

		if (deltaCol !== 0) {
			const currentLine = this.state.lines[this.state.cursorLine] || "";

			if (deltaCol > 0) {
				if (this.state.cursorCol < currentLine.length) {
					this.state.cursorCol++;
				} else if (this.state.cursorLine < this.state.lines.length - 1) {
					this.state.cursorLine++;
					this.state.cursorCol = 0;
				}
			} else {
				if (this.state.cursorCol > 0) {
					this.state.cursorCol--;
				} else if (this.state.cursorLine > 0) {
					this.state.cursorLine--;
					const prevLine = this.state.lines[this.state.cursorLine] || "";
					this.state.cursorCol = prevLine.length;
				}
			}
		}
	}

	moveWordBackwards(): void {
		const currentLine = this.state.lines[this.state.cursorLine] || "";

		if (this.state.cursorCol === 0) {
			if (this.state.cursorLine > 0) {
				this.state.cursorLine--;
				const prevLine = this.state.lines[this.state.cursorLine] || "";
				this.state.cursorCol = prevLine.length;
			}
			return;
		}

		const textBeforeCursor = currentLine.slice(0, this.state.cursorCol);
		let newCol = this.state.cursorCol;
		const lastChar = textBeforeCursor[newCol - 1] ?? "";

		if (this.isWordBoundary(lastChar)) {
			newCol -= 1;
		}

		while (newCol > 0) {
			const ch = textBeforeCursor[newCol - 1] ?? "";
			if (this.isWordBoundary(ch)) {
				break;
			}
			newCol -= 1;
		}

		this.state.cursorCol = newCol;
	}

	moveWordForwards(): void {
		const currentLine = this.state.lines[this.state.cursorLine] || "";

		if (this.state.cursorCol >= currentLine.length) {
			if (this.state.cursorLine < this.state.lines.length - 1) {
				this.state.cursorLine++;
				this.state.cursorCol = 0;
			}
			return;
		}

		let newCol = this.state.cursorCol;
		const charAtCursor = currentLine[newCol] ?? "";

		if (this.isWordBoundary(charAtCursor)) {
			newCol += 1;
		}

		while (newCol < currentLine.length) {
			const ch = currentLine[newCol] ?? "";
			if (this.isWordBoundary(ch)) {
				break;
			}
			newCol += 1;
		}

		this.state.cursorCol = newCol;
	}

	private isWordBoundary(char: string): boolean {
		return WORD_BOUNDARY_REGEX.test(char);
	}
}
