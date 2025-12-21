import type { AgentTool } from "@marvin-agents/ai";
import { Type } from "@sinclair/typebox";
import { constants } from "fs";
import { access, readFile, writeFile } from "fs/promises";
import { resolve as resolvePath } from "path";
import { expandPath } from "./path-utils.js";

/** Max lines for diff generation - beyond this, show truncated */
const MAX_DIFF_LINES = 200;

/**
 * Build a synthetic unified diff hunk from known replacement location.
 * Avoids O(n*d) Myers diff by using the known edit position.
 */
function buildTargetedDiff(
	path: string,
	fullContent: string,
	replaceIndex: number,
	oldText: string,
	newText: string,
	contextLines = 3
): string {
	const lines = fullContent.split("\n");
	
	// Find line number where replacement starts
	let charCount = 0;
	let startLine = 0;
	for (let i = 0; i < lines.length; i++) {
		if (charCount + lines[i].length >= replaceIndex) {
			startLine = i;
			break;
		}
		charCount += lines[i].length + 1; // +1 for newline
	}
	
	// Count lines in old/new text
	const oldLines = oldText.split("\n");
	const newLines = newText.split("\n");
	
	// Check if diff would be too large
	const totalDiffLines = oldLines.length + newLines.length + contextLines * 2;
	if (totalDiffLines > MAX_DIFF_LINES) {
		// Return truncated summary diff
		const header = `--- ${path}\n+++ ${path}\n`;
		const summary = `@@ -${startLine + 1},${oldLines.length} +${startLine + 1},${newLines.length} @@\n`;
		const truncateMsg = `\\ Diff truncated: ${oldLines.length} lines removed, ${newLines.length} lines added\n`;
		
		// Show first few and last few lines
		const showLines = 5;
		const oldPreview = oldLines.length <= showLines * 2
			? oldLines.map(l => `-${l}`).join("\n")
			: [...oldLines.slice(0, showLines).map(l => `-${l}`),
			   `-... (${oldLines.length - showLines * 2} more lines)`,
			   ...oldLines.slice(-showLines).map(l => `-${l}`)].join("\n");
		const newPreview = newLines.length <= showLines * 2
			? newLines.map(l => `+${l}`).join("\n")
			: [...newLines.slice(0, showLines).map(l => `+${l}`),
			   `+... (${newLines.length - showLines * 2} more lines)`,
			   ...newLines.slice(-showLines).map(l => `+${l}`)].join("\n");
		
		return header + summary + truncateMsg + oldPreview + "\n" + newPreview;
	}
	
	// Build context before
	const ctxStart = Math.max(0, startLine - contextLines);
	const beforeCtx = lines.slice(ctxStart, startLine).map(l => ` ${l}`);
	
	// Build removed/added lines
	const removed = oldLines.map(l => `-${l}`);
	const added = newLines.map(l => `+${l}`);
	
	// Build context after
	const endLine = startLine + oldLines.length;
	const ctxEnd = Math.min(lines.length, endLine + contextLines);
	const afterCtx = lines.slice(endLine, ctxEnd).map(l => ` ${l}`);
	
	// Build unified diff header
	const oldStart = ctxStart + 1;
	const oldCount = beforeCtx.length + oldLines.length + afterCtx.length;
	const newStart = ctxStart + 1;
	const newCount = beforeCtx.length + newLines.length + afterCtx.length;
	
	const header = `--- ${path}\n+++ ${path}\n`;
	const hunkHeader = `@@ -${oldStart},${oldCount} +${newStart},${newCount} @@\n`;
	const body = [...beforeCtx, ...removed, ...added, ...afterCtx].join("\n");
	
	return header + hunkHeader + body;
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
			details: { diff: string } | undefined;
		}>((resolve, reject) => {
			if (signal?.aborted) {
				reject(new Error("Operation aborted"));
				return;
			}

			let aborted = false;

			const onAbort = () => {
				aborted = true;
				reject(new Error("Operation aborted"));
			};

			if (signal) {
				signal.addEventListener("abort", onAbort, { once: true });
			}

			(async () => {
				try {
					try {
						await access(absolutePath, constants.R_OK | constants.W_OK);
					} catch {
						if (signal) {
							signal.removeEventListener("abort", onAbort);
						}
						reject(new Error(`File not found: ${path}`));
						return;
					}

					if (aborted) {
						return;
					}

					const content = await readFile(absolutePath, "utf-8");

					if (aborted) {
						return;
					}

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

					if (aborted) {
						return;
					}

					const index = content.indexOf(oldText);
					const newContent = content.substring(0, index) + newText + content.substring(index + oldText.length);

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

					if (aborted) {
						return;
					}

					if (signal) {
						signal.removeEventListener("abort", onAbort);
					}

					resolve({
						content: [
							{
								type: "text",
								text: `Successfully replaced text in ${path}. Changed ${oldText.length} characters to ${newText.length} characters.`,
							},
						],
						details: { diff: buildTargetedDiff(path, content, index, oldText, newText) },
					});
				} catch (error: any) {
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
