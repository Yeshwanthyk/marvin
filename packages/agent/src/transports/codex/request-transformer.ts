import type { ReasoningEffort } from "@yeshwanthyk/ai";
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
	const transformed: CodexRequestBody = {
		...body,
		model,
		store: false,
		stream: true,
		instructions,
		reasoning: { effort: reasoning ?? "medium", summary: "auto" },
		text: { verbosity: "medium" },
		include: ["reasoning.encrypted_content"],
	};

	if (body.input) {
		transformed.input = filterInput(body.input);
	}

	return transformed;
}
