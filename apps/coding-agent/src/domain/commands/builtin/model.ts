import { getModels, getProviders } from "@yeshwanthyk/ai"
import { updateAppConfig } from "../../../config.js"
import type { CommandDefinition } from "../types.js"
import { addSystemMessage, resolveModel, resolveProvider } from "../helpers.js"

export const modelCommand: CommandDefinition = {
	name: "model",
	execute: (args, ctx) => {
		if (!args) {
			addSystemMessage(ctx, "Usage: /model <provider> <modelId> (or /model <modelId>)")
			return true
		}

		if (ctx.isResponding()) {
			addSystemMessage(ctx, "Model cannot be changed while responding. Use /abort first.")
			return true
		}

		const parts = args.split(/\s+/)
		const firstPart = parts[0]
		if (parts.length === 1 && firstPart) {
			const modelId = firstPart
			const model = resolveModel(ctx.currentProvider, modelId)
			if (!model) {
				const examples = getModels(ctx.currentProvider).slice(0, 5).map((m) => m.id).join(", ")
				addSystemMessage(ctx, `Unknown model "${modelId}" for ${ctx.currentProvider}. Examples: ${examples}`)
				return true
			}

			ctx.agent.setModel(model)
			ctx.setCurrentModelId(model.id)
			ctx.setDisplayModelId(model.id)
			ctx.setDisplayContextWindow(model.contextWindow)
			ctx.clearEditor?.()
			void updateAppConfig(
				{ configDir: ctx.configDir, configPath: ctx.configPath },
				{ model: model.id },
			)
			return true
		}

		const [providerRaw, ...modelParts] = parts
		if (!providerRaw) {
			addSystemMessage(ctx, "Usage: /model <provider> <modelId> (or /model <modelId>)")
			return true
		}
		const provider = resolveProvider(providerRaw)
		if (!provider) {
			addSystemMessage(ctx, `Unknown provider "${providerRaw}". Known: ${getProviders().join(", ")}`)
			return true
		}

		const modelId = modelParts.join(" ")
		const model = resolveModel(provider, modelId)
		if (!model) {
			const examples = getModels(provider).slice(0, 5).map((m) => m.id).join(", ")
			addSystemMessage(ctx, `Unknown model "${modelId}" for ${provider}. Examples: ${examples}`)
			return true
		}

		ctx.agent.setModel(model)
		ctx.setCurrentProvider(provider)
		ctx.setCurrentModelId(model.id)
		ctx.setDisplayModelId(model.id)
		ctx.setDisplayContextWindow(model.contextWindow)
		ctx.clearEditor?.()
		void updateAppConfig(
			{ configDir: ctx.configDir, configPath: ctx.configPath },
			{ provider, model: model.id },
		)
		return true
	},
}
