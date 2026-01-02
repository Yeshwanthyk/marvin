import { mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { tmpdir } from "node:os"

export interface TestConfigDir {
	configDir: string
	configPath: string
	cleanup: () => void
}

const DEFAULT_CONFIG = {
	provider: "anthropic",
	model: "claude-3-5-sonnet-20241022",
	thinking: "off",
	theme: "marvin",
	lsp: { enabled: false, autoInstall: false },
}

export const createTestConfigDir = (overrides: Record<string, unknown> = {}): TestConfigDir => {
	const configDir = mkdtempSync(join(tmpdir(), "marvin-config-test-"))
	const configPath = join(configDir, "config.json")
	writeFileSync(configPath, JSON.stringify({ ...DEFAULT_CONFIG, ...overrides }, null, 2))
	return {
		configDir,
		configPath,
		cleanup: () => {
			rmSync(configDir, { recursive: true, force: true })
		},
	}
}
