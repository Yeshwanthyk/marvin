import { describe, expect, it } from "bun:test"
import { createTestRenderer } from "../src/testing.js"

describe("OpenTUI human harness primitives", () => {
	it("drives real keyboard, paste, mouse, resize, and frame capture", async () => {
		const setup = await createTestRenderer({ width: 40, height: 12, kittyKeyboard: true })
		const keys: Array<{ name: string; ctrl: boolean; shift: boolean }> = []

		setup.renderer.keyInput.on("keypress", (event: { name: string; ctrl: boolean; shift: boolean }) => {
			keys.push({ name: event.name, ctrl: event.ctrl, shift: event.shift })
		})

		await setup.mockInput.typeText("ab")
		setup.mockInput.pressArrow("right")
		setup.mockInput.pressKey("k", { ctrl: true })
		await setup.mockInput.pasteBracketedText("pasted")
		await setup.flush()

		expect(keys.map((key) => key.name)).toContain("a")
		expect(keys.map((key) => key.name)).toContain("right")
		expect(keys.some((key) => key.name === "k" && key.ctrl)).toBe(true)

		await setup.mockMouse.click(5, 4)
		expect(setup.mockMouse.getCurrentPosition()).toEqual({ x: 5, y: 4 })

		setup.resize(64, 18)
		await setup.flush()
		expect(setup.captureSpans().cols).toBe(64)
		expect(typeof setup.captureCharFrame()).toBe("string")

		setup.renderer.destroy()
	})
})
