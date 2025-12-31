# Structured Compaction Implementation Plan

## Plan Metadata
- Created: 2024-12-31
- Status: draft
- Assumptions:
  - File tracking only needs read/write/edit tools (base-tools)
  - Summary length cap not needed initially (can add later if output tokens become issue)
  - Session metadata changes are backward-compatible (missing fields = first compaction)

## Progress Tracking
- [x] Phase 1: Structured Format + File Tracking
- [x] Phase 2: Iterative Summary Updates

## Overview

Implement "structured compaction" inspired by PriMono:
1. **Structured format** - strict Done/Todo/Progress sections that survive multiple compactions
2. **Programmatic file tracking** - extract paths from tool calls, don't rely on LLM memory
3. **Iterative updates** - pass previous summary to next compaction, merge instead of replace

## Current State

**compact-handler.ts** (lines 13-24):
```typescript
const SUMMARIZATION_PROMPT = `You are performing a CONTEXT CHECKPOINT COMPACTION. Create a handoff summary...
Include:
- Current progress and key decisions made
- Important context, constraints, or user preferences
- Absolute file paths of any relevant files that were read or modified
...`;
```

**Problems:**
- Freeform format - hard for LLM to update specific sections
- No file tracking - relies on LLM to remember paths
- No previous summary - each compaction starts fresh

**session-manager.ts** (SessionMetadata, lines 11-19):
```typescript
export interface SessionMetadata {
  type: 'session';
  id: string;
  timestamp: number;
  cwd: string;
  provider: string;
  modelId: string;
  thinkingLevel: ThinkingLevel;
}
```
No storage for compaction state.

**Message structure** (packages/ai/src/types.ts:98-102):
```typescript
export interface ToolCall {
  type: "toolCall";
  id: string;
  name: string;
  arguments: Record<string, any>;  // Contains { path: string } for read/write/edit
}
```

## Desired End State

1. Compaction produces structured summary with consistent sections
2. File operations tracked programmatically and appended as XML tags
3. Subsequent compactions receive previous summary and merge updates
4. File operations accumulate across compactions (union)

### Verification
```bash
bun run typecheck          # Zero errors
bun test apps/coding-agent  # Tests pass
```

**Manual verification:**
1. Run `/compact` - should produce structured summary with sections
2. Do more work, run `/compact` again - should see "Done" items preserved, "In Progress" updated
3. File paths should appear in `<modified-files>` tags even if LLM forgets to mention them

## Out of Scope
- Keeping recent messages (Phase 3 from analysis)
- Token-based cut point detection
- Turn splitting
- Auto-compaction threshold tuning

## Breaking Changes
None - existing sessions still work (missing fields treated as first compaction)

---

## Phase 1: Structured Format + File Tracking

### Overview
Replace freeform prompt with structured format. Add programmatic file tracking.

### Prerequisites
- [ ] None

### Change Checklist
- [x] Add FileOperations interface and extraction function
- [x] Update SUMMARIZATION_PROMPT to structured format
- [x] Extract file ops from messages in handleCompact
- [x] Append file lists as XML to summary

### Changes

#### 1. Add File Operations Types and Extraction
**File**: `apps/coding-agent/src/compact-handler.ts`
**Location**: After line 4 (after imports)

**Add**:
```typescript
/**
 * Tracks file operations across messages for deterministic file list generation.
 */
export interface FileOperations {
  read: Set<string>;
  written: Set<string>;
  edited: Set<string>;
}

/**
 * Extract file operations from a single message's tool calls.
 */
function extractFileOpsFromMessage(message: Message, fileOps: FileOperations): void {
  if (message.role !== 'assistant') return;
  
  for (const block of message.content) {
    if (block.type !== 'toolCall') continue;
    
    const path = block.arguments?.path;
    if (typeof path !== 'string') continue;
    
    switch (block.name) {
      case 'read':
        fileOps.read.add(path);
        break;
      case 'write':
        fileOps.written.add(path);
        break;
      case 'edit':
        fileOps.edited.add(path);
        break;
    }
  }
}

/**
 * Extract file operations from all messages.
 */
function extractAllFileOps(messages: Message[]): FileOperations {
  const fileOps: FileOperations = {
    read: new Set(),
    written: new Set(),
    edited: new Set(),
  };
  
  for (const msg of messages) {
    extractFileOpsFromMessage(msg, fileOps);
  }
  
  return fileOps;
}

/**
 * Format file operations as XML tags for appending to summary.
 * Modified files = edited ∪ written
 * Read files = read - modified (files only read, not modified)
 */
function formatFileOperations(fileOps: FileOperations): string {
  const modified = new Set([...fileOps.edited, ...fileOps.written]);
  const readOnly = [...fileOps.read].filter(f => !modified.has(f)).sort();
  const modifiedList = [...modified].sort();
  
  let result = '';
  
  if (readOnly.length > 0) {
    result += `\n\n<read-files>\n${readOnly.join('\n')}\n</read-files>`;
  }
  
  if (modifiedList.length > 0) {
    result += `\n\n<modified-files>\n${modifiedList.join('\n')}\n</modified-files>`;
  }
  
  return result;
}
```

**Why**: Programmatic file tracking survives compaction even if LLM forgets to mention files.

#### 2. Update Summarization Prompt to Structured Format
**File**: `apps/coding-agent/src/compact-handler.ts`
**Location**: lines 13-24

**Before**:
```typescript
const SUMMARIZATION_PROMPT = `You are performing a CONTEXT CHECKPOINT COMPACTION. Create a handoff summary for another LLM that will resume the task.

Include:
- Current progress and key decisions made
- Important context, constraints, or user preferences
- Absolute file paths of any relevant files that were read or modified
- What remains to be done (clear next steps)
- Any critical data, examples, or references needed to continue

Be concise, structured, and focused on helping the next LLM seamlessly continue the work.`;
```

**After**:
```typescript
const SUMMARIZATION_PROMPT = `You are performing a CONTEXT CHECKPOINT COMPACTION. Create a handoff summary for another LLM.

Use this EXACT format:

## Goal
[What is the user trying to accomplish? Can be multiple items if the session covers different tasks.]

## Constraints & Preferences
- [Any constraints, preferences, or requirements mentioned by user]
- [Or "(none)" if none were mentioned]

## Progress
### Done
- [x] [Completed task with relevant file paths]

### In Progress
- [ ] [Current work being done]

### Blocked
- [Issues preventing progress, if any, or "(none)"]

## Key Decisions
- **[Decision]**: [Brief rationale]
- [Or "(none)" if no significant decisions]

## Next Steps
1. [Immediate next action]
2. [Following actions in order]

## Critical Context
- [Data, examples, error messages, or references needed to continue]
- [Or "(none)" if not applicable]

IMPORTANT:
- Be concise but preserve ALL important details
- Include exact file paths, function names, error messages
- Preserve any code snippets or data the next LLM will need`;
```

**Why**: Structured format with explicit sections survives multiple compactions better.

#### 3. Update CompactResult Interface
**File**: `apps/coding-agent/src/compact-handler.ts`
**Location**: lines 26-29

**Before**:
```typescript
export interface CompactResult {
  summary: string;
  summaryMessage: AppMessage;
}
```

**After**:
```typescript
export interface CompactResult {
  summary: string;
  summaryMessage: AppMessage;
  fileOps: FileOperations;
}
```

**Why**: Expose file operations for storage and accumulation in Phase 2.

#### 4. Integrate File Tracking into handleCompact
**File**: `apps/coding-agent/src/compact-handler.ts`
**Location**: handleCompact function (lines 37-101)

**Before** (lines 86-101):
```typescript
  const summary = response.content
    .filter((c): c is TextContent => c.type === 'text')
    .map((c) => c.text)
    .join('\n');

  if (!summary.trim()) {
    const contentTypes = response.content.map(c => c.type).join(', ');
    throw new Error(`No text in response (got: ${contentTypes || 'empty'})`);
  }

  const summaryMessage: AppMessage = {
    role: 'user',
    content: [{ type: 'text', text: SUMMARY_PREFIX + summary + SUMMARY_SUFFIX }],
    timestamp: Date.now(),
  };

  return { summary, summaryMessage };
}
```

**After**:
```typescript
  let summary = response.content
    .filter((c): c is TextContent => c.type === 'text')
    .map((c) => c.text)
    .join('\n');

  if (!summary.trim()) {
    const contentTypes = response.content.map(c => c.type).join(', ');
    throw new Error(`No text in response (got: ${contentTypes || 'empty'})`);
  }

  // Extract file operations and append to summary
  const fileOps = extractAllFileOps(messages);
  summary += formatFileOperations(fileOps);

  const summaryMessage: AppMessage = {
    role: 'user',
    content: [{ type: 'text', text: SUMMARY_PREFIX + summary + SUMMARY_SUFFIX }],
    timestamp: Date.now(),
  };

  return { summary, summaryMessage, fileOps };
}
```

**Why**: File operations extracted deterministically and appended as XML tags.

#### 5. Update Command Handler Return Value
**File**: `apps/coding-agent/src/commands.ts`
**Location**: handleCompactCmd function, line 282

**Before**:
```typescript
    const { summary, summaryMessage } = await doCompact({
```

**After**:
```typescript
    const { summary, summaryMessage, fileOps: _fileOps } = await doCompact({
```

**Why**: Destructure new field (unused in Phase 1, used in Phase 2).

### Success Criteria

**Automated**:
```bash
bun run typecheck          # Zero type errors
bun test apps/coding-agent  # Tests pass
```

**Manual**:
- [ ] `/compact` produces summary with Goal/Progress/Done/Next Steps sections
- [ ] Summary ends with `<read-files>` and/or `<modified-files>` XML tags
- [ ] Files appear in XML even if not mentioned in LLM summary text

### Rollback
```bash
git restore apps/coding-agent/src/compact-handler.ts apps/coding-agent/src/commands.ts
```

---

## Phase 2: Iterative Summary Updates

### Overview
Pass previous summary to next compaction. Merge instead of starting fresh.

### Prerequisites
- [ ] Phase 1 complete and verified

### Change Checklist
- [x] Extend SessionMetadata with compaction state
- [x] Add UPDATE_PROMPT for iterative compaction
- [x] Modify handleCompact to accept previous summary
- [x] Modify handleCompact to merge file operations
- [x] Update command handler to pass/store compaction state
- [x] Handle session resume with compaction state

### Changes

#### 1. Extend Session Metadata
**File**: `apps/coding-agent/src/session-manager.ts`
**Location**: After line 19 (after SessionMetadata interface)

**Add**:
```typescript
/**
 * Compaction state stored in session for iterative updates.
 */
export interface CompactionState {
  lastSummary: string;
  readFiles: string[];
  modifiedFiles: string[];
}
```

**Update SessionMetadata** (lines 11-19):

**Before**:
```typescript
export interface SessionMetadata {
  type: 'session';
  id: string;
  timestamp: number;
  cwd: string;
  provider: string;
  modelId: string;
  thinkingLevel: ThinkingLevel;
}
```

**After**:
```typescript
export interface SessionMetadata {
  type: 'session';
  id: string;
  timestamp: number;
  cwd: string;
  provider: string;
  modelId: string;
  thinkingLevel: ThinkingLevel;
  compaction?: CompactionState;
}
```

**Why**: Store compaction state for iterative updates across sessions.

#### 2. Add Session Methods for Compaction State
**File**: `apps/coding-agent/src/session-manager.ts`
**Location**: After continueSession method (around line 118)

**Add**:
```typescript
  /**
   * Update compaction state in current session metadata.
   * Rewrites the session file with updated metadata.
   */
  updateCompactionState(state: CompactionState): void {
    if (!this.currentSessionPath) return;
    
    try {
      const content = readFileSync(this.currentSessionPath, 'utf8');
      const lines = content.trim().split('\n');
      if (lines.length === 0) return;
      
      const metadata = JSON.parse(lines[0]!) as SessionMetadata;
      metadata.compaction = state;
      
      // Rewrite file with updated metadata
      lines[0] = JSON.stringify(metadata);
      writeFileSync(this.currentSessionPath, lines.join('\n') + '\n');
    } catch (err) {
      console.error('Failed to update compaction state:', err);
    }
  }

  /**
   * Get current compaction state from session metadata.
   */
  getCompactionState(): CompactionState | undefined {
    if (!this.currentSessionPath) return undefined;
    
    try {
      const content = readFileSync(this.currentSessionPath, 'utf8');
      const firstLine = content.split('\n')[0];
      if (!firstLine) return undefined;
      
      const metadata = JSON.parse(firstLine) as SessionMetadata;
      return metadata.compaction;
    } catch {
      return undefined;
    }
  }
```

**Why**: Allow reading/writing compaction state to session file.

#### 3. Add Update Prompt
**File**: `apps/coding-agent/src/compact-handler.ts`
**Location**: After SUMMARIZATION_PROMPT (around line 55 after Phase 1 changes)

**Add**:
```typescript
const UPDATE_SUMMARIZATION_PROMPT = `You are performing a CONTEXT CHECKPOINT COMPACTION. The previous summary is provided in <previous-summary> tags. Update it with information from the NEW messages above.

RULES:
- PRESERVE all existing information from the previous summary
- ADD new progress, decisions, and context from the new messages
- UPDATE the Progress section: move items from "In Progress" to "Done" when completed
- UPDATE "Next Steps" based on what was accomplished
- PRESERVE exact file paths, function names, and error messages
- If something is no longer relevant, you may remove it
- Keep the same structured format

Use this EXACT format:

## Goal
[What is the user trying to accomplish? Can be multiple items if the session covers different tasks.]

## Constraints & Preferences
- [Any constraints, preferences, or requirements mentioned by user]
- [Or "(none)" if none were mentioned]

## Progress
### Done
- [x] [Completed task with relevant file paths]

### In Progress
- [ ] [Current work being done]

### Blocked
- [Issues preventing progress, if any, or "(none)"]

## Key Decisions
- **[Decision]**: [Brief rationale]
- [Or "(none)" if no significant decisions]

## Next Steps
1. [Immediate next action]
2. [Following actions in order]

## Critical Context
- [Data, examples, error messages, or references needed to continue]
- [Or "(none)" if not applicable]`;
```

**Why**: Different prompt for iterative updates that instructs LLM to merge with previous.

#### 4. Update CompactOptions Interface
**File**: `apps/coding-agent/src/compact-handler.ts`
**Location**: CompactOptions interface (around line 60 after Phase 1)

**Before**:
```typescript
export interface CompactOptions {
  agent: Agent;
  currentProvider: string;
  getApiKey: (provider: string) => string | undefined;
  codexTransport: CodexTransport;
  customInstructions?: string;
}
```

**After**:
```typescript
export interface CompactOptions {
  agent: Agent;
  currentProvider: string;
  getApiKey: (provider: string) => string | undefined;
  codexTransport: CodexTransport;
  customInstructions?: string;
  previousSummary?: string;
  previousFileOps?: { readFiles: string[]; modifiedFiles: string[] };
}
```

**Why**: Accept previous compaction state for iterative updates.

#### 5. Update handleCompact to Use Previous Summary
**File**: `apps/coding-agent/src/compact-handler.ts`
**Location**: handleCompact function

**Before** (building prompt, around line 78):
```typescript
  const prompt = customInstructions
    ? `${SUMMARIZATION_PROMPT}\n\nAdditional focus: ${customInstructions}`
    : SUMMARIZATION_PROMPT;
```

**After**:
```typescript
  // Choose prompt based on whether we have a previous summary
  let basePrompt: string;
  if (previousSummary) {
    basePrompt = `${UPDATE_SUMMARIZATION_PROMPT}\n\n<previous-summary>\n${previousSummary}\n</previous-summary>`;
  } else {
    basePrompt = SUMMARIZATION_PROMPT;
  }
  
  const prompt = customInstructions
    ? `${basePrompt}\n\nAdditional focus: ${customInstructions}`
    : basePrompt;
```

**Why**: Use update prompt with previous summary when available.

#### 6. Update File Operations Merging
**File**: `apps/coding-agent/src/compact-handler.ts`
**Location**: In handleCompact, after extracting file ops (end of function)

**Before** (end of handleCompact):
```typescript
  // Extract file operations and append to summary
  const fileOps = extractAllFileOps(messages);
  summary += formatFileOperations(fileOps);
```

**After**:
```typescript
  // Extract file operations from current messages
  const fileOps = extractAllFileOps(messages);
  
  // Merge with previous file operations (union)
  if (previousFileOps) {
    for (const path of previousFileOps.readFiles) {
      fileOps.read.add(path);
    }
    for (const path of previousFileOps.modifiedFiles) {
      // Previous modified files go into written (they were modified at some point)
      fileOps.written.add(path);
    }
  }
  
  summary += formatFileOperations(fileOps);
```

**Why**: Accumulate file operations across multiple compactions.

#### 7. Update Command Handler to Pass/Store Compaction State
**File**: `apps/coding-agent/src/commands.ts`
**Location**: handleCompactCmd function

**Before** (around line 280-310):
```typescript
  try {
    const { summary, summaryMessage, fileOps: _fileOps } = await doCompact({
      agent: ctx.agent,
      currentProvider: ctx.currentProvider,
      getApiKey: ctx.getApiKey,
      codexTransport: ctx.codexTransport,
      customInstructions,
    })

    // Reset agent and add summary message
    ctx.agent.reset()
    ctx.agent.replaceMessages([summaryMessage])

    // Start a new session containing the compacted context, so resume works as expected.
    ctx.sessionManager.startSession(ctx.currentProvider, ctx.currentModelId, ctx.currentThinking)
    ctx.sessionManager.appendMessage(summaryMessage)
```

**After**:
```typescript
  try {
    // Get previous compaction state for iterative update
    const prevState = ctx.sessionManager.getCompactionState();
    
    const { summary, summaryMessage, fileOps } = await doCompact({
      agent: ctx.agent,
      currentProvider: ctx.currentProvider,
      getApiKey: ctx.getApiKey,
      codexTransport: ctx.codexTransport,
      customInstructions,
      previousSummary: prevState?.lastSummary,
      previousFileOps: prevState ? { 
        readFiles: prevState.readFiles, 
        modifiedFiles: prevState.modifiedFiles 
      } : undefined,
    })

    // Reset agent and add summary message
    ctx.agent.reset()
    ctx.agent.replaceMessages([summaryMessage])

    // Start a new session containing the compacted context, so resume works as expected.
    ctx.sessionManager.startSession(ctx.currentProvider, ctx.currentModelId, ctx.currentThinking)
    ctx.sessionManager.appendMessage(summaryMessage)
    
    // Store compaction state for next iteration
    const modified = new Set([...fileOps.edited, ...fileOps.written]);
    const readOnly = [...fileOps.read].filter(f => !modified.has(f));
    ctx.sessionManager.updateCompactionState({
      lastSummary: summary,
      readFiles: readOnly.sort(),
      modifiedFiles: [...modified].sort(),
    })
```

**Why**: Read previous state, pass to compaction, store new state after.

#### 8. Add Import for CompactionState
**File**: `apps/coding-agent/src/commands.ts`
**Location**: imports at top

**Before** (line 9):
```typescript
import type { SessionManager } from "./session-manager.js"
```

**After**:
```typescript
import type { SessionManager, CompactionState } from "./session-manager.js"
```

**Why**: Need type for compaction state (actually not needed since we use the methods, can skip this).

Actually, let me reconsider - we don't need to import CompactionState since we're using the session manager methods. Skip this change.

### Success Criteria

**Automated**:
```bash
bun run typecheck          # Zero type errors
bun test apps/coding-agent  # Tests pass
```

**Manual**:
- [ ] First `/compact` produces structured summary
- [ ] Do more work (read/edit files), run `/compact` again
- [ ] Second summary shows previous "Done" items preserved
- [ ] File lists accumulate (previous files still appear)
- [ ] "In Progress" items from first compact appear in "Done" if completed

### Rollback
```bash
git restore apps/coding-agent/src/compact-handler.ts apps/coding-agent/src/commands.ts apps/coding-agent/src/session-manager.ts
```

---

## Testing Strategy

### Manual Testing Checklist

**Phase 1:**
1. [ ] Start new session, read a file, edit another
2. [ ] Run `/compact`
3. [ ] Verify summary has structured sections (Goal, Progress, etc.)
4. [ ] Verify `<read-files>` and `<modified-files>` tags appear
5. [ ] Verify files appear even if LLM didn't mention them in prose

**Phase 2:**
1. [ ] After Phase 1 test, do more work (edit a new file)
2. [ ] Run `/compact` again
3. [ ] Verify "Done" items from first compact preserved
4. [ ] Verify new file appears in `<modified-files>`
5. [ ] Verify old files still in lists (accumulation)
6. [ ] Resume session with `/resume`, verify compaction state loads

### Unit Tests to Add (Optional Follow-up)

**File**: `apps/coding-agent/tests/compact-handler.test.ts`

```typescript
import { describe, it, expect } from 'bun:test';
import { extractAllFileOps, formatFileOperations } from '../src/compact-handler.js';

describe('file operations extraction', () => {
  it('extracts read/write/edit paths from messages', () => {
    const messages = [
      {
        role: 'assistant',
        content: [
          { type: 'toolCall', id: '1', name: 'read', arguments: { path: '/foo/bar.ts' } },
          { type: 'toolCall', id: '2', name: 'edit', arguments: { path: '/foo/baz.ts' } },
        ],
      },
    ];
    
    const ops = extractAllFileOps(messages as any);
    expect([...ops.read]).toEqual(['/foo/bar.ts']);
    expect([...ops.edited]).toEqual(['/foo/baz.ts']);
  });
  
  it('excludes modified files from read list', () => {
    const ops = {
      read: new Set(['/a.ts', '/b.ts']),
      written: new Set(['/b.ts']),
      edited: new Set(),
    };
    
    const result = formatFileOperations(ops);
    expect(result).toContain('<read-files>\n/a.ts\n</read-files>');
    expect(result).toContain('<modified-files>\n/b.ts\n</modified-files>');
  });
});
```

## Anti-Patterns to Avoid

- **Don't strip XML tags from previous summary** - they contain file lists that should be preserved
- **Don't reset file ops on each compaction** - they should accumulate (union)
- **Don't use `as` type assertions** - properly type the message content blocks

## Open Questions
- [x] Should we cap file list length? → No, defer until it becomes a problem
- [x] Should we export extractAllFileOps for testing? → Yes, will need to export

## References
- PriMono compaction: `/Users/yesh/Documents/personal/reference/pi-mono/packages/coding-agent/src/core/compaction/`
- Current implementation: `apps/coding-agent/src/compact-handler.ts`
- Session management: `apps/coding-agent/src/session-manager.ts`
