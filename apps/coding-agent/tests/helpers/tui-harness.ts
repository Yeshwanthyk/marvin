import type { JSX } from "solid-js"
import { testRender } from "@opentui/solid"
import type {
	MockInput,
	MockMouse,
	TestRendererOptions,
	TestRendererSetup,
} from "@opentui/core/testing"

export interface HumanTuiHarness extends TestRendererSetup {
	keys: MockInput
	mouse: MockMouse
	frame: () => string
	typeText: (text: string) => Promise<void>
	paste: (text: string) => Promise<void>
	pressShortcut: (key: string, modifiers: { shift?: boolean; ctrl?: boolean; meta?: boolean; super?: boolean }) => Promise<void>
}

export async function renderHumanTui(
	node: () => JSX.Element,
	options: TestRendererOptions = {},
): Promise<HumanTuiHarness> {
	const setup = await testRender(node, {
		width: 100,
		height: 32,
		kittyKeyboard: true,
		...options,
	})
	await setup.flush()

	return {
		...setup,
		keys: setup.mockInput,
		mouse: setup.mockMouse,
		frame: setup.captureCharFrame,
		typeText: async (text: string) => {
			await setup.mockInput.typeText(text)
			await setup.flush()
		},
		paste: async (text: string) => {
			await setup.mockInput.pasteBracketedText(text)
			await setup.flush()
		},
		pressShortcut: async (key, modifiers) => {
			setup.mockInput.pressKey(key, modifiers)
			await setup.flush()
		},
	}
}
