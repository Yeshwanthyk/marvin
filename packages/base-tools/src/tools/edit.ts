import type { AgentTool } from "@mu-agents/ai";
import { Type } from "@sinclair/typebox";
import * as Diff from "diff";
import { constants } from "fs";
import { access, readFile, writeFile } from "fs/promises";
import { resolve as resolvePath } from "path";
import { expandPath } from "./path-utils.js";

export interface DiffLine {
	type: "context" | "added" | "removed" | "ellipsis";
	lineNum?: number;
	content: string;
	// For added/removed lines, word-level changes (array of [isHighlight, text] tuples)
	segments?: Array<[boolean, string]>;
}

export interface StructuredDiff {
	lines: DiffLine[];
	stats: { added: number; removed: number };
}

/**
 * Generate a structured diff with word-level highlighting
 */
function generateStructuredDiff(oldContent: string, newContent: string, contextLines = 3): StructuredDiff {
	const lineParts = Diff.diffLines(oldContent, newContent);
	const output: DiffLine[] = [];
	let stats = { added: 0, removed: 0 };

	let oldLineNum = 1;
	let newLineNum = 1;
	let lastWasChange = false;

	for (let i = 0; i < lineParts.length; i++) {
		const part = lineParts[i];
		const raw = part.value.split("\n");
		if (raw[raw.length - 1] === "") raw.pop();

		if (part.added || part.removed) {
			// Collect consecutive removed and added for word-level diff
			const removed: string[] = [];
			const added: string[] = [];
			let j = i;

			while (j < lineParts.length && (lineParts[j].added || lineParts[j].removed)) {
				const p = lineParts[j];
				const lines = p.value.split("\n");
				if (lines[lines.length - 1] === "") lines.pop();
				if (p.removed) removed.push(...lines);
				else added.push(...lines);
				j++;
			}

			// Try to pair removed/added lines for word-level diff
			const maxPairs = Math.min(removed.length, added.length);
			for (let k = 0; k < removed.length; k++) {
				const line = removed[k];
				let segments: Array<[boolean, string]> | undefined;

				if (k < maxPairs) {
					// Compute word-level diff against paired added line
					const wordDiff = Diff.diffWords(line, added[k]);
					segments = [];
					for (const wd of wordDiff) {
						if (wd.removed) segments.push([true, wd.value]);
						else if (!wd.added) segments.push([false, wd.value]);
					}
				}

				output.push({ type: "removed", lineNum: oldLineNum++, content: line, segments });
				stats.removed++;
			}

			for (let k = 0; k < added.length; k++) {
				const line = added[k];
				let segments: Array<[boolean, string]> | undefined;

				if (k < maxPairs) {
					const wordDiff = Diff.diffWords(removed[k], line);
					segments = [];
					for (const wd of wordDiff) {
						if (wd.added) segments.push([true, wd.value]);
						else if (!wd.removed) segments.push([false, wd.value]);
					}
				}

				output.push({ type: "added", lineNum: newLineNum++, content: line, segments });
				stats.added++;
			}

			// Skip parts we've processed
			i = j - 1;
			lastWasChange = true;
		} else {
			// Context lines
			const nextIsChange = i < lineParts.length - 1 && (lineParts[i + 1].added || lineParts[i + 1].removed);

			if (lastWasChange || nextIsChange) {
				let linesToShow = raw;
				let skipStart = 0;
				let skipEnd = 0;

				if (!lastWasChange) {
					skipStart = Math.max(0, raw.length - contextLines);
					linesToShow = raw.slice(skipStart);
				}

				if (!nextIsChange && linesToShow.length > contextLines) {
					skipEnd = linesToShow.length - contextLines;
					linesToShow = linesToShow.slice(0, contextLines);
				}

				if (skipStart > 0) {
					output.push({ type: "ellipsis", content: "..." });
					oldLineNum += skipStart;
					newLineNum += skipStart;
				}

				for (const line of linesToShow) {
					output.push({ type: "context", lineNum: oldLineNum++, content: line });
					newLineNum++;
				}

				if (skipEnd > 0) {
					output.push({ type: "ellipsis", content: "..." });
					oldLineNum += skipEnd;
					newLineNum += skipEnd;
				}
			} else {
				oldLineNum += raw.length;
				newLineNum += raw.length;
			}

			lastWasChange = false;
		}
	}

	return { lines: output, stats };
}

const editSchema = Type.Object({
	path: Type.String({ description: "Path to the file to edit (relative or absolute)" }),
	oldText: Type.String({ description: "Exact text to find and replace (must match exactly)" }),
	newText: Type.String({ description: "New text to replace the old text with" }),
});

export const editTool: AgentTool<typeof editSchema> = {
	name: "edit",
	label: "edit",
	description:
		"Edit a file by replacing exact text. The oldText must match exactly (including whitespace). Use this for precise, surgical edits.",
	parameters: editSchema,
	execute: async (
		_toolCallId: string,
		{ path, oldText, newText }: { path: string; oldText: string; newText: string },
		signal?: AbortSignal,
	) => {
		const absolutePath = resolvePath(expandPath(path));

		return new Promise<{
			content: Array<{ type: "text"; text: string }>;
			details: { structuredDiff: StructuredDiff } | undefined;
		}>((resolve, reject) => {
			// Check if already aborted
			if (signal?.aborted) {
				reject(new Error("Operation aborted"));
				return;
			}

			let aborted = false;

			// Set up abort handler
			const onAbort = () => {
				aborted = true;
				reject(new Error("Operation aborted"));
			};

			if (signal) {
				signal.addEventListener("abort", onAbort, { once: true });
			}

			// Perform the edit operation
			(async () => {
				try {
					// Check if file exists
					try {
						await access(absolutePath, constants.R_OK | constants.W_OK);
					} catch {
						if (signal) {
							signal.removeEventListener("abort", onAbort);
						}
						reject(new Error(`File not found: ${path}`));
						return;
					}

					// Check if aborted before reading
					if (aborted) {
						return;
					}

					// Read the file
					const content = await readFile(absolutePath, "utf-8");

					// Check if aborted after reading
					if (aborted) {
						return;
					}

					// Check if old text exists
					if (!content.includes(oldText)) {
						if (signal) {
							signal.removeEventListener("abort", onAbort);
						}
						reject(
							new Error(
								`Could not find the exact text in ${path}. The old text must match exactly including all whitespace and newlines.`,
							),
						);
						return;
					}

					// Count occurrences
					const occurrences = content.split(oldText).length - 1;

					if (occurrences > 1) {
						if (signal) {
							signal.removeEventListener("abort", onAbort);
						}
						reject(
							new Error(
								`Found ${occurrences} occurrences of the text in ${path}. The text must be unique. Please provide more context to make it unique.`,
							),
						);
						return;
					}

					// Check if aborted before writing
					if (aborted) {
						return;
					}

					// Perform replacement using indexOf + substring (raw string replace, no special character interpretation)
					// String.replace() interprets $ in the replacement string, so we do manual replacement
					const index = content.indexOf(oldText);
					const newContent = content.substring(0, index) + newText + content.substring(index + oldText.length);

					// Verify the replacement actually changed something
					if (content === newContent) {
						if (signal) {
							signal.removeEventListener("abort", onAbort);
						}
						reject(
							new Error(
								`No changes made to ${path}. The replacement produced identical content. This might indicate an issue with special characters or the text not existing as expected.`,
							),
						);
						return;
					}

					await writeFile(absolutePath, newContent, "utf-8");

					// Check if aborted after writing
					if (aborted) {
						return;
					}

					// Clean up abort handler
					if (signal) {
						signal.removeEventListener("abort", onAbort);
					}

					const diff = generateStructuredDiff(content, newContent);
					resolve({
						content: [
							{
								type: "text",
								text: `Successfully replaced text in ${path}. Changed ${oldText.length} characters to ${newText.length} characters.`,
							},
						],
						details: { structuredDiff: diff },
					});
				} catch (error: any) {
					// Clean up abort handler
					if (signal) {
						signal.removeEventListener("abort", onAbort);
					}

					if (!aborted) {
						reject(error);
					}
				}
			})();
		});
	},
};
