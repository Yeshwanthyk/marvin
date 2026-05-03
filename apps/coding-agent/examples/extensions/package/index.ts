import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";

export default function packageExample(pi: ExtensionAPI) {
	pi.on("session_start", async (_event, ctx) => {
		ctx.ui.notify("package example loaded", "info");
	});

	pi.registerCommand("package-ping", {
		description: "Verify the package extension is loaded",
		handler: async (_args, ctx) => {
			ctx.ui.notify("package pong", "info");
		},
	});
}
