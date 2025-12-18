import { bashTool } from './tools/bash.js';
import { editTool, type DiffLine, type StructuredDiff } from './tools/edit.js';
import { readTool } from './tools/read.js';
import { writeTool } from './tools/write.js';

export { bashTool, editTool, readTool, writeTool };
export type { DiffLine, StructuredDiff };

export const codingTools = [readTool, bashTool, editTool, writeTool];
