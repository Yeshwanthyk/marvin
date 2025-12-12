import { Type } from '@sinclair/typebox';
import type { Static } from '@sinclair/typebox';
import { createValidator, StrictObject, StringEnum } from '../helpers/typebox-helpers';
import { UsageSchema } from './usage';

const ProviderModeSchema = StringEnum(['chat', 'completion', 'tool', 'embedding'] as const, {
  $id: 'AgentProviderMode',
});

export const ProviderMetadataSchema = StrictObject(
  {
    provider: Type.String({ minLength: 1 }),
    model: Type.String({ minLength: 1 }),
    mode: ProviderModeSchema,
    version: Type.Optional(Type.String()),
    transport: Type.Optional(Type.String({ description: 'HTTP, WebSocket, or provider specific transport' })),
    baseUrl: Type.Optional(Type.String({ format: 'uri' })),
    labels: Type.Optional(Type.Array(Type.String({ minLength: 1 }))),
    extensions: Type.Optional(Type.Record(Type.String(), Type.Unknown())),
  },
  {
    $id: 'AgentProviderMetadata',
  }
);

export const ProviderResponseSchema = StrictObject(
  {
    metadata: ProviderMetadataSchema,
    usage: Type.Optional(UsageSchema),
    warnings: Type.Optional(Type.Array(Type.String())),
    raw: Type.Optional(Type.Unknown({ description: 'Provider specific payload for debugging' })),
  },
  {
    $id: 'AgentProviderResponse',
  }
);

export type AgentProviderMode = Static<typeof ProviderModeSchema>;
export type AgentProviderMetadata = Static<typeof ProviderMetadataSchema>;
export type AgentProviderResponse = Static<typeof ProviderResponseSchema>;

export const isAgentProviderMetadata = createValidator(ProviderMetadataSchema);
export const isAgentProviderResponse = createValidator(ProviderResponseSchema);
