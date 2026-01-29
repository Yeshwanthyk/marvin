import { clearCommand } from "./clear.js"
import { compactCommand } from "./compact.js"

import { editorCommand } from "./editor.js"
import { exitCommand } from "./exit.js"
import { followupCommand } from "./followup.js"
import { forkCommand } from "./fork.js"
import { loginCommand } from "./login.js"
import { modelCommand } from "./model.js"
import { statusCommand } from "./status.js"
import { sessionsCommand } from "./sessions.js"
import { steerCommand } from "./steer.js"
import { themeCommand } from "./theme.js"


export const builtinCommands = [
	exitCommand,
	clearCommand,
	themeCommand,
	editorCommand,
	modelCommand,
	compactCommand,
	statusCommand,
	loginCommand,
	steerCommand,
	followupCommand,
	forkCommand,
	sessionsCommand,
]
