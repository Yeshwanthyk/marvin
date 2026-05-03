import { MODELS } from "./models.generated.js";
import type { Api, KnownProvider, Model, Usage } from "./types.js";

const modelRegistry: Map<string, Map<string, Model<Api>>> = new Map();
const providerAliases: Map<string, string> = new Map([
	["openai-codex", "codex"],
]);

function loadGeneratedModels(): void {
	modelRegistry.clear();
	for (const [provider, models] of Object.entries(MODELS)) {
		const providerModels = new Map<string, Model<Api>>();
		for (const [id, model] of Object.entries(models)) {
			providerModels.set(id, model as Model<Api>);
		}
		modelRegistry.set(provider, providerModels);
	}
}

loadGeneratedModels();

export function resolveProviderAlias(provider: string): string {
	return providerAliases.get(provider) ?? provider;
}

export function registerProviderAlias(alias: string, provider: string): void {
	const trimmedAlias = alias.trim();
	const trimmedProvider = provider.trim();
	if (!trimmedAlias || !trimmedProvider) return;
	providerAliases.set(trimmedAlias, trimmedProvider);
}

export function registerModel(model: Model<Api>): void {
	const provider = resolveProviderAlias(model.provider);
	const providerModels = modelRegistry.get(provider) ?? new Map<string, Model<Api>>();
	providerModels.set(model.id, { ...model, provider });
	modelRegistry.set(provider, providerModels);
}

export function resetModelRegistry(): void {
	loadGeneratedModels();
}

type ModelApi<
	TProvider extends KnownProvider,
	TModelId extends keyof (typeof MODELS)[TProvider],
> = (typeof MODELS)[TProvider][TModelId] extends { api: infer TApi }
	? TApi extends Api
		? TApi
		: never
	: never;

export function getModel<
	TProvider extends KnownProvider,
	TModelId extends keyof (typeof MODELS)[TProvider],
>(
	provider: TProvider,
	modelId: TModelId,
): Model<ModelApi<TProvider, TModelId>> {
	const resolvedProvider = resolveProviderAlias(provider);
	return modelRegistry.get(resolvedProvider)?.get(modelId as string) as Model<
		ModelApi<TProvider, TModelId>
	>;
}

export function getProviders(): KnownProvider[] {
	return Array.from(modelRegistry.keys()) as KnownProvider[];
}

export function getModels<TProvider extends KnownProvider>(
	provider: TProvider,
): Model<ModelApi<TProvider, keyof (typeof MODELS)[TProvider]>>[] {
	const models = modelRegistry.get(resolveProviderAlias(provider));
	return models
		? (Array.from(models.values()) as Model<
				ModelApi<TProvider, keyof (typeof MODELS)[TProvider]>
			>[])
		: [];
}

export function calculateCost<TApi extends Api>(
	model: Model<TApi>,
	usage: Usage,
): Usage["cost"] {
	usage.cost.input = (model.cost.input / 1000000) * usage.input;
	usage.cost.output = (model.cost.output / 1000000) * usage.output;
	usage.cost.cacheRead = (model.cost.cacheRead / 1000000) * usage.cacheRead;
	usage.cost.cacheWrite = (model.cost.cacheWrite / 1000000) * usage.cacheWrite;
	usage.cost.total =
		usage.cost.input +
		usage.cost.output +
		usage.cost.cacheRead +
		usage.cost.cacheWrite;
	return usage.cost;
}
