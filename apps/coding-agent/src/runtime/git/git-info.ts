import { existsSync, readFileSync } from "fs"
import { dirname, join } from "path"

export const findGitHeadPath = (startDir: string = process.cwd()): string | null => {
	let dir = startDir
	while (true) {
		const gitHeadPath = join(dir, ".git", "HEAD")
		if (existsSync(gitHeadPath)) return gitHeadPath
		const parent = dirname(dir)
		if (parent === dir) return null
		dir = parent
	}
}

export const getCurrentBranch = (startDir?: string): string | null => {
	try {
		const gitHeadPath = findGitHeadPath(startDir)
		if (!gitHeadPath) return null
		const content = readFileSync(gitHeadPath, "utf8").trim()
		if (content.startsWith("ref: refs/heads/")) return content.slice(16)
		return "detached"
	} catch {
		return null
	}
}
