/**
 * Hook system for Marvin coding agent.
 *
 * Hooks are TypeScript modules that subscribe to agent lifecycle events.
 * Load from ~/.config/marvin/hooks/*.ts
 */

export * from "./types.js"
export { loadHooks, type LoadedHook, type LoadHooksResult, type SendHandler } from "./loader.js"
export { HookRunner, createEmptyRunner, type HookErrorListener } from "./runner.js"
export { wrapToolWithHooks, wrapToolsWithHooks } from "./tool-wrapper.js"
