import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { SessionManager } from "../src/session-manager";
import { mkdtempSync, rmSync, existsSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import type { AppMessage } from "@marvin-agents/agent-core";

describe("SessionManager", () => {
  let tempDir: string;
  let manager: SessionManager;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), "mu-session-test-"));
    manager = new SessionManager(tempDir);
  });

  afterEach(() => {
    if (existsSync(tempDir)) {
      rmSync(tempDir, { recursive: true });
    }
  });

  it("starts a session and creates file", () => {
    const id = manager.startSession("anthropic", "claude-sonnet-4-20250514", "off");
    expect(id).toBeTruthy();
    expect(manager.sessionId).toBe(id);
    expect(manager.sessionPath).toBeTruthy();
    expect(existsSync(manager.sessionPath!)).toBe(true);
  });

  it("appends messages to session", () => {
    manager.startSession("anthropic", "claude-sonnet-4-20250514", "off");
    
    const userMsg: AppMessage = {
      role: "user",
      content: [{ type: "text", text: "hello" }],
      timestamp: Date.now(),
    };
    
    const assistantMsg: AppMessage = {
      role: "assistant",
      content: [{ type: "text", text: "hi there" }],
      api: "messages",
      provider: "anthropic",
      model: "claude-sonnet-4-20250514",
      usage: { input: 10, output: 5, cacheRead: 0, cacheWrite: 0, totalTokens: 15, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } },
      stopReason: "end",
      timestamp: Date.now(),
    };
    
    manager.appendMessage(userMsg);
    manager.appendMessage(assistantMsg);
    
    // Load and verify
    const loaded = manager.loadSession(manager.sessionPath!);
    expect(loaded).toBeTruthy();
    expect(loaded!.messages.length).toBe(2);
    expect(loaded!.messages[0]!.role).toBe("user");
    expect(loaded!.messages[1]!.role).toBe("assistant");
  });

  it("lists sessions sorted by timestamp desc", () => {
    // Create two sessions
    manager.startSession("anthropic", "claude-sonnet-4-20250514", "off");
    const firstId = manager.sessionId;
    
    // Wait a bit so timestamps differ
    const userMsg: AppMessage = {
      role: "user",
      content: [{ type: "text", text: "test" }],
      timestamp: Date.now(),
    };
    manager.appendMessage(userMsg);
    
    // Create another manager instance for a new session
    const manager2 = new SessionManager(tempDir);
    manager2.startSession("openai", "gpt-4o", "high");
    const secondId = manager2.sessionId;
    
    const sessions = manager.listSessions();
    expect(sessions.length).toBe(2);
    // Most recent first
    expect(sessions[0]!.id).toBe(secondId);
    expect(sessions[1]!.id).toBe(firstId);
  });

  it("loadLatest returns most recent session", () => {
    manager.startSession("anthropic", "claude-sonnet-4-20250514", "medium");
    const userMsg: AppMessage = {
      role: "user",
      content: [{ type: "text", text: "test" }],
      timestamp: Date.now(),
    };
    manager.appendMessage(userMsg);
    
    const loaded = manager.loadLatest();
    expect(loaded).toBeTruthy();
    expect(loaded!.metadata.provider).toBe("anthropic");
    expect(loaded!.metadata.thinkingLevel).toBe("medium");
    expect(loaded!.messages.length).toBe(1);
  });

  it("returns null when no sessions exist", () => {
    expect(manager.loadLatest()).toBe(null);
    expect(manager.listSessions().length).toBe(0);
  });
});
