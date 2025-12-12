import type {
  AgentProviderMetadata,
  AgentProviderResponse,
  AgentUsage,
} from '@mu-agents/types';
import { ProviderStream } from '../stream';
import type { ProviderAdapter, ProviderFactory } from '../types';
import { conversationToOpenAIInput, buildProviderMetadata } from '../utils/conversation';
import { SseParser } from '../utils/sse';

interface OpenAIToolCall {
  id?: string;
  type?: string;
  name?: string;
  call_id?: string;
  tool_name?: string;
  arguments?: string | Record<string, unknown>;
  function?: {
    name?: string;
    arguments?: string;
  };
}

interface OpenAIEvent {
  type: string;
  response?: {
    id?: string;
    output?: Array<{
      content?: Array<{
        type: string;
        text?: string;
        name?: string;
        arguments?: string | Record<string, unknown>;
        call_id?: string;
        tool_name?: string;
      }>;
      tool_calls?: OpenAIToolCall[];
    }>;
  };
  delta?: {
    content?: Array<{
      type: string;
      text?: string;
      name?: string;
      arguments?: string | Record<string, unknown>;
      call_id?: string;
      tool_name?: string;
    }>;
    tool_calls?: OpenAIToolCall[];
    function_call?: OpenAIToolCall;
  };
  metadata?: AgentProviderMetadata;
  error?: { message: string };
  usage?: {
    prompt_tokens?: number;
    completion_tokens?: number;
    input_tokens?: number;
    output_tokens?: number;
    total_tokens?: number;
    cache_creation_input_tokens?: number;
    cache_read_input_tokens?: number;
  };
}

export const createOpenAIResponsesAdapter: ProviderFactory = ({ fetchImplementation, getApiKey, logger }) => {
  const fetchImpl = fetchImplementation ?? fetch;
  const providerName = 'openai';

  const adapter: ProviderAdapter = {
    name: providerName,
    supportsModel: (model) => model.startsWith('gpt-') || model.startsWith('o'),
    async invoke({ config, conversation, signal, stream: externalStream, metadata }): Promise<{
      response: AgentProviderResponse;
      stream: ProviderStream;
    }> {
      const apiKey = await getApiKey(providerName);
      if (!apiKey) {
        throw new Error(`Missing API key for provider ${providerName}`);
      }

      const stream =
        externalStream ?? new ProviderStream({ logger, id: `${providerName}:${config.model}` });

      const requestBody = {
        model: config.model,
        input: conversationToOpenAIInput(conversation),
        max_output_tokens: config.sampling?.maxOutputTokens,
        temperature: config.sampling?.temperature,
        top_p: config.sampling?.topP,
        stream: true,
        response_format: { type: 'json_schema' },
      } satisfies Record<string, unknown>;

      let response: Response | undefined;
      try {
        response = await fetchImpl('https://api.openai.com/v1/responses', {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            accept: 'text/event-stream',
            authorization: `Bearer ${apiKey}`,
          },
          body: JSON.stringify(requestBody),
          signal,
        });
      } catch (error) {
        stream.error(error as Error);
        throw error;
      }

      if (!response.ok || !response.body) {
        const errorText = await response.text();
        const err = new Error(
          `OpenAI request failed: ${response.status} ${response.statusText} ${errorText}`
        );
        stream.error(err);
        throw err;
      }

      const reader = response.body.getReader();
      const parser = new SseParser({
        onEvent: (payload) => {
          if (payload === '[DONE]') {
            return;
          }
          try {
            const event = JSON.parse(payload) as OpenAIEvent;
            handleEvent(event, stream,
              metadata ?? buildProviderMetadata(providerName, config.model));
          } catch (error) {
            stream.emit({ type: 'warning', warning: `Failed to parse OpenAI event: ${String(error)}` });
          }
        },
        onError: (error) => stream.emit({ type: 'warning', warning: error.message }),
      });

      while (true) {
        const { done, value } = await reader.read();
        if (done) {
          break;
        }
        if (value) {
          parser.push(value);
        }
      }

      parser.finish();
      stream.close();

      const responsePayload =
        stream.getResponse() ?? {
          metadata: metadata ?? buildProviderMetadata(providerName, config.model),
        };

      return { response: responsePayload, stream };
    },
  };

  const handleEvent = (
    event: OpenAIEvent,
    stream: ProviderStream,
    defaultMetadata: AgentProviderMetadata
  ) => {
    switch (event.type) {
      case 'response.output_text.delta':
        if (event.delta?.content) {
          for (const item of event.delta.content) {
            if (item.type === 'output_text.delta' && item.text) {
              stream.emit({ type: 'text-delta', text: item.text });
            }
          }
        }
        break;
      case 'response.output_text.done':
        if (event.response?.output) {
          const text = event.response.output
            .flatMap((output) => output.content?.map((content) => content.text ?? '') ?? [])
            .join('');
          if (text) {
            stream.emit({ type: 'text-complete', text });
          }
        }
        break;
      case 'response.completed':
        stream.emit({
          type: 'response',
          response: {
            metadata: event.metadata ?? defaultMetadata,
            usage: mapUsage(event.usage, event.metadata ?? defaultMetadata),
          },
        });
        break;
      case 'response.output_tool_calls.delta':
      case 'response.function_call.delta':
      case 'response.function_call.arguments.delta':
        emitToolCallDelta(extractToolCallsFromDelta(event), stream);
        break;
      case 'response.output_tool_calls.done':
      case 'response.function_call.done':
        emitToolCallDelta(extractToolCallsFromOutput(event), stream);
        break;
      case 'response.metadata':
        if (event.metadata) {
          stream.emit({ type: 'metadata', metadata: event.metadata });
        }
        break;
      case 'response.error':
        stream.emit({ type: 'error', error: new Error(event.error?.message ?? 'OpenAI error') });
        break;
      default:
        stream.emit({ type: 'raw', event: event.type, data: event });
    }
  };

  const emitToolCallDelta = (toolCalls: OpenAIToolCall[], stream: ProviderStream) => {
    for (const call of toolCalls) {
      const toolName = call.function?.name ?? call.name ?? call.tool_name ?? 'tool-call';
      const argumentsText =
        call.function?.arguments ??
        (typeof call.arguments === 'string'
          ? call.arguments
          : call.arguments
            ? JSON.stringify(call.arguments)
            : undefined);
      stream.emit({
        type: 'tool-call-delta',
        toolName,
        callId: call.id ?? call.call_id,
        argumentsText,
      });
    }
  };

  const extractToolCallsFromDelta = (event: OpenAIEvent): OpenAIToolCall[] => {
    const calls: OpenAIToolCall[] = [];
    if (event.delta?.tool_calls?.length) {
      calls.push(...event.delta.tool_calls);
    }
    if (event.delta?.function_call) {
      calls.push(event.delta.function_call);
    }
    if (event.delta?.content) {
      for (const block of event.delta.content) {
        const converted = convertContentToToolCall(block);
        if (converted) {
          calls.push(converted);
        }
      }
    }
    return calls;
  };

  const extractToolCallsFromOutput = (event: OpenAIEvent): OpenAIToolCall[] => {
    const calls: OpenAIToolCall[] = [];
    if (!event.response?.output) {
      return calls;
    }
    for (const output of event.response.output) {
      if (output.tool_calls) {
        calls.push(...output.tool_calls);
      }
      if (output.content) {
        for (const block of output.content) {
          const converted = convertContentToToolCall(block);
          if (converted) {
            calls.push(converted);
          }
        }
      }
    }
    return calls;
  };

  const convertContentToToolCall = (
    block: { type: string; name?: string; arguments?: string | Record<string, unknown>; call_id?: string; tool_name?: string }
  ): OpenAIToolCall | undefined => {
    if (!block || block.type !== 'tool_call') {
      return undefined;
    }
    return {
      id: block.call_id,
      tool_name: block.tool_name,
      function: {
        name: block.name,
        arguments:
          typeof block.arguments === 'string'
            ? block.arguments
            : block.arguments
              ? JSON.stringify(block.arguments)
              : undefined,
      },
    };
  };

  const mapUsage = (
    usage: OpenAIEvent['usage'],
    metadata: AgentProviderMetadata
  ): AgentUsage | undefined => {
    if (!usage) {
      return undefined;
    }
    const promptTokens = usage.input_tokens ?? usage.prompt_tokens ?? 0;
    const completionTokens = usage.output_tokens ?? usage.completion_tokens ?? 0;
    const totalTokens = usage.total_tokens ?? promptTokens + completionTokens;
    const cachedTokens = usage.cache_read_input_tokens ?? usage.cache_creation_input_tokens;
    return {
      provider: metadata.provider,
      model: metadata.model,
      tokens: {
        promptTokens,
        completionTokens,
        cachedTokens,
        totalTokens,
      },
    };
  };

  return adapter;
};
