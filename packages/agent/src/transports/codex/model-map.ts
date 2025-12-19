/** All gpt-5.2 variants map to same API model */
export const MODEL_MAP: Record<string, string> = {
	"gpt-5.2": "gpt-5.2",
	"gpt-5.2-xhigh": "gpt-5.2",
	"gpt-5.2-high": "gpt-5.2",
	"gpt-5.2-medium": "gpt-5.2",
	"gpt-5.2-low": "gpt-5.2",
};

export function normalizeModel(model: string): string {
	const id = model.includes("/") ? model.split("/").pop()! : model;
	return MODEL_MAP[id] ?? "gpt-5.2";
}
