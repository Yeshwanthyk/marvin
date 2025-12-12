import { Type } from '@sinclair/typebox';
import type { Static } from '@sinclair/typebox';
import { createValidator, StrictObject } from '../helpers/typebox-helpers';
import { ToolDefinitionSchema } from './tools';

const SamplingSchema = StrictObject(
  {
    temperature: Type.Optional(Type.Number({ minimum: 0, maximum: 2 })),
    topP: Type.Optional(Type.Number({ minimum: 0, maximum: 1 })),
    maxOutputTokens: Type.Optional(Type.Integer({ minimum: 1 })),
    presencePenalty: Type.Optional(Type.Number({ minimum: -2, maximum: 2 })),
    frequencyPenalty: Type.Optional(Type.Number({ minimum: -2, maximum: 2 })),
  },
  {
    $id: 'AgentSamplingConfig',
  }
);

export const AgentConfigSchema = StrictObject(
  {
    provider: Type.String({ minLength: 1 }),
    model: Type.String({ minLength: 1 }),
    sampling: Type.Optional(SamplingSchema),
    system: Type.Optional(Type.Array(Type.String(), { description: 'System level strings appended before requests' })),
    tools: Type.Optional(Type.Array(ToolDefinitionSchema)),
    stop: Type.Optional(Type.Array(Type.String({ minLength: 1 }))),
    metadata: Type.Optional(Type.Record(Type.String(), Type.Unknown())),
  },
  {
    $id: 'AgentConfig',
  }
);

export const AgentRuntimeSchema = StrictObject(
  {
    default: AgentConfigSchema,
    overrides: Type.Optional(
      Type.Record(
        Type.String(),
        AgentConfigSchema,
        { description: 'Optional provider/model overrides keyed by capability' }
      )
    ),
  },
  {
    $id: 'AgentRuntimeConfig',
  }
);

export type AgentSamplingConfig = Static<typeof SamplingSchema>;
export type AgentConfig = Static<typeof AgentConfigSchema>;
export type AgentRuntimeConfig = Static<typeof AgentRuntimeSchema>;

export const isAgentConfig = createValidator(AgentConfigSchema);
export const isAgentRuntimeConfig = createValidator(AgentRuntimeSchema);
