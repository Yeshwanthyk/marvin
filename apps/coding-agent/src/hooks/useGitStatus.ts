import { createSignal, onCleanup, onMount } from "solid-js"
import { watch, type FSWatcher } from "fs"
import { findGitHeadPath, getCurrentBranch } from "../utils.js"

export function useGitStatus(): () => string | null {
	const [branch, setBranch] = createSignal<string | null>(getCurrentBranch())
	let watcher: FSWatcher | null = null

	onMount(() => {
		const gitHeadPath = findGitHeadPath()
		if (gitHeadPath) {
			try {
				watcher = watch(gitHeadPath, () => setBranch(getCurrentBranch()))
			} catch {
				// ignore watcher errors
			}
		}
	})

	onCleanup(() => {
		if (watcher) {
			watcher.close()
			watcher = null
		}
	})

	return branch
}
