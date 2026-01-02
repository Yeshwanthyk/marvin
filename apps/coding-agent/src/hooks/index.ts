/**
 * Hook system for Marvin coding agent.
 *
 * Hooks are TypeScript modules that subscribe to agent lifecycle events.
 * Load from ~/.config/marvin/hooks/*.ts
 */

// Re-export all types for hook authors
export * from "./types.js"

// Loader
export {
	loadHooks,
	type LoadedHook,
	type LoadHooksResult,
	type SendHandler,
	type SendMessageHandler,
	type AppendEntryHandler,
} from "./loader.js"

// Runner
export { HookRunner, createEmptyRunner, type HookErrorListener } from "./runner.js"

// Tool wrapping
export { wrapToolWithHooks, wrapToolsWithHooks } from "./tool-wrapper.js"

// Hook message utilities
export { createHookMessage, hookMessageToText } from "./hook-messages.js"

// Message transformer
export { transformMessages } from "./message-transformer.js"

// Hook transport wrapper
export { HookedTransport } from "./hook-transport.js"

// Hook tool adapter
export { createHookToolAdapter, getHookTools } from "./hook-tool-adapter.js"

// Hook UI context
export { createHookUIContext, type HookUIHandlers } from "./hook-ui-context.js"
