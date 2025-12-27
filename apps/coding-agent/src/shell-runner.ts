/**
 * Shell command runner for TUI ! prefix commands.
 * Executes commands and returns truncated output.
 */

import { spawn } from "node:child_process"
import { createWriteStream, mkdirSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import {
	getShellConfig,
	killProcessTree,
	truncateTail,
	DEFAULT_MAX_LINES,
	DEFAULT_MAX_BYTES,
	type TruncationResult,
} from "@marvin-agents/base-tools"

export interface ShellResult {
	output: string
	exitCode: number | null
	truncated: boolean
	truncation?: TruncationResult
	tempFilePath?: string
	cancelled: boolean
}

function getTempFilePath(): string {
	const dir = join(tmpdir(), "marvin-shell")
	mkdirSync(dir, { recursive: true })
	return join(dir, `output-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.txt`)
}

/**
 * Execute a shell command and return the result with truncation applied.
 */
export function runShellCommand(
	command: string,
	options?: { signal?: AbortSignal; timeout?: number }
): Promise<ShellResult> {
	return new Promise((resolve) => {
		const { shell, args } = getShellConfig()
		const child = spawn(shell, [...args, command], {
			detached: true,
			stdio: ["ignore", "pipe", "pipe"],
		})

		const chunks: Buffer[] = []
		let totalBytes = 0
		let tempFilePath: string | undefined
		let tempFileStream: ReturnType<typeof createWriteStream> | undefined
		let cancelled = false
		let timeoutId: ReturnType<typeof setTimeout> | undefined

		// Timeout handling
		if (options?.timeout) {
			timeoutId = setTimeout(() => {
				cancelled = true
				if (child.pid) killProcessTree(child.pid)
			}, options.timeout)
		}

		// Abort signal handling
		if (options?.signal) {
			options.signal.addEventListener("abort", () => {
				cancelled = true
				if (child.pid) killProcessTree(child.pid)
			})
		}

		const handleData = (data: Buffer) => {
			totalBytes += data.length

			// Start temp file if exceeding threshold
			if (totalBytes > DEFAULT_MAX_BYTES && !tempFilePath) {
				tempFilePath = getTempFilePath()
				tempFileStream = createWriteStream(tempFilePath)
				// Write existing chunks to temp file
				for (const chunk of chunks) {
					tempFileStream.write(chunk)
				}
			}

			// Write to temp file if active
			if (tempFileStream) {
				tempFileStream.write(data)
			}

			// Keep rolling buffer (2x max for truncation headroom)
			chunks.push(data)
			let chunksBytes = chunks.reduce((sum, c) => sum + c.length, 0)
			const maxChunksBytes = DEFAULT_MAX_BYTES * 2
			while (chunksBytes > maxChunksBytes && chunks.length > 1) {
				const removed = chunks.shift()!
				chunksBytes -= removed.length
			}
		}

		child.stdout?.on("data", handleData)
		child.stderr?.on("data", handleData)

		child.on("close", (code) => {
			if (timeoutId) clearTimeout(timeoutId)
			if (tempFileStream) tempFileStream.end()

			const fullOutput = Buffer.concat(chunks).toString("utf-8")
			const truncation = truncateTail(fullOutput, {
				maxLines: DEFAULT_MAX_LINES,
				maxBytes: DEFAULT_MAX_BYTES,
			})

			resolve({
				output: truncation.content,
				exitCode: code,
				truncated: truncation.truncated,
				truncation: truncation.truncated ? truncation : undefined,
				tempFilePath: truncation.truncated ? tempFilePath : undefined,
				cancelled,
			})
		})

		child.on("error", (err) => {
			if (timeoutId) clearTimeout(timeoutId)
			if (tempFileStream) tempFileStream.end()

			resolve({
				output: `Error: ${err.message}`,
				exitCode: null,
				truncated: false,
				cancelled,
			})
		})
	})
}
