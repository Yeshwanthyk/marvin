import type { AgentTool } from "@marvin-agents/ai";
import { Type } from "@sinclair/typebox";
import { constants } from "fs";
import { access, readFile, writeFile } from "fs/promises";
import { resolvePathFromCwd } from "./path-utils.js";

/** Max lines for diff generation - beyond this, show truncated */
const MAX_DIFF_LINES = 200;

/**
 * Build a synthetic unified diff hunk from known replacement location.
 * Avoids O(n*d) Myers diff by using the known edit position.
 * Handles intra-line edits correctly by computing affected line ranges.
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
	
	// Find line/col where replacement starts
	let charCount = 0;
	let startLine = 0;
	let startCol = 0;
	for (let i = 0; i < lines.length; i++) {
		const lineLen = lines[i].length;
		if (charCount + lineLen >= replaceIndex) {
			startLine = i;
			startCol = replaceIndex - charCount;
			break;
		}
		charCount += lineLen + 1; // +1 for newline
	}
	
	// Find line where replacement ends
	const endIndex = replaceIndex + oldText.length;
	let endLine = startLine;
	let endCol = startCol + oldText.length;
	charCount = 0;
	for (let i = 0; i < lines.length; i++) {
		const lineLen = lines[i].length;
		if (charCount + lineLen >= endIndex) {
			endLine = i;
			endCol = endIndex - charCount;
			break;
		}
		charCount += lineLen + 1;
	}
	
	// Extract the actual affected old lines (full lines from file)
	const affectedOldLines = lines.slice(startLine, endLine + 1);
	
	// Build the new lines by splicing replacement into affected range
	const prefix = affectedOldLines[0].substring(0, startCol);
	const suffix = affectedOldLines[affectedOldLines.length - 1].substring(endCol);
	const replaced = prefix + newText + suffix;
	const affectedNewLines = replaced.split("\n");
	
	// Check if diff would be too large
	const totalDiffLines = affectedOldLines.length + affectedNewLines.length + contextLines * 2;
	if (totalDiffLines > MAX_DIFF_LINES) {
		const header = `--- ${path}\n+++ ${path}\n`;
		const summary = `@@ -${startLine + 1},${affectedOldLines.length} +${startLine + 1},${affectedNewLines.length} @@\n`;
		const truncateMsg = `\\ Diff truncated: ${affectedOldLines.length} lines → ${affectedNewLines.length} lines\n`;
		
		const showLines = 5;
		const oldPreview = affectedOldLines.length <= showLines * 2
			? affectedOldLines.map(l => `-${l}`).join("\n")
			: [...affectedOldLines.slice(0, showLines).map(l => `-${l}`),
			   `-... (${affectedOldLines.length - showLines * 2} more lines)`,
			   ...affectedOldLines.slice(-showLines).map(l => `-${l}`)].join("\n");
		const newPreview = affectedNewLines.length <= showLines * 2
			? affectedNewLines.map(l => `+${l}`).join("\n")
			: [...affectedNewLines.slice(0, showLines).map(l => `+${l}`),
			   `+... (${affectedNewLines.length - showLines * 2} more lines)`,
			   ...affectedNewLines.slice(-showLines).map(l => `+${l}`)].join("\n");
		
		return header + summary + truncateMsg + oldPreview + "\n" + newPreview;
	}
	
	// Build context before
	const ctxStart = Math.max(0, startLine - contextLines);
	const beforeCtx = lines.slice(ctxStart, startLine).map(l => ` ${l}`);
	
	// Build removed/added lines (full affected lines)
	const removed = affectedOldLines.map(l => `-${l}`);
	const added = affectedNewLines.map(l => `+${l}`);
	
	// Build context after
	const afterStart = endLine + 1;
	const ctxEnd = Math.min(lines.length, afterStart + contextLines);
	const afterCtx = lines.slice(afterStart, ctxEnd).map(l => ` ${l}`);
	
	// Build unified diff header
	const oldStart = ctxStart + 1;
	const oldCount = beforeCtx.length + affectedOldLines.length + afterCtx.length;
	const newStart = ctxStart + 1;
	const newCount = beforeCtx.length + affectedNewLines.length + afterCtx.length;
	
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

export const createEditTool = (cwd: string): AgentTool<typeof editSchema> => ({
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
		const absolutePath = resolvePathFromCwd(cwd, path);

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

						// Check uniqueness with indexOf (avoids split allocation explosion)
					const firstIndex = content.indexOf(oldText);
					const secondIndex = content.indexOf(oldText, firstIndex + 1);
					if (secondIndex !== -1) {
						if (signal) {
							signal.removeEventListener("abort", onAbort);
						}
						reject(
							new Error(
								`Found multiple occurrences of the text in ${path}. The text must be unique. Please provide more context to make it unique.`,
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
				} catch (error) {
					if (signal) {
						signal.removeEventListener("abort", onAbort);
					}

					if (!aborted) {
						const message = error instanceof Error ? error.message : String(error);
						reject(new Error(message));
					}
				}
			})();
		});
	},
});
