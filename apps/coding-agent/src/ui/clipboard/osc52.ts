import { spawnSync } from "child_process"

export const copyToClipboard = (text: string): void => {
	const base64 = Buffer.from(text).toString("base64")
	if (process.env["TMUX"]) {
		process.stdout.write(`\x1bPtmux;\x1b\x1b]52;c;${base64}\x07\x1b\\`)
	} else {
		process.stdout.write(`\x1b]52;c;${base64}\x07`)
	}

	if (process.platform === "darwin") {
		try {
			spawnSync("pbcopy", { input: text, encoding: "utf-8" })
		} catch {
			// Ignore clipboard failures on non-macOS systems
		}
	}
}
