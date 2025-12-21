import { spawn } from "child_process";
import fuzzysort from "fuzzysort";
import { dirname } from "path";

export interface FileIndexOptions {
	cwd: string;
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

	async refresh(): Promise<void> {
		if (this.indexing) {
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
					resolve();
				});
			});

			this.files = files;
			this.searchItemsFilesOnly = files.map((f) => ({ path: f, isDirectory: false }));
			this.searchItemsWithDirs = [
				...this.searchItemsFilesOnly,
				...Array.from(dirs, (dir) => ({ path: dir + "/", isDirectory: true })),
			];
			this.indexed = true;
		} finally {
			this.indexing = false;
			for (const cb of this.pendingCallbacks) {
				cb();
			}
			this.pendingCallbacks = [];
		}
	}

	search(query: string, options?: { limit?: number; includeDirs?: boolean }): FileSearchResult[] {
		const limit = options?.limit ?? 20;
		const includeDirs = options?.includeDirs ?? true;

		if (!this.indexed && !this.indexing) {
			this.refresh();
			return [];
		}

		if (!this.indexed) {
			return [];
		}

		const items = includeDirs ? this.searchItemsWithDirs : this.searchItemsFilesOnly;

		if (!query) {
			return items.slice(0, limit).map((item) => ({
				path: item.path,
				isDirectory: item.isDirectory,
				score: 0,
			}));
		}

		const results = fuzzysort.go(query, items, {
			key: "path",
			limit,
			threshold: 0.2,
		});

		return results
			.filter((r) => r.obj?.path != null)
			.map((r) => ({
				path: r.obj.path,
				isDirectory: r.obj.isDirectory,
				score: r.score,
			}));
	}

	get fileCount(): number {
		return this.files.length;
	}

	get isIndexing(): boolean {
		return this.indexing;
	}

	get isReady(): boolean {
		return this.indexed;
	}
}
