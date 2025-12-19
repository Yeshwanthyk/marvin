export function buildPasteMarkerRegex(pasteId: number): RegExp {
	return new RegExp(
		`\\[paste #${pasteId}( (\\+\\d+ lines|\\d+ chars))?\\]`,
		"g",
	);
}

export type BracketedPasteResult =
	| { handled: false; remaining: string }
	| { handled: true; remaining: ""; pastedText?: never }
	| { handled: true; remaining: string; pastedText: string };

export class PasteController {
	private pastes: Map<number, string> = new Map();
	private pasteCounter: number = 0;

	private pasteBuffer: string = "";
	private isInPaste: boolean = false;

	handleInput(data: string): BracketedPasteResult {
		if (data.includes("\x1b[200~")) {
			this.isInPaste = true;
			this.pasteBuffer = "";
			data = data.replace("\x1b[200~", "");
		}

		if (!this.isInPaste) {
			return { handled: false, remaining: data };
		}

		this.pasteBuffer += data;

		const endIndex = this.pasteBuffer.indexOf("\x1b[201~");
		if (endIndex === -1) {
			return { handled: true, remaining: "" };
		}

		const pastedText = this.pasteBuffer.substring(0, endIndex);

		this.isInPaste = false;
		const remaining = this.pasteBuffer.substring(endIndex + 6);
		this.pasteBuffer = "";

		return { handled: true, pastedText, remaining };
	}

	applyPaste(
		pastedText: string,
		deps: {
			insertCharacter: (char: string) => void;
			insertMultiLine: (pastedLines: string[]) => void;
			onMultiLineChange?: () => void;
		},
	): void {
		const filteredText = this.normalizePastedText(pastedText);
		const pastedLines = filteredText.split("\n");

		const totalChars = filteredText.length;
		if (pastedLines.length > 10 || totalChars > 1000) {
			this.pasteCounter++;
			const pasteId = this.pasteCounter;
			this.pastes.set(pasteId, filteredText);

			const marker =
				pastedLines.length > 10
					? `[paste #${pasteId} +${pastedLines.length} lines]`
					: `[paste #${pasteId} ${totalChars} chars]`;

			for (const char of marker) {
				deps.insertCharacter(char);
			}
			return;
		}

		if (pastedLines.length === 1) {
			const text = pastedLines[0] || "";
			for (const char of text) {
				deps.insertCharacter(char);
			}
			return;
		}

		deps.insertMultiLine(pastedLines);
		deps.onMultiLineChange?.();
	}

	substitutePasteMarkers(text: string): string {
		let result = text;

		for (const [pasteId, pasteContent] of this.pastes) {
			result = result.replace(buildPasteMarkerRegex(pasteId), pasteContent);
		}

		return result;
	}

	resetStoredPastes(): void {
		this.pastes.clear();
		this.pasteCounter = 0;
	}

	private normalizePastedText(pastedText: string): string {
		const cleanText = pastedText.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
		const tabExpandedText = cleanText.replace(/\t/g, "    ");

		return tabExpandedText
			.split("")
			.filter((char) => char === "\n" || char.charCodeAt(0) >= 32)
			.join("");
	}
}
