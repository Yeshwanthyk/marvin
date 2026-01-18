import { Context, Effect, Layer } from "effect"
import { createLspManager, type LspManager } from "@marvin-agents/lsp"
import { ConfigTag } from "./config.js"
import { InstrumentationTag } from "./instrumentation.js"

export interface LspService {
	manager: LspManager
	activityRef: { setActive: (value: boolean) => void }
	notifyActivity: (active: boolean) => void
}

export const LspServiceTag = Context.GenericTag<LspService>("runtime-effect/LspService")

export interface LspLayerOptions {
	cwd: string
	lspFactory?: typeof createLspManager
}

export const LspLayer = (options: LspLayerOptions) =>
	Layer.scoped(
		LspServiceTag,
		Effect.gen(function* () {
			const { config } = yield* ConfigTag
			const instrumentation = yield* InstrumentationTag
			const factory = options.lspFactory ?? createLspManager

			const manager = factory({
				cwd: options.cwd,
				configDir: config.configDir,
				enabled: config.lsp.enabled,
				autoInstall: config.lsp.autoInstall,
			})

			const activityRef = { setActive: (_value: boolean) => {} }
			const notifyActivity = (active: boolean) => {
				instrumentation.record({ type: "lsp:activity", active })
				activityRef.setActive(active)
			}

			yield* Effect.addFinalizer(() =>
				Effect.promise(() => manager.shutdown().catch(() => {})),
			)

			return { manager, activityRef, notifyActivity }
		}),
	)
