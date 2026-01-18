// Re-export lazy tool registry
export { createToolRegistry, type ToolDef, type ToolRegistry } from "./tool-registry.js";

// Tool factories
export { createReadTool } from "./tools/read.js";
export { createWriteTool } from "./tools/write.js";
export { createEditTool } from "./tools/edit.js";
export { createBashTool } from "./tools/bash.js";

// Shell utilities for external use
export { getShellConfig, killProcessTree } from "./utils/shell.js";
export { truncateTail, formatSize, type TruncationResult, type TruncationOptions, DEFAULT_MAX_LINES, DEFAULT_MAX_BYTES } from "./tools/truncate.js";
