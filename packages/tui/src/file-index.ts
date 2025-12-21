import { spawn } from "child_process";
import fuzzysort from "fuzzysort";
import { basename, dirname } from "path";

export interface FileIndexOptions {
	cwd: string;
	// If provided, only index on explicit call to refresh()
	lazy?: boolean;
}

export interface FileSearchResult {
	path: string;
	isDirectory: boolean;
	score: number;
}

type SearchItem = { path: string; isDirectory: boolean };

/**
 * Fast file index using ripgrep for listing and fuzzysort for matching.
 * Respects .gitignore by default.
 */
export class FileIndex {
	private cwd: string;
	private files: string[] = [];
	private dirs: Set<string> = new Set();
	private indexing = false;
	private indexed = false;
	private pendingCallbacks: Array<() => void> = [];
	private searchItemsFilesOnly: SearchItem[] = [];
	private searchItemsWithDirs: SearchItem[] = [];

	constructor(options: FileIndexOptions) {
		this.cwd = options.cwd;
		if (!options.lazy) {
			this.refresh();
		}
	}

	/**
	 * Refresh the file index using ripgrep.
	 * Returns a promise that resolves when indexing is complete.
	 */
	async refresh(): Promise<void> {
		if (this.indexing) {
			// Wait for current indexing to complete
			return new Promise((resolve) => {
				this.pendingCallbacks.push(resolve);
			});
		}

		this.indexing = true;
		const files: string[] = [];
		const dirs = new Set<string>();

		try {
			await new Promise<void>((resolve) => {
				const proc = spawn("rg", ["--files", "--follow", "--hidden", "--glob=!.git/*"], {
					cwd: this.cwd,
					stdio: ["ignore", "pipe", "ignore"],
				});

				let buffer = "";

				proc.stdout.on("data", (chunk: Buffer) => {
					buffer += chunk.toString();
					const lines = buffer.split("\n");
					buffer = lines.pop() || "";

					for (const line of lines) {
						if (line) {
							files.push(line);
							// Extract directories from path
							let current = line;
							while (true) {
								const dir = dirname(current);
								if (dir === "." || dir === current) break;
								current = dir;
								if (dirs.has(dir)) break;
								dirs.add(dir);
							}
						}
					}
				});

				proc.on("close", () => {
					// Process remaining buffer
					if (buffer) {
						files.push(buffer);
						let current = buffer;
						while (true) {
							const dir = dirname(current);
							if (dir === "." || dir === current) break;
							current = dir;
							if (dirs.has(dir)) break;
							dirs.add(dir);
						}
					}
					resolve();
				});

				proc.on("error", () => {
					// ripgrep not available, fail silently
					resolve();
				});
			});

			this.files = files;
			this.dirs = dirs;
			this.searchItemsFilesOnly = files.map((f) => ({ path: f, isDirectory: false }));
			this.searchItemsWithDirs = [
				...this.searchItemsFilesOnly,
				...Array.from(dirs, (dir) => ({ path: dir + "/", isDirectory: true })),
			];
			this.indexed = true;
		} finally {
			this.indexing = false;
			// Notify waiting callers
			for (const cb of this.pendingCallbacks) {
				cb();
			}
			this.pendingCallbacks = [];
		}
	}

	/**
	 * Search files with fuzzy matching.
	 */
	search(query: string, options?: { limit?: number; includeDirs?: boolean }): FileSearchResult[] {
		const limit = options?.limit ?? 20;
		const includeDirs = options?.includeDirs ?? true;

		// If not indexed yet, return empty (non-blocking)
		if (!this.indexed && !this.indexing) {
			this.refresh();
			return [];
		}

		if (!this.indexed) {
			return [];
		}

		const items = includeDirs ? this.searchItemsWithDirs : this.searchItemsFilesOnly;

		// Empty query - return first N items
		if (!query) {
			return items.slice(0, limit).map((item) => ({
				path: item.path,
				isDirectory: item.isDirectory,
				score: 0,
			}));
		}

		// Fuzzy search
		const results = fuzzysort.go(query, items, {
			key: "path",
			limit,
			threshold: 0.2,
		});

		return results.map((r) => ({
			path: r.obj.path,
			isDirectory: r.obj.isDirectory,
			score: r.score,
		}));
	}

	/**
	 * Get the total number of indexed files.
	 */
	get fileCount(): number {
		return this.files.length;
	}

	/**
	 * Check if indexing is in progress.
	 */
	get isIndexing(): boolean {
		return this.indexing;
	}

	/**
	 * Check if index is ready.
	 */
	get isReady(): boolean {
		return this.indexed;
	}
}
