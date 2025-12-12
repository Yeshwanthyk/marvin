import type {
  AgentConversation,
  AgentMessageContent,
  AgentProviderMetadata,
} from '@mu-agents/types';

export interface OpenAIContentFragment {
  type: string;
  text?: string;
  json?: unknown;
  name?: string;
  call_id?: string;
  arguments?: Record<string, unknown>;
  output?: unknown;
}

export interface OpenAIInputMessage {
  role: string;
  content: OpenAIContentFragment[];
}

const serializeContentBlock = (block: AgentMessageContent): string => {
  switch (block.type) {
    case 'text':
      return block.text;
    case 'json':
      return JSON.stringify(block.value);
    case 'tool-call':
      return `Tool ${block.toolName} called with ${JSON.stringify(block.arguments)} (callId=${block.callId ?? 'n/a'})`;
    case 'tool-result':
      return `Tool ${block.toolName} result: ${JSON.stringify(block.result)} (callId=${block.callId ?? 'n/a'})`;
    default:
      return '';
  }
};

export const conversationToAnthropicMessages = (conversation: AgentConversation) =>
  conversation.map((message) => ({
    role: message.role === 'tool' ? 'user' : message.role,
    content: message.content.map(serializeContentBlock).join('\n\n'),
  }));

const convertBlockToOpenAIContent = (block: AgentMessageContent): OpenAIContentFragment => {
  switch (block.type) {
    case 'text':
      return { type: 'text', text: block.text };
    case 'json':
      return { type: 'input_json', json: block.value };
    case 'tool-call':
      return {
        type: 'tool_call',
        name: block.toolName,
        call_id: block.callId,
        arguments: block.arguments,
      };
    case 'tool-result':
      return {
        type: 'tool_result',
        name: block.toolName,
        call_id: block.callId,
        output: block.result,
      };
    default:
      return { type: 'text', text: '' };
  }
};

export const conversationToOpenAIInput = (conversation: AgentConversation): OpenAIInputMessage[] =>
  conversation.map((message) => ({
    role: message.role,
    content: message.content.map(convertBlockToOpenAIContent),
  }));

export const buildProviderMetadata = (
  provider: string,
  model: string,
  overrides?: Partial<AgentProviderMetadata>
): AgentProviderMetadata => ({
  provider,
  model,
  mode: overrides?.mode ?? 'chat',
  transport: overrides?.transport ?? 'sse',
  labels: overrides?.labels,
  ...overrides,
});
