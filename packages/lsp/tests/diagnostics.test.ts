import { describe, expect, test } from "bun:test"
import { summarizeDiagnostics, prettyDiagnostic } from "../src/diagnostics.js"
import type { Diagnostic } from "vscode-languageserver-types"

const makeDiag = (severity: number, line: number, message: string): Diagnostic => ({
  severity,
  range: { start: { line, character: 0 }, end: { line, character: 10 } },
  message,
})

describe("prettyDiagnostic", () => {
  test("formats ERROR diagnostic", () => {
    const d = makeDiag(1, 5, "Type error")
    expect(prettyDiagnostic(d)).toBe("ERROR [6:1] Type error")
  })

  test("formats WARN diagnostic", () => {
    const d = makeDiag(2, 10, "Unused variable")
    expect(prettyDiagnostic(d)).toBe("WARN [11:1] Unused variable")
  })

  test("formats INFO diagnostic", () => {
    const d = makeDiag(3, 0, "Hint message")
    expect(prettyDiagnostic(d)).toBe("INFO [1:1] Hint message")
  })

  test("formats HINT diagnostic", () => {
    const d = makeDiag(4, 2, "Suggestion")
    expect(prettyDiagnostic(d)).toBe("HINT [3:1] Suggestion")
  })
})

describe("summarizeDiagnostics", () => {
  test("returns empty for file with no diagnostics", () => {
    const result = summarizeDiagnostics({
      diagnosticsByFile: {},
      filePath: "/test/file.ts",
    })
    expect(result.fileText).toBeUndefined()
    expect(result.projectText).toBeUndefined()
  })

  test("filters out INFO and HINT severity", () => {
    const result = summarizeDiagnostics({
      diagnosticsByFile: {
        "/test/file.ts": [
          makeDiag(3, 0, "Info message"),
          makeDiag(4, 0, "Hint message"),
        ],
      },
      filePath: "/test/file.ts",
    })
    expect(result.fileText).toBeUndefined()
  })

  test("includes ERROR and WARN diagnostics", () => {
    const result = summarizeDiagnostics({
      diagnosticsByFile: {
        "/test/file.ts": [
          makeDiag(1, 5, "Type error"),
          makeDiag(2, 10, "Unused variable"),
        ],
      },
      filePath: "/test/file.ts",
    })
    expect(result.fileText).toContain("ERROR [6:1] Type error")
    expect(result.fileText).toContain("WARN [11:1] Unused variable")
    expect(result.fileText).toContain("<file_diagnostics>")
    expect(result.fileText).toContain("</file_diagnostics>")
  })

  test("respects maxDiagnosticsPerFile cap", () => {
    const diags = Array.from({ length: 50 }, (_, i) => makeDiag(1, i, `Error ${i}`))
    const result = summarizeDiagnostics({
      diagnosticsByFile: { "/test/file.ts": diags },
      filePath: "/test/file.ts",
      caps: { maxDiagnosticsPerFile: 5, maxProjectFiles: 5, maxTotalLines: 100 },
    })
    const lines = result.fileText?.split("\n").filter((l) => l.startsWith("ERROR")) ?? []
    expect(lines.length).toBe(5)
  })

  test("includes project diagnostics for other files", () => {
    const result = summarizeDiagnostics({
      diagnosticsByFile: {
        "/test/file.ts": [makeDiag(1, 0, "Main error")],
        "/test/other.ts": [makeDiag(1, 0, "Other error")],
      },
      filePath: "/test/file.ts",
    })
    expect(result.fileText).toContain("Main error")
    expect(result.projectText).toContain("Other error")
    expect(result.projectText).toContain("<project_diagnostics>")
  })

  test("respects maxProjectFiles cap", () => {
    const diagnosticsByFile: Record<string, Diagnostic[]> = {
      "/test/main.ts": [makeDiag(1, 0, "Main error")],
    }
    for (let i = 0; i < 10; i++) {
      diagnosticsByFile[`/test/other${i}.ts`] = [makeDiag(1, 0, `Error ${i}`)]
    }
    const result = summarizeDiagnostics({
      diagnosticsByFile,
      filePath: "/test/main.ts",
      caps: { maxDiagnosticsPerFile: 20, maxProjectFiles: 3, maxTotalLines: 100 },
    })
    const matches = result.projectText?.match(/<project_diagnostics>/g) ?? []
    expect(matches.length).toBeLessThanOrEqual(3)
  })

  test("respects maxTotalLines cap across file and project", () => {
    const diagnosticsByFile: Record<string, Diagnostic[]> = {
      "/test/main.ts": Array.from({ length: 30 }, (_, i) => makeDiag(1, i, `Main ${i}`)),
      "/test/other.ts": Array.from({ length: 30 }, (_, i) => makeDiag(1, i, `Other ${i}`)),
    }
    const result = summarizeDiagnostics({
      diagnosticsByFile,
      filePath: "/test/main.ts",
      caps: { maxDiagnosticsPerFile: 50, maxProjectFiles: 5, maxTotalLines: 25 },
    })
    const fileLines = result.fileText?.split("\n").filter((l) => l.startsWith("ERROR")) ?? []
    const projectLines = result.projectText?.split("\n").filter((l) => l.startsWith("ERROR")) ?? []
    expect(fileLines.length + projectLines.length).toBeLessThanOrEqual(25)
  })

  test("sorts diagnostics by severity (ERROR before WARN)", () => {
    const result = summarizeDiagnostics({
      diagnosticsByFile: {
        "/test/file.ts": [
          makeDiag(2, 0, "Warning first"),
          makeDiag(1, 1, "Error second"),
          makeDiag(2, 2, "Warning third"),
        ],
      },
      filePath: "/test/file.ts",
    })
    const lines = result.fileText?.split("\n").filter((l) => l.startsWith("ERROR") || l.startsWith("WARN")) ?? []
    expect(lines[0]).toContain("ERROR")
    expect(lines[1]).toContain("WARN")
    expect(lines[2]).toContain("WARN")
  })
})
