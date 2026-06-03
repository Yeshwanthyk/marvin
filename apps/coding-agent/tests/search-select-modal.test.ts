import { describe, expect, it } from "bun:test"
import { createSearchSelectItems, scoreSearchSelectOption } from "../src/ui/components/modals/search-select-options.js"

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
})
