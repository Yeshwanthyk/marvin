import type { AgentTool } from "@marvin-agents/ai";
import type { ToolDef } from "@marvin-agents/base-tools";
import type { TSchema } from "@sinclair/typebox";

/**
 * Lazily loads tools from registry + manages custom/hook tools.
 * Pre-loads core tools (read, bash) on instantiation for fast startup.
 */
export class LazyToolLoader {
	private loaded = new Map<string, AgentTool<TSchema>>();
	private loading = new Map<string, Promise<AgentTool<TSchema>>>();

	constructor(
		private registry: Record<string, ToolDef>,
		private customTools: AgentTool[] = [],
		private hookTools: AgentTool[] = [],
	) {}

	/**
	 * Pre-load core tools for fast startup.
	 * Call this after construction but before agent runs.
	 */
	async preloadCoreTools(): Promise<void> {
		await Promise.all([this.getTool("read"), this.getTool("bash"), this.getTool("edit"), this.getTool("write")]);
	}

	/**
	 * Get a tool, loading lazily if not yet loaded.
	 * Returns null if tool doesn't exist.
	 */
	async getTool(name: string): Promise<AgentTool<TSchema> | null> {
		// Check already loaded
		if (this.loaded.has(name)) {
			return this.loaded.get(name)!;
		}

		// Check currently loading (avoid duplicate loads)
		if (this.loading.has(name)) {
			return this.loading.get(name)!;
		}

		// Check custom tools (always available, no loading needed)
		const custom = this.customTools.find((t) => t.name === name);
		if (custom) return custom;

		// Check hook tools (always available)
		const hook = this.hookTools.find((t) => t.name === name);
		if (hook) return hook;

		// Load from registry
		const def = this.registry[name];
		if (!def) return null;

		const promise = def
			.load()
			.then((tool: AgentTool<TSchema>) => {
				this.loaded.set(name, tool);
				this.loading.delete(name);
				return tool;
			})
			.catch((err: unknown) => {
				this.loading.delete(name);
				throw err;
			});

		this.loading.set(name, promise);
		return promise;
	}

	/**
	 * Get all currently loaded tools as an array.
	 * Includes custom and hook tools.
	 */
	getLoadedTools(): AgentTool[] {
		return [
			...Array.from(this.loaded.values()),
			...this.customTools,
			...this.hookTools,
		];
	}

	/**
	 * Get all tools (loaded + pre-loaded + custom + hooks)
	 * For use with agent initialization.
	 * Returns a proxy array that supports find() without full loading.
	 */
	getToolsProxy(): ToolProxyArray {
		return new ToolProxyArray(this);
	}
}

/**
 * Proxy array that supports array operations but loads tools lazily.
 * Used for agent.state.tools to maintain array interface.
 */
export class ToolProxyArray {
	constructor(private loader: LazyToolLoader) {}

	/**
	 * Find a tool by predicate.
	 * Only searches pre-loaded tools (core + custom + hooks).
	 * Secondary tools are loaded on-demand by agent-loop.
	 */
	find(predicate: (tool: AgentTool) => boolean): AgentTool | undefined {
		return this.loader.getLoadedTools().find(predicate);
	}

	/**
	 * Check if array is empty.
	 */
	get length(): number {
		return this.loader.getLoadedTools().length;
	}

	/**
	 * Iterate over loaded tools.
	 */
	[Symbol.iterator]() {
		return this.loader.getLoadedTools()[Symbol.iterator]();
	}

	/**
	 * Filter loaded tools.
	 */
	filter(predicate: (tool: AgentTool) => boolean): AgentTool[] {
		return this.loader.getLoadedTools().filter(predicate);
	}

	/**
	 * Map over loaded tools.
	 */
	map<T>(fn: (tool: AgentTool) => T): T[] {
		return this.loader.getLoadedTools().map(fn);
	}
}

/**
 * Type assertion helper for agent-loop and other code that expects an array.
 * The proxy implements enough array methods to work with existing code.
 */
export function toolProxyAsArray(proxy: ToolProxyArray): AgentTool[] {
	return proxy as any;
}
