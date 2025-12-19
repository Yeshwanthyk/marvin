import type {
	AutocompleteItem,
	AutocompleteProvider,
} from "../../autocomplete.js";
import { SelectList, type SelectListTheme } from "../select-list.js";
import type { EditorState } from "./types.js";

export type AutocompleteHandleInputResult = {
	handled: boolean;
	remaining: string;
};

type SuggestionResult = { items: AutocompleteItem[]; prefix: string };

type ForceFileSuggestionsProvider = AutocompleteProvider & {
	getForceFileSuggestions(
		lines: string[],
		cursorLine: number,
		cursorCol: number,
	): SuggestionResult | null;
};

type ShouldTriggerFileCompletionProvider = AutocompleteProvider & {
	shouldTriggerFileCompletion(
		lines: string[],
		cursorLine: number,
		cursorCol: number,
	): boolean;
};

function hasForceFileSuggestions(
	provider: AutocompleteProvider,
): provider is ForceFileSuggestionsProvider {
	return (
		typeof (provider as ForceFileSuggestionsProvider)
			.getForceFileSuggestions === "function"
	);
}

function hasShouldTriggerFileCompletion(
	provider: AutocompleteProvider,
): provider is ShouldTriggerFileCompletionProvider {
	return (
		typeof (provider as ShouldTriggerFileCompletionProvider)
			.shouldTriggerFileCompletion === "function"
	);
}

export class AutocompleteController {
	private provider?: AutocompleteProvider;
	private list?: SelectList;
	private isAutocompleting: boolean = false;
	private prefix: string = "";

	constructor(
		private theme: SelectListTheme,
		private maxVisible: number = 5,
	) {}

	setProvider(provider: AutocompleteProvider | undefined): void {
		this.provider = provider;
	}

	isShowing(): boolean {
		return this.isAutocompleting;
	}

	render(width: number): string[] {
		if (!this.isAutocompleting || !this.list) return [];
		return this.list.render(width);
	}

	cancel(): void {
		this.isAutocompleting = false;
		this.list = undefined;
		this.prefix = "";
	}

	handleInput(
		data: string,
		state: EditorState,
		deps: {
			setLinesAndCursor: (
				lines: string[],
				cursorLine: number,
				cursorCol: number,
			) => void;
			getText: () => string;
			onChange?: (text: string) => void;
		},
	): AutocompleteHandleInputResult {
		if (!this.isAutocompleting || !this.list) {
			return { handled: false, remaining: data };
		}

		// Escape - cancel autocomplete
		if (data === "\x1b") {
			this.cancel();
			return { handled: true, remaining: "" };
		}

		// Arrow keys - navigate list
		if (data === "\x1b[A" || data === "\x1b[B") {
			this.list.handleInput(data);
			return { handled: true, remaining: "" };
		}

		// Tab - apply selection
		if (data === "\t") {
			const selected = this.list.getSelectedItem();
			if (selected && this.provider) {
				const result = this.provider.applyCompletion(
					state.lines,
					state.cursorLine,
					state.cursorCol,
					selected,
					this.prefix,
				);

				deps.setLinesAndCursor(
					result.lines,
					result.cursorLine,
					result.cursorCol,
				);

				this.cancel();

				deps.onChange?.(deps.getText());
			}
			return { handled: true, remaining: "" };
		}

		// Enter on slash command - apply completion and fall through to submission
		if (data === "\r" && this.prefix.startsWith("/")) {
			const selected = this.list.getSelectedItem();
			if (selected && this.provider) {
				const result = this.provider.applyCompletion(
					state.lines,
					state.cursorLine,
					state.cursorCol,
					selected,
					this.prefix,
				);

				deps.setLinesAndCursor(
					result.lines,
					result.cursorLine,
					result.cursorCol,
				);
			}
			this.cancel();
			return { handled: false, remaining: data };
		}

		// Enter on file path - apply completion
		if (data === "\r") {
			const selected = this.list.getSelectedItem();
			if (selected && this.provider) {
				const result = this.provider.applyCompletion(
					state.lines,
					state.cursorLine,
					state.cursorCol,
					selected,
					this.prefix,
				);

				deps.setLinesAndCursor(
					result.lines,
					result.cursorLine,
					result.cursorCol,
				);

				this.cancel();

				deps.onChange?.(deps.getText());
			}
			return { handled: true, remaining: "" };
		}

		return { handled: false, remaining: data };
	}

	afterInsert(
		char: string,
		state: EditorState,
		isAtStartOfMessage: boolean,
	): void {
		if (!this.isAutocompleting) {
			if (!this.provider) return;

			// Auto-trigger for "/" at the start of a line (slash commands)
			if (char === "/" && isAtStartOfMessage) {
				this.tryTrigger(state);
			}
			// Auto-trigger for "@" file reference (fuzzy search)
			else if (char === "@") {
				const currentLine = state.lines[state.cursorLine] || "";
				const textBeforeCursor = currentLine.slice(0, state.cursorCol);
				// Only trigger if @ is after whitespace or at start of line
				const charBeforeAt = textBeforeCursor[textBeforeCursor.length - 2];
				if (
					textBeforeCursor.length === 1 ||
					charBeforeAt === " " ||
					charBeforeAt === "\t"
				) {
					this.tryTrigger(state);
				}
			}
			// Also auto-trigger when typing letters in a slash command context
			else if (/[a-zA-Z0-9]/.test(char)) {
				const currentLine = state.lines[state.cursorLine] || "";
				const textBeforeCursor = currentLine.slice(0, state.cursorCol);
				// Check if we're in a slash command (with or without space for arguments)
				if (textBeforeCursor.trimStart().startsWith("/")) {
					this.tryTrigger(state);
				}
				// Check if we're in an @ file reference context
				else if (textBeforeCursor.match(/(?:^|[\s])@[^\s]*$/)) {
					this.tryTrigger(state);
				}
			}
		} else {
			this.update(state);
		}
	}

	afterDelete(state: EditorState): void {
		if (this.isAutocompleting) {
			this.update(state);
			return;
		}

		if (!this.provider) return;

		const currentLine = state.lines[state.cursorLine] || "";
		const textBeforeCursor = currentLine.slice(0, state.cursorCol);

		// Slash command context
		if (textBeforeCursor.trimStart().startsWith("/")) {
			this.tryTrigger(state);
		}
		// @ file reference context
		else if (textBeforeCursor.match(/(?:^|[\s])@[^\s]*$/)) {
			this.tryTrigger(state);
		}
	}

	handleTabKey(state: EditorState): void {
		if (!this.provider) return;

		const currentLine = state.lines[state.cursorLine] || "";
		const beforeCursor = currentLine.slice(0, state.cursorCol);

		// Check if we're in a slash command context
		if (beforeCursor.trimStart().startsWith("/")) {
			// For now, fall back to regular autocomplete (slash commands)
			// This can be extended later to handle command-specific argument completion
			this.tryTrigger(state, true);
			return;
		}

		// Force file autocomplete
		if (!hasForceFileSuggestions(this.provider)) {
			this.tryTrigger(state, true);
			return;
		}

		const suggestions = this.provider.getForceFileSuggestions(
			state.lines,
			state.cursorLine,
			state.cursorCol,
		);

		if (suggestions && suggestions.items.length > 0) {
			this.showSuggestions(suggestions);
		} else {
			this.cancel();
		}
	}

	private tryTrigger(state: EditorState, explicitTab: boolean = false): void {
		if (!this.provider) return;

		// Check if we should trigger file completion on Tab
		if (explicitTab && hasShouldTriggerFileCompletion(this.provider)) {
			const shouldTrigger = this.provider.shouldTriggerFileCompletion(
				state.lines,
				state.cursorLine,
				state.cursorCol,
			);
			if (!shouldTrigger) {
				return;
			}
		}

		const suggestions = this.provider.getSuggestions(
			state.lines,
			state.cursorLine,
			state.cursorCol,
		);

		if (suggestions && suggestions.items.length > 0) {
			this.showSuggestions(suggestions);
		} else {
			this.cancel();
		}
	}

	private update(state: EditorState): void {
		if (!this.isAutocompleting || !this.provider) return;

		const suggestions = this.provider.getSuggestions(
			state.lines,
			state.cursorLine,
			state.cursorCol,
		);

		if (suggestions && suggestions.items.length > 0) {
			this.prefix = suggestions.prefix;
			// Always create new SelectList to ensure update
			this.list = new SelectList(
				suggestions.items,
				this.maxVisible,
				this.theme,
			);
		} else {
			this.cancel();
		}
	}

	private showSuggestions(suggestions: SuggestionResult): void {
		this.prefix = suggestions.prefix;
		this.list = new SelectList(suggestions.items, this.maxVisible, this.theme);
		this.isAutocompleting = true;
	}
}
