import type { AutocompleteProvider } from "../autocomplete.js";
import type { Component } from "../tui.js";
import { visibleWidth } from "../utils.js";
import type { SelectListTheme } from "./select-list.js";
import { AutocompleteController } from "./editor/autocomplete.js";
import { EditorDocument } from "./editor/document.js";
import { buildVisualLineMap, findCurrentVisualLine, layoutText } from "./editor/layout.js";
import { HistoryNavigator } from "./editor/history.js";
import { PasteController } from "./editor/paste.js";
import type { EditorState } from "./editor/types.js";

// Grapheme segmenter for proper Unicode iteration (handles emojis, etc.)
const segmenter = new Intl.Segmenter();

type InputStageResult = { handled: boolean; remaining: string };

export interface EditorTheme {
	borderColor: (str: string) => string;
	selectList: SelectListTheme;
}

export class Editor implements Component {
	private document = new EditorDocument();
	private historyNavigator = new HistoryNavigator();
	private pasteController = new PasteController();
	private autocompleteController: AutocompleteController;

	// Store last render width for cursor navigation
	private lastWidth: number = 80;

	// Border color (can be changed dynamically)
	public borderColor: (str: string) => string;

	public onSubmit?: (text: string) => void;
	public onChange?: (text: string) => void;
	public onEscape?: () => void;
	public onCtrlP?: () => void;
	public onShiftTab?: () => void;
	public onCtrlT?: () => void;
	public onCtrlO?: () => void;
	public onCtrlC?: () => void;
	public disableSubmit: boolean = false;

	constructor(theme: EditorTheme) {
		this.borderColor = theme.borderColor;
		this.autocompleteController = new AutocompleteController(theme.selectList);
	}

	setAutocompleteProvider(provider: AutocompleteProvider): void {
		this.autocompleteController.setProvider(provider);
	}

	/**
	 * Add a prompt to history for up/down arrow navigation.
	 * Called after successful submission.
	 */
	addToHistory(text: string): void {
		this.historyNavigator.add(text);
	}

	private isEditorEmpty(): boolean {
		return this.document.isEmpty();
	}

	private isOnFirstVisualLine(): boolean {
		const state = this.document.getState();
		const visualLines = buildVisualLineMap(state.lines, this.lastWidth);
		const currentVisualLine = findCurrentVisualLine(visualLines, state.cursorLine, state.cursorCol);
		return currentVisualLine === 0;
	}

	private isOnLastVisualLine(): boolean {
		const state = this.document.getState();
		const visualLines = buildVisualLineMap(state.lines, this.lastWidth);
		const currentVisualLine = findCurrentVisualLine(visualLines, state.cursorLine, state.cursorCol);
		return currentVisualLine === visualLines.length - 1;
	}

	private navigateHistory(direction: 1 | -1): void {
		const nextText = this.historyNavigator.navigate(direction);
		if (nextText === null) return;

		this.setTextInternal(nextText);
	}

	/** Internal setText that doesn't reset history state - used by navigateHistory */
	private setTextInternal(text: string): void {
		this.document.setText(text);

		if (this.onChange) {
			this.onChange(this.getText());
		}
	}

	invalidate(): void {
		// No cached state to invalidate currently
	}

	render(width: number): string[] {
		// Store width for cursor navigation
		this.lastWidth = width;

		const horizontal = this.borderColor("─");

		// Layout the text - use full width
		const layoutLines = layoutText(this.document.getState(), width);

		const result: string[] = [];

		// Render top border
		result.push(horizontal.repeat(width));

		// Render each layout line
		for (const layoutLine of layoutLines) {
			let displayText = layoutLine.text;
			let lineVisibleWidth = visibleWidth(layoutLine.text);

			// Add cursor if this line has it
			if (layoutLine.hasCursor && layoutLine.cursorPos !== undefined) {
				const before = displayText.slice(0, layoutLine.cursorPos);
				const after = displayText.slice(layoutLine.cursorPos);

				if (after.length > 0) {
					// Cursor is on a character (grapheme) - replace it with highlighted version
					// Get the first grapheme from 'after'
					const afterGraphemes = [...segmenter.segment(after)];
					const firstGrapheme = afterGraphemes[0]?.segment || "";
					const restAfter = after.slice(firstGrapheme.length);
					const cursor = `\x1b[7m${firstGrapheme}\x1b[0m`;
					displayText = before + cursor + restAfter;
					// lineVisibleWidth stays the same - we're replacing, not adding
				} else {
					// Cursor is at the end - check if we have room for the space
					if (lineVisibleWidth < width) {
						// We have room - add highlighted space
						const cursor = "\x1b[7m \x1b[0m";
						displayText = before + cursor;
						// lineVisibleWidth increases by 1 - we're adding a space
						lineVisibleWidth = lineVisibleWidth + 1;
					} else {
						// Line is at full width - use reverse video on last grapheme if possible
						// or just show cursor at the end without adding space
						const beforeGraphemes = [...segmenter.segment(before)];
						if (beforeGraphemes.length > 0) {
							const lastGrapheme = beforeGraphemes[beforeGraphemes.length - 1]?.segment || "";
							const cursor = `\x1b[7m${lastGrapheme}\x1b[0m`;
							const beforeWithoutLast = beforeGraphemes
								.slice(0, -1)
								.map((g) => g.segment)
								.join("");
							displayText = beforeWithoutLast + cursor;
						}
						// lineVisibleWidth stays the same
					}
				}
			}

			// Calculate padding based on actual visible width
			const padding = " ".repeat(Math.max(0, width - lineVisibleWidth));

			// Render the line (no side borders, just horizontal lines above and below)
			result.push(displayText + padding);
		}

		// Render bottom border
		result.push(horizontal.repeat(width));

		result.push(...this.autocompleteController.render(width));

		return result;
	}

	handleInput(data: string): void {
		let remaining = data;

		let result = this.handlePasteStage(remaining);
		if (result.handled) {
			if (result.remaining.length > 0) {
				this.handleInput(result.remaining);
			}
			return;
		}
		remaining = result.remaining;

		result = this.handleGlobalShortcutsStage(remaining);
		if (result.handled) return;
		remaining = result.remaining;

		result = this.handleAutocompleteStage(remaining);
		if (result.handled) return;
		remaining = result.remaining;

		result = this.handleTabStage(remaining);
		if (result.handled) return;
		remaining = result.remaining;

		result = this.handleDocumentStage(remaining);
		if (result.handled && result.remaining.length > 0) {
			this.handleInput(result.remaining);
		}
	}

	private handlePasteStage(data: string): InputStageResult {
		const pasteResult = this.pasteController.handleInput(data);
		if (!pasteResult.handled) {
			return { handled: false, remaining: pasteResult.remaining };
		}

		if ("pastedText" in pasteResult && typeof pasteResult.pastedText === "string") {
			this.applyPaste(pasteResult.pastedText);
		}

		return { handled: true, remaining: pasteResult.remaining };
	}

	private handleGlobalShortcutsStage(data: string): InputStageResult {
		// Handle special key combinations first

		// Ctrl+C
		if (data.charCodeAt(0) === 3) {
			if (this.onCtrlC) this.onCtrlC();
			return { handled: true, remaining: "" };
		}

		// Ctrl+P - cycle models
		if (data.charCodeAt(0) === 16) {
			if (this.onCtrlP) this.onCtrlP();
			return { handled: true, remaining: "" };
		}

		// Ctrl+T - toggle thinking visibility
		if (data.charCodeAt(0) === 20) {
			if (this.onCtrlT) this.onCtrlT();
			return { handled: true, remaining: "" };
		}

		// Ctrl+O - toggle output expansion
		if (data.charCodeAt(0) === 15) {
			if (this.onCtrlO) this.onCtrlO();
			return { handled: true, remaining: "" };
		}

		// Shift+Tab - cycle thinking level
		if (data === "\x1b[Z") {
			if (this.onShiftTab) this.onShiftTab();
			return { handled: true, remaining: "" };
		}

		// Escape (when not autocompleting)
		if (data === "\x1b" && !this.autocompleteController.isShowing()) {
			if (this.onEscape) this.onEscape();
			return { handled: true, remaining: "" };
		}

		return { handled: false, remaining: data };
	}

	private handleAutocompleteStage(data: string): InputStageResult {
		return this.autocompleteController.handleInput(data, this.document.getState(), {
			setLinesAndCursor: (lines, cursorLine, cursorCol) =>
				this.document.setLinesAndCursor(lines, cursorLine, cursorCol),
			getText: () => this.getText(),
			onChange: this.onChange,
		});
	}

	private handleTabStage(data: string): InputStageResult {
		// Tab key - context-aware completion (but not when already autocompleting)
		if (data !== "\t" || this.autocompleteController.isShowing()) {
			return { handled: false, remaining: data };
		}

		this.autocompleteController.handleTabKey(this.document.getState());
		return { handled: true, remaining: "" };
	}

	private handleDocumentStage(data: string): InputStageResult {
		// Continue with rest of input handling
		// Ctrl+K - Delete to end of line
		if (data.charCodeAt(0) === 11) {
			this.deleteToEndOfLine();
			return { handled: true, remaining: "" };
		}
		// Ctrl+U - Delete to start of line
		else if (data.charCodeAt(0) === 21) {
			this.deleteToStartOfLine();
			return { handled: true, remaining: "" };
		}
		// Ctrl+W - Delete word backwards
		else if (data.charCodeAt(0) === 23) {
			this.deleteWordBackwards();
			return { handled: true, remaining: "" };
		}
		// Option/Alt+Backspace (e.g. Ghostty sends ESC + DEL)
		else if (data === "\x1b\x7f") {
			this.deleteWordBackwards();
			return { handled: true, remaining: "" };
		}
		// Ctrl+A - Move to start of line
		else if (data.charCodeAt(0) === 1) {
			this.document.moveToLineStart();
			return { handled: true, remaining: "" };
		}
		// Ctrl+E - Move to end of line
		else if (data.charCodeAt(0) === 5) {
			this.document.moveToLineEnd();
			return { handled: true, remaining: "" };
		}
		// New line shortcuts (but not plain LF/CR which should be submit)
		else if (
			(data.charCodeAt(0) === 10 && data.length > 1) || // Ctrl+Enter with modifiers
			data === "\x1b\r" || // Option+Enter in some terminals
			data === "\x1b[13;2~" || // Shift+Enter in some terminals
			(data.length > 1 && data.includes("\x1b") && data.includes("\r")) ||
			(data === "\n" && data.length === 1) || // Shift+Enter from iTerm2 mapping
			data === "\\\r" // Shift+Enter in VS Code terminal
		) {
			// Modifier + Enter = new line
			this.addNewLine();
			return { handled: true, remaining: "" };
		}
		// Plain Enter (char code 13 for CR) - only CR submits, LF adds new line
		else if (data.charCodeAt(0) === 13 && data.length === 1) {
			// If submit is disabled, do nothing
			if (this.disableSubmit) {
				return { handled: true, remaining: "" };
			}

			const result = this.pasteController.substitutePasteMarkers(this.document.getText().trim());

			// Reset editor
			this.document.reset();
			this.pasteController.resetStoredPastes();
			this.historyNavigator.exit();

			// Notify that editor is now empty
			if (this.onChange) {
				this.onChange("");
			}

			if (this.onSubmit) {
				this.onSubmit(result);
			}

			return { handled: true, remaining: "" };
		}
		// Backspace
		else if (data.charCodeAt(0) === 127 || data.charCodeAt(0) === 8) {
			this.handleBackspace();
			return { handled: true, remaining: "" };
		}
		// Line navigation shortcuts (Home/End keys)
		else if (data === "\x1b[H" || data === "\x1b[1~" || data === "\x1b[7~") {
			// Home key
			this.document.moveToLineStart();
			return { handled: true, remaining: "" };
		} else if (data === "\x1b[F" || data === "\x1b[4~" || data === "\x1b[8~") {
			// End key
			this.document.moveToLineEnd();
			return { handled: true, remaining: "" };
		}
		// Forward delete (Fn+Backspace or Delete key)
		else if (data === "\x1b[3~") {
			// Delete key
			this.handleForwardDelete();
			return { handled: true, remaining: "" };
		}
		// Word navigation (Option/Alt + Arrow or Ctrl + Arrow)
		// Option+Left: \x1b[1;3D or \x1bb
		// Option+Right: \x1b[1;3C or \x1bf
		// Ctrl+Left: \x1b[1;5D
		// Ctrl+Right: \x1b[1;5C
		else if (data === "\x1b[1;3D" || data === "\x1bb" || data === "\x1b[1;5D") {
			// Word left
			this.document.moveWordBackwards();
			return { handled: true, remaining: "" };
		} else if (data === "\x1b[1;3C" || data === "\x1bf" || data === "\x1b[1;5C") {
			// Word right
			this.document.moveWordForwards();
			return { handled: true, remaining: "" };
		}
		// Arrow keys
		else if (data === "\x1b[A") {
			// Up - history navigation or cursor movement
			if (this.isEditorEmpty()) {
				this.navigateHistory(-1); // Start browsing history
			} else if (this.historyNavigator.isBrowsing() && this.isOnFirstVisualLine()) {
				this.navigateHistory(-1); // Navigate to older history entry
			} else {
				this.document.moveCursor(-1, 0, this.lastWidth); // Cursor movement (within text or history entry)
			}
			return { handled: true, remaining: "" };
		} else if (data === "\x1b[B") {
			// Down - history navigation or cursor movement
			if (this.historyNavigator.isBrowsing() && this.isOnLastVisualLine()) {
				this.navigateHistory(1); // Navigate to newer history entry or clear
			} else {
				this.document.moveCursor(1, 0, this.lastWidth); // Cursor movement (within text or history entry)
			}
			return { handled: true, remaining: "" };
		} else if (data === "\x1b[C") {
			// Right
			this.document.moveCursor(0, 1, this.lastWidth);
			return { handled: true, remaining: "" };
		} else if (data === "\x1b[D") {
			// Left
			this.document.moveCursor(0, -1, this.lastWidth);
			return { handled: true, remaining: "" };
		}
		// Regular characters (printable characters and unicode, but not control characters)
		else if (data.charCodeAt(0) >= 32) {
			this.insertCharacter(data);
			return { handled: true, remaining: "" };
		}

		return { handled: false, remaining: data };
	}

	getText(): string {
		return this.document.getText();
	}

	getLines(): string[] {
		return this.document.getLines();
	}

	getCursor(): { line: number; col: number } {
		return this.document.getCursor();
	}

	setText(text: string): void {
		this.historyNavigator.exit();
		this.setTextInternal(text);
	}

	private insertCharacter(char: string): void {
		this.historyNavigator.exit();

		this.document.insertText(char);

		if (this.onChange) {
			this.onChange(this.getText());
		}

		const state = this.document.getState();

		this.autocompleteController.afterInsert(char, state, this.isAtStartOfMessage(state));
	}

	private applyPaste(pastedText: string): void {
		this.historyNavigator.exit();

		this.pasteController.applyPaste(pastedText, {
			insertCharacter: (char) => this.insertCharacter(char),
			insertMultiLine: (pastedLines) => this.document.insertMultiLine(pastedLines),
			onMultiLineChange: () => {
				if (this.onChange) {
					this.onChange(this.getText());
				}
			},
		});
	}

	private addNewLine(): void {
		this.historyNavigator.exit();

		this.document.addNewLine();

		if (this.onChange) {
			this.onChange(this.getText());
		}
	}

	private handleBackspace(): void {
		this.historyNavigator.exit();

		this.document.backspace();

		if (this.onChange) {
			this.onChange(this.getText());
		}

		const state = this.document.getState();
		this.autocompleteController.afterDelete(state);
	}

	private deleteToStartOfLine(): void {
		this.historyNavigator.exit();

		this.document.deleteToStartOfLine();

		if (this.onChange) {
			this.onChange(this.getText());
		}
	}

	private deleteToEndOfLine(): void {
		this.historyNavigator.exit();

		this.document.deleteToEndOfLine();

		if (this.onChange) {
			this.onChange(this.getText());
		}
	}

	private deleteWordBackwards(): void {
		this.historyNavigator.exit();

		this.document.deleteWordBackwards();

		if (this.onChange) {
			this.onChange(this.getText());
		}
	}

	private handleForwardDelete(): void {
		this.historyNavigator.exit();

		this.document.deleteForward();

		if (this.onChange) {
			this.onChange(this.getText());
		}

		const state = this.document.getState();
		this.autocompleteController.afterDelete(state);
	}

	// Helper method to check if cursor is at start of message (for slash command detection)
	private isAtStartOfMessage(state: EditorState): boolean {
		const currentLine = state.lines[state.cursorLine] || "";
		const beforeCursor = currentLine.slice(0, state.cursorCol);

		// At start if line is empty, only contains whitespace, or is just "/"
		return beforeCursor.trim() === "" || beforeCursor.trim() === "/";
	}


	public isShowingAutocomplete(): boolean {
		return this.autocompleteController.isShowing();
	}
}
