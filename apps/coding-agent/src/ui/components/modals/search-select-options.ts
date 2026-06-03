import type { SelectItem } from "@yeshwanthyk/open-tui"

export interface SearchSelectOption {
	value: string
	label: string
	description?: string
	keywords?: string
}

export type SearchSelectOptionInput = string | SearchSelectOption

const normalizeOption = (option: SearchSelectOptionInput): SearchSelectOption =>
	typeof option === "string" ? { value: option, label: option } : option

const searchableText = (option: SearchSelectOption): string =>
	[option.label, option.description, option.keywords, option.value].filter(Boolean).join(" ").toLowerCase()

export const scoreSearchSelectOption = (option: SearchSelectOption, query: string): number => {
	const q = query.toLowerCase().trim()
	if (!q) return 1

	const terms = q.split(/\s+/).filter(Boolean)
	const haystack = searchableText(option)
	if (!terms.every((term) => haystack.includes(term))) return 0

	return terms.reduce((score, term) => {
		const label = option.label.toLowerCase()
		const description = option.description?.toLowerCase() ?? ""
		if (label.startsWith(term)) return score + 6
		if (label.includes(` ${term}`)) return score + 5
		if (label.includes(term)) return score + 4
		if (description.includes(term)) return score + 2
		return score + 1
	}, 0)
}

export const createSearchSelectItems = (options: SearchSelectOptionInput[], query: string): SelectItem[] =>
	options
		.map((option, index) => {
			const normalized = normalizeOption(option)
			return { option: normalized, index, score: scoreSearchSelectOption(normalized, query) }
		})
		.filter((entry) => entry.score > 0)
		.sort((a, b) => b.score - a.score || a.index - b.index)
		.slice(0, 40)
		.map((entry) => ({
			value: entry.option.value,
			label: entry.option.label,
			description: entry.option.description,
		}))
