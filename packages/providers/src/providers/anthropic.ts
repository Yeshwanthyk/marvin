import type {
  AgentProviderMetadata,
  AgentProviderResponse,
  AgentUsage,
} from '@mu-agents/types';
import { ProviderStream } from '../stream';
import type { ProviderAdapter, ProviderFactory } from '../types';
import { conversationToAnthropicMessages, buildProviderMetadata } from '../utils/conversation';
import { SseParser } from '../utils/sse';

interface AnthropicEvent {
  type: string;
  message?: {
    content?: Array<{ type: string; text?: string }>;
  };
  delta?: { text?: string };
  usage?: {
    input_tokens?: number;
    output_tokens?: number;
    cache_creation_input_tokens?: number;
    total_tokens?: number;
  };
  metadata?: AgentProviderMetadata;
  error?: { message: string };
}

export const createAnthropicAdapter: ProviderFactory = ({ fetchImplementation, getApiKey, logger }) => {
  const fetchImpl = fetchImplementation ?? fetch;
  const providerName = 'anthropic';

  const adapter: ProviderAdapter = {
    name: providerName,
    supportsModel: (model) => model.startsWith('claude-'),
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
        system: config.system?.join('\n') ?? undefined,
        messages: conversationToAnthropicMessages(conversation),
        max_tokens: config.sampling?.maxOutputTokens,
        temperature: config.sampling?.temperature,
        top_p: config.sampling?.topP,
        stream: true,
      } satisfies Record<string, unknown>;

      let response: Response | undefined;
      try {
        response = await fetchImpl('https://api.anthropic.com/v1/messages', {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            accept: 'text/event-stream',
            'x-api-key': apiKey,
            'anthropic-version': '2023-06-01',
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
        const error = new Error(
          `Anthropic request failed: ${response.status} ${response.statusText} ${errorText}`
        );
        stream.error(error);
        throw error;
      }

      const reader = response.body.getReader();
      const parser = new SseParser({
        onEvent: (payload) => {
          if (payload === '[DONE]') {
            return;
          }
          try {
            const event = JSON.parse(payload) as AnthropicEvent;
            handleEvent(event, stream, metadata ?? buildProviderMetadata(providerName, config.model));
          } catch (error) {
            stream.emit({
              type: 'warning',
              warning: `Failed to parse Anthropic event: ${String(error)}`,
            });
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
    event: AnthropicEvent,
    stream: ProviderStream,
    defaultMetadata: AgentProviderMetadata
  ) => {
    switch (event.type) {
      case 'message_start':
        if (event.message?.content) {
          for (const part of event.message.content) {
            if (part.type === 'text' && part.text) {
              stream.emit({ type: 'text-delta', text: part.text });
            }
          }
        }
        break;
      case 'message_delta':
      case 'content_block_delta':
        if (event.delta?.text) {
          stream.emit({ type: 'text-delta', text: event.delta.text });
        }
        break;
      case 'message_stop':
        stream.emit({
          type: 'response',
          response: {
            metadata: event.metadata ?? defaultMetadata,
            usage: mapAnthropicUsage(event.usage, event.metadata ?? defaultMetadata),
          },
        });
        break;
      case 'metadata':
        if (event.metadata) {
          stream.emit({ type: 'metadata', metadata: event.metadata });
        }
        break;
      case 'error':
        stream.emit({ type: 'error', error: new Error(event.error?.message ?? 'Anthropic error') });
        break;
      default:
        stream.emit({ type: 'raw', event: event.type, data: event });
    }
  };

  const mapAnthropicUsage = (
    usage: AnthropicEvent['usage'],
    metadata: AgentProviderMetadata
  ): AgentUsage | undefined => {
    if (!usage) {
      return undefined;
    }
    const promptTokens = usage.input_tokens ?? 0;
    const completionTokens = usage.output_tokens ?? 0;
    const totalTokens = usage.total_tokens ?? promptTokens + completionTokens;
    return {
      provider: metadata.provider,
      model: metadata.model,
      tokens: {
        promptTokens,
        completionTokens,
        cachedTokens: usage.cache_creation_input_tokens,
        totalTokens,
      },
    };
  };

  return adapter;
};
