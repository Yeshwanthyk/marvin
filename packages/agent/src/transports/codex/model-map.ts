/** Model variants map to API model IDs */
export const MODEL_MAP: Record<string, string> = {
	// GPT-5.3 Codex (newest, supports xhigh, does NOT support "none")
	"gpt-5.3-codex": "gpt-5.3-codex",
	"gpt-5.3-codex-xhigh": "gpt-5.3-codex",
	"gpt-5.3-codex-high": "gpt-5.3-codex",
	"gpt-5.3-codex-medium": "gpt-5.3-codex",
	"gpt-5.3-codex-low": "gpt-5.3-codex",

	// GPT-5.2 Codex (supports xhigh, does NOT support "none")
	"gpt-5.2-codex": "gpt-5.2-codex",
	"gpt-5.2-codex-xhigh": "gpt-5.2-codex",
	"gpt-5.2-codex-high": "gpt-5.2-codex",
	"gpt-5.2-codex-medium": "gpt-5.2-codex",
	"gpt-5.2-codex-low": "gpt-5.2-codex",

	// GPT-5.2 general (supports xhigh and "none")
	"gpt-5.2": "gpt-5.2",
	"gpt-5.2-xhigh": "gpt-5.2",
	"gpt-5.2-high": "gpt-5.2",
	"gpt-5.2-medium": "gpt-5.2",
	"gpt-5.2-low": "gpt-5.2",

	// GPT-5.2 Mini
	"gpt-5.2-mini": "gpt-5.2-mini",
};

export function normalizeModel(model: string): string {
	const id = model.includes("/") ? model.split("/").pop()! : model;
	return MODEL_MAP[id] ?? "gpt-5.2";
}
