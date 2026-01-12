import type { AgentTool } from "@marvin-agents/ai";
import type { TSchema } from "@sinclair/typebox";

export interface ToolDef {
	name: string;
	label: string;
	// Using TSchema as upper bound since specific schemas vary
	// but all tools conform to AgentTool interface
	load: () => Promise<AgentTool<TSchema>>;
}

export const toolRegistry: Record<string, ToolDef> = {
	read: {
		name: "read",
		label: "Read",
		load: () => import("./tools/read.js").then((m) => m.readTool as unknown as AgentTool<TSchema>),
	},
	bash: {
		name: "bash",
		label: "Bash",
		load: () => import("./tools/bash.js").then((m) => m.bashTool as unknown as AgentTool<TSchema>),
	},
	edit: {
		name: "edit",
		label: "Edit",
		load: () => import("./tools/edit.js").then((m) => m.editTool as unknown as AgentTool<TSchema>),
	},
	write: {
		name: "write",
		label: "Write",
		load: () => import("./tools/write.js").then((m) => m.writeTool as unknown as AgentTool<TSchema>),
	},
};
