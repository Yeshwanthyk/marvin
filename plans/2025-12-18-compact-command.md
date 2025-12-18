# `/compact` Command Implementation Plan

## Overview
Add a manual `/compact` slash command to the TUI that summarizes the current conversation using the LLM and starts a fresh session with that summary as context.

## Current State
- `apps/coding-agent/src/tui-app.ts` - TUI with slash commands (`/clear`, `/model`, `/thinking`, etc.)
- `apps/coding-agent/src/session-manager.ts` - Session persistence (JSONL format)
- `packages/ai/src/stream.ts` - `completeSimple()` function for LLM calls
- Agent has `reset()` and `replaceMessages()` methods

### Key Reference (pi-mono)
- Uses LLM to generate summary with a specific prompt
- Summary injected as a user message with `<summary>` tags
- Session restarted with summary as first message

## Desired End State
- `/compact` command available in autocomplete
- `/compact [custom instructions]` generates summary and restarts session
- Summary displayed in chat before new session starts
- Footer stats reset

**Verification:**
```bash
# Type /compact in TUI, autocomplete shows it
# After execution: new session with summary as context
# Footer shows reset token counts
```

## Out of Scope
- Auto-compaction (threshold-based)
- Compaction entry in session file (just starting fresh session)
- Token counting / cut-point logic (summarize entire conversation)
- Abort handling during compaction (keep simple)

---

## Phase 1: Add Compact Slash Command

### Overview
Add `/compact` to autocomplete and handle the command in the submit handler.

### Changes

#### 1. Add slash command to autocomplete ✅
**File**: `apps/coding-agent/src/tui-app.ts`
**Lines**: 715-720 (within autocomplete commands array)

**Before**:
```typescript
  const autocomplete = new CombinedAutocompleteProvider(
    [
      { name: 'clear', description: 'Clear chat + reset agent' },
      { name: 'abort', description: 'Abort in-flight request' },
      { name: 'exit', description: 'Exit' },
```

**After**:
```typescript
  const autocomplete = new CombinedAutocompleteProvider(
    [
      { name: 'clear', description: 'Clear chat + reset agent' },
      { name: 'compact', description: 'Compact context into summary + start fresh' },
      { name: 'abort', description: 'Abort in-flight request' },
      { name: 'exit', description: 'Exit' },
```

#### 2. Add imports for LLM completion ✅
**File**: `apps/coding-agent/src/tui-app.ts`
**Lines**: 2 (after existing imports)

**Add imports** (after line 2):
```typescript
import { getApiKey, getModels, getProviders, completeSimple, type AssistantMessage, type Message, type TextContent, type ThinkingContent, type ToolResultMessage } from '@marvins/ai';
```

**Remove/modify** existing import:
```typescript
// Change this line:
import { getApiKey, getModels, getProviders, type AssistantMessage, type Message, type TextContent, type ThinkingContent, type ToolResultMessage } from '@marvins/ai';
```

#### 3. Add compact command handler ✅
**File**: `apps/coding-agent/src/tui-app.ts`
**Lines**: 1192 (after `/model` handler ends at line 1191, before "Normal prompt" comment at line 1193)

**Add**:
```typescript
    if (line === '/compact' || line.startsWith('/compact ')) {
      if (isResponding) {
        addMessage(new Text(chalk.hex(colors.dimmed)('Cannot compact while responding. Use /abort first.')));
        editor.setText('');
        tui.requestRender();
        return;
      }

      const messages = agent.state.messages;
      if (messages.length < 2) {
        addMessage(new Text(chalk.hex(colors.dimmed)('Nothing to compact (need at least one exchange)')));
        editor.setText('');
        tui.requestRender();
        return;
      }

      const customInstructions = line.startsWith('/compact ') ? line.slice(9).trim() : undefined;
      
      editor.setText('');
      
      // Show compacting status
      loader = new Loader(tui, (s) => chalk.hex(colors.accent)(s), (s) => chalk.hex(colors.dimmed)(s), 'Compacting context...');
      addMessage(loader);
      tui.requestRender();

      void handleCompact(customInstructions).catch((err) => {
        removeLoader();
        addMessage(new Text(chalk.hex(colors.accent)(`Compact failed: ${err instanceof Error ? err.message : String(err)}`)));
        tui.requestRender();
      });
      return;
    }
```

#### 4. Add handleCompact function ✅
**File**: `apps/coding-agent/src/tui-app.ts`
**Lines**: 865 (after `rerenderToolBlocks` function, before `focusProxy` at line 866)

**Add**:
```typescript
  const SUMMARY_PREFIX = `The conversation history before this point was compacted into the following summary:

<summary>
`;
  const SUMMARY_SUFFIX = `
</summary>`;

  const SUMMARIZATION_PROMPT = `You are performing a CONTEXT CHECKPOINT COMPACTION. Create a handoff summary for another LLM that will resume the task.

Include:
- Current progress and key decisions made
- Important context, constraints, or user preferences
- Absolute file paths of any relevant files that were read or modified
- What remains to be done (clear next steps)
- Any critical data, examples, or references needed to continue

Be concise, structured, and focused on helping the next LLM seamlessly continue the work.`;

  const handleCompact = async (customInstructions?: string) => {
    const model = agent.state.model;
    if (!model) {
      throw new Error('No model configured');
    }

    // Build messages for summarization (filter to LLM-compatible roles)
    const messages = agent.state.messages.filter(
      (m) => m.role === 'user' || m.role === 'assistant' || m.role === 'toolResult'
    ) as Message[];

    const prompt = customInstructions
      ? `${SUMMARIZATION_PROMPT}\n\nAdditional focus: ${customInstructions}`
      : SUMMARIZATION_PROMPT;

    const summarizationMessages: Message[] = [
      ...messages,
      {
        role: 'user',
        content: [{ type: 'text', text: prompt }],
        timestamp: Date.now(),
      },
    ];

    // Generate summary
    const response = await completeSimple(model, { messages: summarizationMessages }, { maxTokens: 8192 });

    const summary = response.content
      .filter((c): c is TextContent => c.type === 'text')
      .map((c) => c.text)
      .join('\n');

    if (!summary.trim()) {
      throw new Error('Failed to generate summary');
    }

    removeLoader();

    // Show summary in chat
    addMessage(new Text(chalk.hex(colors.dimmed)('─'.repeat(40))));
    addMessage(new Text(chalk.hex(colors.dimmed)('Context compacted. Summary:')));
    addMessage(new Markdown(summary, 1, 1, markdownTheme));
    addMessage(new Text(chalk.hex(colors.dimmed)('─'.repeat(40))));

    // Create summary message for new context
    const summaryMessage: import('@marvins/agent-core').AppMessage = {
      role: 'user',
      content: [{ type: 'text', text: SUMMARY_PREFIX + summary + SUMMARY_SUFFIX }],
      timestamp: Date.now(),
    };

    // Reset agent and start fresh with summary
    agent.reset();
    agent.replaceMessages([summaryMessage]);

    // Reset footer stats
    footer.reset();
    footer.setQueueCount(0);
    queuedMessages.length = 0;

    // Start new session
    sessionStarted = false;
    ensureSession();
    sessionManager.appendMessage(summaryMessage);

    addMessage(new Text(chalk.hex(colors.dimmed)('New session started with compacted context')));
    tui.requestRender();
  };
```

### Success Criteria

**Automated**:
```bash
cd /Users/yesh/Documents/personal/marvin
bun run build          # No build errors
bun run typecheck      # Zero type errors (if available)
```

**Manual**:
1. Start TUI: `bun run dev` (or however it's run)
2. Type `/com` - autocomplete should show `/compact`
3. Have a conversation (at least one exchange)
4. Type `/compact` - should show "Compacting context..." then summary
5. Footer token counts should reset to 0
6. New messages should work normally after compact

### Rollback
```bash
git checkout HEAD -- apps/coding-agent/src/tui-app.ts
```

---

## Testing Strategy

### Manual Testing Checklist
1. [ ] `/compact` appears in autocomplete when typing `/com`
2. [ ] `/compact` with no messages shows "Nothing to compact"
3. [ ] `/compact` while responding shows "Cannot compact while responding"
4. [ ] `/compact` generates summary and displays it
5. [ ] `/compact custom focus on X` includes custom instructions in summary
6. [ ] After compact, footer shows reset stats
7. [ ] After compact, new conversation works normally
8. [ ] Session file shows new session started after compact

## Anti-Patterns to Avoid
- Don't use `complete()` directly - use `completeSimple()` which handles reasoning options
- Don't forget to filter messages to LLM-compatible roles before sending

## Open Questions
- [x] Should summary be saved to session file? → No, just start fresh session (keep simple)
- [x] Should we show token count before/after? → No (keep simple, no token estimation)

## References
- Reference impl: `/Users/yesh/Documents/personal/reference/pi-mono/packages/coding-agent/src/core/compaction.ts:274-320`
- TUI slash commands: `/Users/yesh/Documents/personal/reference/pi-mono/packages/coding-agent/src/modes/interactive/interactive-mode.ts:645-656`
