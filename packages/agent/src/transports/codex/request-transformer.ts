import type { ReasoningEffort } from "@marvin-agents/ai";
import type { CodexRequestBody, InputItem } from "./types.js";
import { normalizeModel } from "./model-map.js";

function filterInput(input: InputItem[]): InputItem[] {
	return input
		.filter((item) => item.type !== "item_reference")
		.map(({ id, ...rest }) => rest as InputItem);
}

/**
 * Transform request body for Codex API
 */
export function transformRequestBody(
	body: CodexRequestBody,
	instructions: string,
	reasoning?: ReasoningEffort,
): CodexRequestBody {
	const model = normalizeModel(body.model);
	
	return {
		...body,
		model,
		store: false,
		stream: true,
		instructions,
		input: body.input ? filterInput(body.input) : undefined,
		reasoning: { effort: reasoning ?? "medium", summary: "auto" },
		text: { verbosity: "medium" },
		include: ["reasoning.encrypted_content"],
		max_output_tokens: undefined,
		max_completion_tokens: undefined,
	};
}
