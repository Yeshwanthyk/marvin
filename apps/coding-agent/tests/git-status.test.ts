import { afterEach, describe, expect, it } from "bun:test"
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "fs"
import { join } from "path"
import { tmpdir } from "os"

const tempDirs: string[] = []

const makeGitFixture = (name: string, branch: string): string => {
	const dir = mkdtempSync(join(tmpdir(), `marvin-${name}-`))
	tempDirs.push(dir)
	mkdirSync(join(dir, ".git"))
	writeFileSync(join(dir, ".git", "HEAD"), `ref: refs/heads/${branch}\n`, "utf8")
	return dir
}

afterEach(() => {
	for (const dir of tempDirs.splice(0)) {
		rmSync(dir, { recursive: true, force: true })
	}
})

describe("useGitStatus", () => {
	it("tracks the branch for the runtime cwd instead of process cwd", async () => {
		await import("../src/solid-preload.js")
		const { createRoot, createSignal } = await import("solid-js")
		const { useGitStatus } = await import("../src/hooks/useGitStatus.js")

		const nora = makeGitFixture("nora", "master")
		const marvin = makeGitFixture("marvin", "kyendamuri/footer-cwd")
		const [cwd, setCwd] = createSignal(nora)

		let branch!: () => string | null
		const dispose = createRoot((dispose) => {
			branch = useGitStatus(cwd)
			return dispose
		})
		try {
			expect(branch()).toBe("master")

			setCwd(marvin)
			await Promise.resolve()

			expect(branch()).toBe("kyendamuri/footer-cwd")
		} finally {
			dispose()
		}
	})
})
