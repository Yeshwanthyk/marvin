import { describe, expect, it } from "bun:test";
import { mkdtemp, readFile, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { createBashTool, createEditTool, createReadTool, createWriteTool } from "../src/index.js";

const createTempDir = async (prefix: string) => mkdtemp(path.join(tmpdir(), prefix));

describe("cwd-bound tools", () => {
	it("read resolves relative paths against cwd", async () => {
		const dir = await createTempDir("read-tool-");
		try {
			const filePath = path.join(dir, "note.txt");
			await writeFile(filePath, "hello read", "utf8");

			const tool = createReadTool(dir);
			const result = await tool.execute("test", { path: "note.txt" });
			expect(result.content[0]?.type).toBe("text");
			if (result.content[0]?.type === "text") {
				expect(result.content[0].text).toContain("hello read");
			}
		} finally {
			await rm(dir, { recursive: true, force: true });
		}
	});

	it("write resolves relative paths against cwd", async () => {
		const dir = await createTempDir("write-tool-");
		try {
			const tool = createWriteTool(dir);
			await tool.execute("test", { path: "out.txt", content: "hello write" });
			const written = await readFile(path.join(dir, "out.txt"), "utf8");
			expect(written).toBe("hello write");
		} finally {
			await rm(dir, { recursive: true, force: true });
		}
	});

	it("edit resolves relative paths against cwd", async () => {
		const dir = await createTempDir("edit-tool-");
		try {
			const filePath = path.join(dir, "edit.txt");
			await writeFile(filePath, "before change", "utf8");

			const tool = createEditTool(dir);
			await tool.execute("test", { path: "edit.txt", oldText: "before", newText: "after" });
			const updated = await readFile(filePath, "utf8");
			expect(updated).toBe("after change");
		} finally {
			await rm(dir, { recursive: true, force: true });
		}
	});

	it("bash executes commands in the bound cwd", async () => {
		const dir = await createTempDir("bash-tool-");
		try {
			const tool = createBashTool(dir);
			const result = await tool.execute("test", { command: "pwd" });
			expect(result.content[0]?.type).toBe("text");
			if (result.content[0]?.type === "text") {
				const expected = await realpath(dir);
				expect(result.content[0].text.trim()).toBe(expected);
			}
		} finally {
			await rm(dir, { recursive: true, force: true });
		}
	});
});
