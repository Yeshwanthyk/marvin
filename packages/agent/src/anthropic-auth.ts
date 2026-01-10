/**
 * Anthropic OAuth token storage
 */

import { chmodSync, mkdirSync, readFileSync, renameSync, unlinkSync, writeFileSync } from "node:fs"
import { homedir } from "node:os"
import { basename, dirname, join } from "node:path"

export type AnthropicOAuthCredentials = {
	refresh: string
	access: string
	expires: number
}

export type AnthropicTokenStoreOptions = {
	configDir?: string
	tokensFile?: string
}

const DEFAULT_CONFIG_DIR = join(homedir(), ".config", "marvin")

function resolveTokensFile(options?: AnthropicTokenStoreOptions): string {
	if (options?.tokensFile) return options.tokensFile
	const configDir = options?.configDir ?? DEFAULT_CONFIG_DIR
	return join(configDir, "anthropic-tokens.json")
}

function ensurePrivateDirSync(dir: string): void {
	mkdirSync(dir, { recursive: true, mode: 0o700 })
	try {
		chmodSync(dir, 0o700)
	} catch {
		// ignore
	}
}

function writePrivateFileAtomicSync(filePath: string, contents: string): void {
	const dir = dirname(filePath)
	ensurePrivateDirSync(dir)

	const tmpPath = join(dir, `.${basename(filePath)}.tmp.${process.pid}.${Date.now()}`)

	try {
		writeFileSync(tmpPath, contents, { mode: 0o600 })
		try {
			chmodSync(tmpPath, 0o600)
		} catch {
			// ignore
		}

		try {
			renameSync(tmpPath, filePath)
		} catch (err) {
			if (process.platform !== "win32") throw err
			try {
				unlinkSync(filePath)
			} catch {
				// ignore
			}
			renameSync(tmpPath, filePath)
		}

		try {
			chmodSync(filePath, 0o600)
		} catch {
			// ignore
		}
	} finally {
		try {
			unlinkSync(tmpPath)
		} catch {
			// ignore
		}
	}
}

function isAnthropicTokens(value: unknown): value is AnthropicOAuthCredentials {
	if (!value || typeof value !== "object") return false
	const v = value as Record<string, unknown>
	return typeof v.access === "string" && typeof v.refresh === "string" && typeof v.expires === "number"
}

export function loadAnthropicTokens(options?: AnthropicTokenStoreOptions): AnthropicOAuthCredentials | null {
	const tokensFile = resolveTokensFile(options)
	try {
		const data = readFileSync(tokensFile, "utf-8")
		const parsed = JSON.parse(data) as unknown
		return isAnthropicTokens(parsed) ? parsed : null
	} catch {
		return null
	}
}

export function saveAnthropicTokens(tokens: AnthropicOAuthCredentials, options?: AnthropicTokenStoreOptions): void {
	const tokensFile = resolveTokensFile(options)
	writePrivateFileAtomicSync(tokensFile, `${JSON.stringify(tokens, null, 2)}\n`)
}

export function clearAnthropicTokens(options?: AnthropicTokenStoreOptions): void {
	const tokensFile = resolveTokensFile(options)
	try {
		unlinkSync(tokensFile)
	} catch {
		// ignore
	}
}

export function getAnthropicTokensPath(options?: AnthropicTokenStoreOptions): string {
	return resolveTokensFile(options)
}
