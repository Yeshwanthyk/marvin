import { describe, expect, it } from "bun:test"
import { createSearchSelectItems, scoreSearchSelectOption } from "../src/ui/components/modals/search-select-options.js"
import type { HumanTuiHarness } from "./helpers/tui-harness.js"

async function renderSearchSelectModal(): Promise<HumanTuiHarness> {
	await import("@opentui/solid/preload")
	await import("../src/solid-preload.js")
	const { createComponent } = await import("solid-js")
	const { ThemeProvider } = await import("@yeshwanthyk/open-tui")
	const { SearchSelectModal } = await import("../src/ui/components/modals/SearchSelectModal.js")
	const { renderHumanTui } = await import("./helpers/tui-harness.js")

	return renderHumanTui(() => {
		return createComponent(ThemeProvider, {
			mode: "dark",
			themeName: "aura",
			get children() {
				return createComponent(SearchSelectModal, {
					title: "Jump",
					options: [
						{ value: "project:nora", label: "Project / nora", description: "/Users/yesh/Documents/work/nora" },
						{ value: "project:marvin", label: "Project / marvin", description: "/Users/yesh/Documents/personal/marvin" },
						{ value: "archive", label: "Archive session", description: "Remove current session from active lanes" },
					],
					onSelect: (_value: string | undefined) => {},
				})
			},
		})
	}, { width: 120, height: 36 })
}

describe("SearchSelectModal option helpers", () => {
	it("keeps structured labels separate from searchable metadata", () => {
		const items = createSearchSelectItems(
			[
				{
					value: "nora:b17f0285",
					label: "nora / investigate org migration",
					description: "b17f0285 | code/gpt-5.5-low",
					keywords: "/Users/yesh/Documents/work/nora b17f0285",
				},
			],
			"gpt",
		)

		expect(items).toEqual([
			{
				value: "nora:b17f0285",
				label: "nora / investigate org migration",
				description: "b17f0285 | code/gpt-5.5-low",
			},
		])
	})

	it("requires every query term and preserves source order when scores tie", () => {
		const items = createSearchSelectItems(
			[
				{ value: "first", label: "nora / work order data", description: "aaaa1111 | code/gpt" },
				{ value: "second", label: "nora / user migration", description: "bbbb2222 | code/gpt" },
				{ value: "third", label: "marvin / jump modal", description: "cccc3333 | code/gpt" },
			],
			"nora gpt",
		)

		expect(items.map((item) => item.value)).toEqual(["first", "second"])
	})

	it("scores label prefix matches above description-only matches", () => {
		const labelMatch = scoreSearchSelectOption({ value: "a", label: "nora / users", description: "code/gpt" }, "nora")
		const descriptionMatch = scoreSearchSelectOption({ value: "b", label: "users", description: "nora code/gpt" }, "nora")

		expect(labelMatch).toBeGreaterThan(descriptionMatch)
	})

	it("matches fuzzy subsequences for project jumping", () => {
		const items = createSearchSelectItems(
			[
				{ value: "nora", label: "Project / nora", description: "/Users/yesh/Documents/work/nora" },
				{ value: "marvin", label: "Project / marvin", description: "/Users/yesh/Documents/personal/marvin" },
			],
			"mvn",
		)

		expect(items.map((item) => item.value)).toEqual(["marvin"])
	})

	it("keeps the command palette body visible when filtering to no matches", async () => {
		const harness = await renderSearchSelectModal()
		try {
			expect(harness.frame()).toContain("3 items")

			await harness.typeText("zzzz")
			const frame = harness.frame()

			expect(frame).toContain("0/3 matches")
			expect(frame).toContain("No matching items")
			expect(frame).toContain("type to filter")
		} finally {
			harness.renderer.destroy()
		}
	})
})
