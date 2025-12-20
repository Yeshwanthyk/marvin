import type { AgentTool } from "@marvin-agents/ai";
import { Type } from "@sinclair/typebox";
import * as Diff from "diff";
import { constants } from "fs";
import { access, readFile, writeFile } from "fs/promises";
import { resolve as resolvePath } from "path";
import { expandPath } from "./path-utils.js";

/**
 * Generate a unified diff (parsePatch compatible).
 */
function generateDiffString(path: string, oldContent: string, newContent: string, contextLines = 4): string {
	return Diff.createTwoFilesPatch(path, path, oldContent, newContent, "", "", { context: contextLines });
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
						details: { diff: generateDiffString(path, content, newContent) },
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
