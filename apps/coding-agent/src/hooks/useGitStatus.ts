import { createEffect, createSignal, onCleanup } from "solid-js"
import { watch, type FSWatcher } from "fs"
import { findGitHeadPath, getCurrentBranch } from "@runtime/git/git-info.js"

export function useGitStatus(cwd: () => string = () => process.cwd()): () => string | null {
	const [branch, setBranch] = createSignal<string | null>(getCurrentBranch(cwd()))

	createEffect(() => {
		const currentCwd = cwd()
		setBranch(getCurrentBranch(currentCwd))

		let watcher: FSWatcher | null = null
		const gitHeadPath = findGitHeadPath(currentCwd)
		if (gitHeadPath) {
			try {
				watcher = watch(gitHeadPath, () => setBranch(getCurrentBranch(currentCwd)))
			} catch {
				// ignore watcher errors
			}
		}

		onCleanup(() => {
			if (watcher) {
				watcher.close()
				watcher = null
			}
		})
	})

	return branch
}
