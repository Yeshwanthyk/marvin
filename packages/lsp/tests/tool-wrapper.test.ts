import { describe, expect, test } from "bun:test"
import { wrapToolsWithLspDiagnostics } from "../src/tool-wrapper.js"
import type { AgentTool, AgentToolResult } from "@yeshwanthyk/ai"
import type { LspManager } from "../src/types.js"
import type { Diagnostic } from "vscode-languageserver-types"

const makeDiag = (severity: number, line: number, message: string): Diagnostic => ({
  severity,
  range: { start: { line, character: 0 }, end: { line, character: 10 } },
  message,
})

const createMockLspManager = (diagnostics: Record<string, Diagnostic[]>): LspManager => ({
  touchFile: async () => {},
  diagnostics: async () => diagnostics,
  shutdown: async () => {},
})

const createMockWriteTool = (): AgentTool<{ path: string; content: string }, { success: true }> => ({
  name: "write",
  label: "Write File",
  description: "Write content to a file",
  parameters: {} as any,
  execute: async () => ({
    content: [{ type: "text", text: "Successfully wrote file" }],
    details: { success: true as const },
  }),
})

const createMockEditTool = (): AgentTool<{ path: string; oldText: string; newText: string }, { diff: string }> => ({
  name: "edit",
  label: "Edit File",
  description: "Edit content in a file",
  parameters: {} as any,
  execute: async () => ({
    content: [{ type: "text", text: "Successfully edited file" }],
    details: { diff: "- old\n+ new" },
  }),
})

const createMockReadTool = (): AgentTool<{ path: string }, { content: string }> => ({
  name: "read",
  label: "Read File",
  description: "Read a file",
  parameters: {} as any,
  execute: async () => ({
    content: [{ type: "text", text: "file contents" }],
    details: { content: "file contents" },
  }),
})

describe("wrapToolsWithLspDiagnostics", () => {
  test("passes through non-write/edit tools unchanged", async () => {
    const readTool = createMockReadTool()
    const lsp = createMockLspManager({})
    const [wrapped] = wrapToolsWithLspDiagnostics([readTool], lsp, { cwd: "/test" })

    const result = await wrapped!.execute("call-1", { path: "/test/file.ts" }, undefined, () => {})
    expect(result.content).toHaveLength(1)
    expect(result.content[0]).toEqual({ type: "text", text: "file contents" })
  })

  test("appends diagnostics to write tool result", async () => {
    const writeTool = createMockWriteTool()
    const lsp = createMockLspManager({
      "/test/file.ts": [makeDiag(1, 5, "Type error")],
    })
    const [wrapped] = wrapToolsWithLspDiagnostics([writeTool], lsp, { cwd: "/test" })

    const result = await wrapped!.execute("call-1", { path: "file.ts" }, undefined, () => {})
    expect(result.content.length).toBeGreaterThan(1)
    const text = result.content.map((c: any) => c.text).join("")
    expect(text).toContain("<file_diagnostics>")
    expect(text).toContain("ERROR [6:1] Type error")
  })

  test("appends diagnostics to edit tool result", async () => {
    const editTool = createMockEditTool()
    const lsp = createMockLspManager({
      "/test/src/app.ts": [makeDiag(2, 10, "Unused import")],
    })
    const [wrapped] = wrapToolsWithLspDiagnostics([editTool], lsp, { cwd: "/test" })

    const result = await wrapped!.execute("call-1", { path: "src/app.ts", oldText: "a", newText: "b" }, undefined, () => {})
    expect(result.content.length).toBeGreaterThan(1)
    const text = result.content.map((c: any) => c.text).join("")
    expect(text).toContain("<file_diagnostics>")
    expect(text).toContain("WARN [11:1] Unused import")
  })

  test("preserves original tool details", async () => {
    const editTool = createMockEditTool()
    const lsp = createMockLspManager({
      "/test/file.ts": [makeDiag(1, 0, "Error")],
    })
    const [wrapped] = wrapToolsWithLspDiagnostics([editTool], lsp, { cwd: "/test" })

    const result = await wrapped!.execute("call-1", { path: "file.ts", oldText: "a", newText: "b" }, undefined, () => {})
    expect(result.details).toEqual({ diff: "- old\n+ new" })
  })

  test("returns original result when no diagnostics", async () => {
    const writeTool = createMockWriteTool()
    const lsp = createMockLspManager({})
    const [wrapped] = wrapToolsWithLspDiagnostics([writeTool], lsp, { cwd: "/test" })

    const result = await wrapped!.execute("call-1", { path: "file.ts" }, undefined, () => {})
    expect(result.content).toHaveLength(1)
    expect(result.content[0]).toEqual({ type: "text", text: "Successfully wrote file" })
  })

  test("handles LSP errors gracefully", async () => {
    const writeTool = createMockWriteTool()
    const lsp: LspManager = {
      touchFile: async () => { throw new Error("LSP crashed") },
      diagnostics: async () => { throw new Error("LSP crashed") },
      shutdown: async () => {},
    }
    const [wrapped] = wrapToolsWithLspDiagnostics([writeTool], lsp, { cwd: "/test" })

    // Should not throw, just return original result
    const result = await wrapped!.execute("call-1", { path: "file.ts" }, undefined, () => {})
    expect(result.content).toHaveLength(1)
    expect(result.content[0]).toEqual({ type: "text", text: "Successfully wrote file" })
  })

  test("wraps multiple tools correctly", async () => {
    const writeTool = createMockWriteTool()
    const editTool = createMockEditTool()
    const readTool = createMockReadTool()
    const lsp = createMockLspManager({
      "/test/file.ts": [makeDiag(1, 0, "Error")],
    })
    const wrapped = wrapToolsWithLspDiagnostics([writeTool, editTool, readTool], lsp, { cwd: "/test" })

    expect(wrapped).toHaveLength(3)
    expect(wrapped[0]!.name).toBe("write")
    expect(wrapped[1]!.name).toBe("edit")
    expect(wrapped[2]!.name).toBe("read")
  })
})
