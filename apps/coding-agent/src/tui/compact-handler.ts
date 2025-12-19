import type { Agent, AppMessage } from '@marvin-agents/agent-core';
import { completeSimple, type Message, type TextContent } from '@marvin-agents/ai';
import type { CodexTransport } from '@marvin-agents/agent-core';

export const SUMMARY_PREFIX = `The conversation history before this point was compacted into the following summary:

<summary>
`;

export const SUMMARY_SUFFIX = `
</summary>`;

const SUMMARIZATION_PROMPT = `You are performing a CONTEXT CHECKPOINT COMPACTION. Create a handoff summary for another LLM that will resume the task.

Include:
- Current progress and key decisions made
- Important context, constraints, or user preferences
- Absolute file paths of any relevant files that were read or modified
- What remains to be done (clear next steps)
- Any critical data, examples, or references needed to continue

Be concise, structured, and focused on helping the next LLM seamlessly continue the work.`;

export interface CompactResult {
  summary: string;
  summaryMessage: AppMessage;
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

  // Generate summary - use codex fetch for OAuth, regular API key otherwise
  const isCodex = currentProvider === 'codex';
  const response = await completeSimple(
    model,
    { messages: summarizationMessages },
    {
      maxTokens: 8192,
      apiKey: isCodex ? 'codex-oauth' : getApiKey(currentProvider),
      fetch: isCodex ? codexTransport.getFetch() : undefined,
    },
  );

  if (response.errorMessage) {
    throw new Error(response.errorMessage);
  }

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
