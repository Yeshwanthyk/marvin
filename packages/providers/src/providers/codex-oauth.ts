import type { AgentProviderResponse } from '@mu-agents/types';
import { ProviderStream } from '../stream';
import type { ProviderAdapter, ProviderFactory } from '../types';
import { buildProviderMetadata, conversationToOpenAIInput } from '../utils/conversation';
import type { CodexTokenStorage } from '../codex/types';
import { CodexOAuthClient, FileTokenStorage, getCodexBaseUrl, normalizeCodexModel } from '../codex';
import { SseParser } from '../utils/sse';

interface CodexResponseEvent {
  type: string;
  delta?: { text?: string };
  response?: { output?: Array<{ content?: Array<{ text?: string }> }> };
  usage?: {
    tokens?: {
      prompt_tokens?: number;
      completion_tokens?: number;
      total_tokens?: number;
    };
  };
  error?: { message: string };
}

export interface CodexProviderOptions {
  storage?: CodexTokenStorage;
  oauthClient?: CodexOAuthClient;
}

export const createCodexOAuthAdapter = (options?: CodexProviderOptions): ProviderFactory => {
  return ({ fetchImplementation, logger }) => {
    const fetchImpl = fetchImplementation ?? fetch;
    const storage = options?.storage ?? new FileTokenStorage();
    const oauthClient = options?.oauthClient ?? new CodexOAuthClient({ storage, logger });
    const providerName = 'codex';

    const adapter: ProviderAdapter = {
      name: providerName,
      supportsModel: (model) => model.includes('codex') || model.startsWith('gpt-5'),
      async invoke({ config, conversation, signal, stream: externalStream, metadata }): Promise<{
        response: AgentProviderResponse;
        stream: ProviderStream;
      }> {
        const stream =
          externalStream ?? new ProviderStream({ logger, id: `${providerName}:${config.model}` });

        const token = await oauthClient.ensureAuthenticated();
        const normalizedModel = normalizeCodexModel(config.model);
        const baseMetadata =
          metadata ??
          buildProviderMetadata(providerName, normalizedModel, {
            labels: ['oauth', providerName],
          });

        const requestBody = {
          model: normalizedModel,
          input: conversationToOpenAIInput(conversation),
          stream: true,
          temperature: config.sampling?.temperature,
          top_p: config.sampling?.topP,
          max_output_tokens: config.sampling?.maxOutputTokens,
        } satisfies Record<string, unknown>;

        const response = await fetchImpl(`${getCodexBaseUrl()}/codex/responses`, {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            accept: 'text/event-stream',
            authorization: `Bearer ${token.accessToken}`,
            'chatgpt-account-id': token.accountId,
          },
          body: JSON.stringify(requestBody),
          signal,
        });

        if (!response.ok || !response.body) {
          const errorText = await response.text();
          const err = new Error(
            `Codex request failed: ${response.status} ${response.statusText} ${errorText}`
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
              const event = JSON.parse(payload) as CodexResponseEvent;
              handleEvent(event, stream, baseMetadata);
            } catch (error) {
              stream.emit({
                type: 'warning',
                warning: `Failed to parse Codex event: ${String(error)}`,
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
            metadata: baseMetadata,
          };

        return { response: responsePayload, stream };
      },
    };

    const handleEvent = (
      event: CodexResponseEvent,
      stream: ProviderStream,
      defaultMetadata = buildProviderMetadata(providerName, 'gpt-5.1-codex', {
        labels: ['oauth', providerName],
      })
    ) => {
      switch (event.type) {
        case 'response.output_text.delta':
          if (event.delta?.text) {
            stream.emit({ type: 'text-delta', text: event.delta.text });
          }
          break;
        case 'response.output_text.done':
          if (event.response?.output) {
            const text = event.response.output
              .flatMap((output) => output.content ?? [])
              .map((item) => item.text ?? '')
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
              metadata: defaultMetadata,
              usage: event.usage
                ? {
                    model: defaultMetadata.model,
                    provider: providerName,
                    tokens: {
                      promptTokens: event.usage.tokens?.prompt_tokens ?? 0,
                      completionTokens: event.usage.tokens?.completion_tokens ?? 0,
                      totalTokens: event.usage.tokens?.total_tokens ?? 0,
                    },
                  }
                : undefined,
            },
          });
          break;
        case 'response.error':
          stream.emit({ type: 'error', error: new Error(event.error?.message ?? 'Codex error') });
          break;
        default:
          stream.emit({ type: 'raw', event: event.type, data: event });
      }
    };

    return adapter;
  };
};
