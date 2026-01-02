import { describe, expect, it } from "bun:test"
import { createAppStore } from "../src/ui/state/app-store.js"

describe("createAppStore", () => {
	it("initializes with provided defaults", () => {
		const store = createAppStore({
			initialTheme: "marvin",
			initialModelId: "claude",
			initialThinking: "low",
			initialContextWindow: 200000,
			initialProvider: "anthropic",
		})

		expect(store.theme.value()).toBe("marvin")
		expect(store.displayModelId.value()).toBe("claude")
		expect(store.displayThinking.value()).toBe("low")
		expect(store.displayContextWindow.value()).toBe(200000)
		expect(store.currentProvider.value()).toBe("anthropic")
	})

	it("updates signals when setters run", () => {
		const store = createAppStore({
			initialTheme: "marvin",
			initialModelId: "claude",
			initialThinking: "off",
			initialContextWindow: 80000,
			initialProvider: "anthropic",
		})

		store.theme.set("aurora")
		store.messages.set(() => [{ id: "1", role: "user", content: "hi" } as any])
		store.diffWrapMode.set("none")

		expect(store.theme.value()).toBe("aurora")
		expect(store.messages.value()).toHaveLength(1)
		expect(store.diffWrapMode.value()).toBe("none")
	})
})
