import type { AgentTool } from "@yeshwanthyk/ai";

export interface ToolDef {
	name: string;
	label: string;
	load: () => Promise<AgentTool>;
}

export type ToolRegistry = Record<string, ToolDef>;

export const createToolRegistry = (cwd: string): ToolRegistry => ({
	read: {
		name: "read",
		label: "Read",
		load: async () => {
			const { createReadTool } = await import("./tools/read.js");
			return createReadTool(cwd);
		},
	},
	bash: {
		name: "bash",
		label: "Bash",
		load: async () => {
			const { createBashTool } = await import("./tools/bash.js");
			return createBashTool(cwd);
		},
	},
	edit: {
		name: "edit",
		label: "Edit",
		load: async () => {
			const { createEditTool } = await import("./tools/edit.js");
			return createEditTool(cwd);
		},
	},
	write: {
		name: "write",
		label: "Write",
		load: async () => {
			const { createWriteTool } = await import("./tools/write.js");
			return createWriteTool(cwd);
		},
	},
});
