import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { Type } from "typebox";

export default function helloExtension(pi: ExtensionAPI) {
	pi.registerCommand("hello", {
		description: "Show a greeting from an extension",
		handler: async (args, ctx) => {
			ctx.ui.notify(`Hello ${args.trim() || "world"}`, "info");
		},
	});

	pi.registerTool({
		name: "hello_name",
		label: "Hello Name",
		description: "Return a greeting for a name",
		parameters: Type.Object({
			name: Type.String({ description: "Name to greet" }),
		}),
		async execute(_toolCallId, params) {
			return {
				content: [{ type: "text", text: `Hello, ${params.name}!` }],
				details: { name: params.name },
			};
		},
	});
}
