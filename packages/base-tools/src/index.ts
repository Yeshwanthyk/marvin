// Re-export lazy tool registry
export { toolRegistry, type ToolDef } from "./tool-registry.js";

// Shell utilities for external use
export { getShellConfig, killProcessTree } from "./utils/shell.js";
export { truncateTail, formatSize, type TruncationResult, type TruncationOptions, DEFAULT_MAX_LINES, DEFAULT_MAX_BYTES } from "./tools/truncate.js";
