import { createContext, useContext, type JSX } from "solid-js"
import type { LoadedSession } from "../session-manager.js"

export interface WorkspaceSwitchRequest {
	cwd: string
	sessionPath: string
}

export interface WorkspaceSwitchController {
	currentCwd: () => string
	switchTo: (request: WorkspaceSwitchRequest) => Promise<LoadedSession | null>
}

const noopController: WorkspaceSwitchController = {
	currentCwd: () => process.cwd(),
	switchTo: async () => null,
}

const WorkspaceSwitchContext = createContext<WorkspaceSwitchController>(noopController)

export const WorkspaceSwitchProvider = (props: { controller: WorkspaceSwitchController; children: JSX.Element }) => (
	<WorkspaceSwitchContext.Provider value={props.controller}>{props.children}</WorkspaceSwitchContext.Provider>
)

export const useWorkspaceSwitch = (): WorkspaceSwitchController => useContext(WorkspaceSwitchContext)
