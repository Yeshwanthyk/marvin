import { describe, expect, it } from "bun:test"
import { useScratchpadActions } from "../src/ui/app-shell/useScratchpadActions.js"
import type { ScratchpadItem } from "@yeshwanthyk/runtime-effect/scratchpads.js"
import type { createScratchpadStore } from "@yeshwanthyk/runtime-effect/scratchpads.js"
import type { useModals } from "../src/ui/hooks/useModals.js"
import type { useRuntime } from "../src/runtime/context.js"

type ScratchpadStore = ReturnType<typeof createScratchpadStore>
type SessionManager = ReturnType<typeof useRuntime>["sessionManager"]
type Modals = ReturnType<typeof useModals>

const scratchpad: ScratchpadItem = {
	id: "scratch-a",
	cwd: "/tmp/project",
	title: "scratch title",
	bodyPath: "/tmp/scratch.md",
	bodyPreview: "body",
	tags: [],
	status: "open",
	createdAt: "2026-07-03T00:00:00.000Z",
	updatedAt: "2026-07-03T00:00:00.000Z",
	source: { kind: "tui" },
}

describe("scratchpad actions", () => {
	it("starts same-project scratchpads through workspace focus instead of mutating the current actor", async () => {
		const switched: Array<{ cwd: string; title: string; prompt: string; scratchpadId: string }> = []
		const actions = useScratchpadActions({
			scratchpadStore: {
				list: () => [scratchpad],
				read: () => ({ item: scratchpad, body: "scratch body" }),
				add: () => scratchpad,
			} as ScratchpadStore,
			sessionManager: {
				projectCwd: "/tmp/project",
				sessionId: "old-session",
			} as SessionManager,
			modals: {
				showSearchSelect: async () => scratchpad.id,
				showEditor: async () => undefined,
			} as Modals,
			getEditorText: () => "",
			setEditorText: () => {},
			showToast: () => {},
			switchToFreshWorkspace: async (cwd, options) => {
				switched.push({ cwd, ...options })
				return true
			},
		})

		await actions.startScratchpad(scratchpad.id)

		expect(switched).toEqual([{
			cwd: "/tmp/project",
			title: "scratch title",
			prompt: "scratch body",
			scratchpadId: "scratch-a",
		}])
	})
})
