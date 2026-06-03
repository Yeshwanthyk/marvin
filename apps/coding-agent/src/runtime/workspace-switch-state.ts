import type { LoadedSession } from "../session-manager.js"
import type { WorkspaceSwitchRequest } from "./workspace-switch.js"
import { activeSessionsForProject, type WorkspaceLanes } from "@yeshwanthyk/runtime-effect/workspace-lanes.js"

export const shouldStartFreshWorkspaceSession = (
	request: WorkspaceSwitchRequest,
	loadedSession: LoadedSession | null,
): boolean => request.fresh === true || (request.sessionPath === undefined && loadedSession === null)

export const shouldStartFreshProjectSwitch = (
	lanes: WorkspaceLanes,
	projectId: string,
	explicitFresh?: boolean,
): boolean => explicitFresh === true || activeSessionsForProject(lanes, projectId).length === 0
