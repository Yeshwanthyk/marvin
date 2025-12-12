import { Type } from '@sinclair/typebox';
import type { Static } from '@sinclair/typebox';
import { createValidator, StrictObject, StringEnum } from '../helpers/typebox-helpers';

const TokenUsageSchema = StrictObject(
  {
    promptTokens: Type.Integer({ minimum: 0 }),
    completionTokens: Type.Integer({ minimum: 0 }),
    cachedTokens: Type.Optional(Type.Integer({ minimum: 0 })),
    totalTokens: Type.Integer({ minimum: 0 }),
  },
  {
    $id: 'AgentTokenUsage',
  }
);

const BillingPhaseSchema = StringEnum(['estimated', 'final'] as const, {
  $id: 'AgentUsageBillingPhase',
});

const UsageCostSchema = StrictObject(
  {
    currency: Type.String({ minLength: 3, maxLength: 3 }),
    value: Type.Number({ minimum: 0 }),
    billingPhase: Type.Optional(BillingPhaseSchema),
  },
  {
    $id: 'AgentUsageCost',
  }
);

export const UsageSchema = StrictObject(
  {
    model: Type.String({ minLength: 1 }),
    provider: Type.String({ minLength: 1 }),
    requestId: Type.Optional(Type.String({ description: 'Provider-specific request identifier' })),
    responseId: Type.Optional(Type.String({ description: 'Provider-specific response identifier' })),
    tokens: TokenUsageSchema,
    latencyMs: Type.Optional(Type.Integer({ minimum: 0 })),
    cost: Type.Optional(UsageCostSchema),
    metadata: Type.Optional(Type.Record(Type.String(), Type.Unknown())),
  },
  {
    $id: 'AgentUsage',
  }
);

export type AgentTokenUsage = Static<typeof TokenUsageSchema>;
export type AgentUsageCost = Static<typeof UsageCostSchema>;
export type AgentUsage = Static<typeof UsageSchema>;

export const isAgentUsage = createValidator(UsageSchema);
