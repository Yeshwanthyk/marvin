import type { SessionActorStatus } from "../../runtime/session-actor.js"

export const canMoveFocusedSessionAcrossProject = (
	status: SessionActorStatus | undefined,
	isResponding: boolean,
): boolean => status !== "streaming" && !isResponding
