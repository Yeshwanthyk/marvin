import { bashTool } from "./tools/bash.js";
import { editTool } from "./tools/edit.js";
import { readTool } from "./tools/read.js";
import { writeTool } from "./tools/write.js";

export { bashTool, editTool, readTool, writeTool };

export const codingTools = [readTool, bashTool, editTool, writeTool];

// Shell utilities for external use
export { getShellConfig, killProcessTree } from "./utils/shell.js";
export { truncateTail, formatSize, type TruncationResult, type TruncationOptions, DEFAULT_MAX_LINES, DEFAULT_MAX_BYTES } from "./tools/truncate.js";
