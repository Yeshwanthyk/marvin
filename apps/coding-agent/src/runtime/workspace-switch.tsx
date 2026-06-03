import { createContext, useContext, type JSX } from "solid-js"
import type { LoadedSession } from "../session-manager.js"

export interface WorkspaceSwitchRequest {
	cwd: string
	sessionPath?: string
	fresh?: boolean
	initialSessionTitle?: string
	initialPrompt?: string
	initialScratchpadId?: string
	preserveLaneMode?: boolean
}

export type VisibleSession =
	| { state: "none" }
	| { state: "loaded"; cwd: string; sessionPath: string; sessionId: string; session: LoadedSession }
	| { state: "missing"; cwd: string; sessionPath: string }

export interface WorkspaceSwitchResult {
	switched: boolean
	session: LoadedSession | null
	visibleSession: VisibleSession
}

export interface WorkspaceSwitchController {
	currentCwd: () => string
	switchTo: (request: WorkspaceSwitchRequest) => Promise<WorkspaceSwitchResult>
}

const noopController: WorkspaceSwitchController = {
	currentCwd: () => process.cwd(),
	switchTo: async () => ({ switched: false, session: null, visibleSession: { state: "none" } }),
}

const WorkspaceSwitchContext = createContext<WorkspaceSwitchController>(noopController)

export const WorkspaceSwitchProvider = (props: { controller: WorkspaceSwitchController; children: JSX.Element }) => (
	<WorkspaceSwitchContext.Provider value={props.controller}>{props.children}</WorkspaceSwitchContext.Provider>
)

export const useWorkspaceSwitch = (): WorkspaceSwitchController => useContext(WorkspaceSwitchContext)
