import { clearCommand } from "./clear.js"
import { compactCommand } from "./compact.js"
import { concealCommand } from "./conceal.js"
import { diffwrapCommand } from "./diffwrap.js"
import { editorCommand } from "./editor.js"
import { exitCommand } from "./exit.js"
import { followupCommand } from "./followup.js"
import { forkCommand } from "./fork.js"
import { loginCommand } from "./login.js"
import { modelCommand } from "./model.js"
import { statusCommand } from "./status.js"
import { steerCommand } from "./steer.js"
import { themeCommand } from "./theme.js"
import { thinkingCommand } from "./thinking.js"

export const builtinCommands = [
	exitCommand,
	clearCommand,
	thinkingCommand,
	diffwrapCommand,
	concealCommand,
	themeCommand,
	editorCommand,
	modelCommand,
	compactCommand,
	statusCommand,
	loginCommand,
	steerCommand,
	followupCommand,
	forkCommand,
]
