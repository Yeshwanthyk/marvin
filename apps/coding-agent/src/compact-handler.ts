import type { Agent, AppMessage } from '@marvin-agents/agent-core';
import { completeSimple, type Message, type TextContent } from '@marvin-agents/ai';
import type { CodexTransport } from '@marvin-agents/agent-core';

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
export function extractAllFileOps(messages: Message[]): FileOperations {
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
export function formatFileOperations(fileOps: FileOperations): string {
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

export const SUMMARY_PREFIX = `The conversation history before this point was compacted into the following summary:

<summary>
`;

export const SUMMARY_SUFFIX = `
</summary>`;

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

export interface CompactResult {
  summary: string;
  summaryMessage: AppMessage;
  fileOps: FileOperations;
}

export interface CompactOptions {
  agent: Agent;
  currentProvider: string;
  getApiKey: (provider: string) => string | undefined;
  codexTransport: CodexTransport;
  customInstructions?: string;
}

export async function handleCompact(opts: CompactOptions): Promise<CompactResult> {
  const { agent, currentProvider, getApiKey, codexTransport, customInstructions } = opts;
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

  // Generate summary - Codex needs model overrides + instructions (like normal agent turns)
  const isCodex = currentProvider === 'codex' || model.provider === 'codex';

  const direct = isCodex ? await codexTransport.getDirectCallConfig(model) : null;
  const callModel = direct?.model ?? model;

  const response = await completeSimple(
    callModel,
    { messages: summarizationMessages },
    {
      maxTokens: 8192,
      apiKey: direct?.apiKey ?? getApiKey(callModel.provider),
      fetch: direct?.fetch,
      instructions: direct?.instructions,
    },
  );

  if (response.errorMessage) {
    throw new Error(response.errorMessage);
  }

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
