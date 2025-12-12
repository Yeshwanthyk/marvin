import { describe, it, expect } from "bun:test";
import { summarizeText } from "../src/core/truncation";

describe("@mu-agents/tools truncation", () => {
  it("summarizeText truncates by bytes and indicates truncation", () => {
    const input = "a".repeat(200);
    const summary = summarizeText(input, { maxBytes: 20, maxLines: 1000 });
    expect(summary.truncated).toBe(true);
    expect(summary.value.length).toBeGreaterThan(0);
  });
});

