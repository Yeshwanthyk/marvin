import { Type } from '@sinclair/typebox';
import type { Static } from '@sinclair/typebox';
import { createValidator, StrictObject } from '../helpers/typebox-helpers';

const JsonSchemaRef = Type.Record(Type.String(), Type.Unknown(), {
  description: 'JSON Schema fragment describing the tool input payload',
});

export const ToolDefinitionSchema = StrictObject(
  {
    name: Type.String({ minLength: 1 }),
    description: Type.Optional(Type.String({ description: 'Human readable description' })),
    input: JsonSchemaRef,
    timeoutMs: Type.Optional(Type.Integer({ minimum: 1 })),
    cacheTtlMs: Type.Optional(Type.Integer({ minimum: 0 })),
    metadata: Type.Optional(Type.Record(Type.String(), Type.Unknown())),
  },
  {
    $id: 'AgentToolDefinition',
  }
);

export const ToolInvocationSchema = StrictObject(
  {
    id: Type.String({ description: 'Unique identifier for the invocation across retries' }),
    name: Type.String({ minLength: 1 }),
    arguments: Type.Record(Type.String(), Type.Unknown(), {
      description: 'Arguments validated against the tool definition input schema',
    }),
  },
  {
    $id: 'AgentToolInvocation',
  }
);

export const ToolResultSchema = StrictObject(
  {
    invocation: ToolInvocationSchema,
    output: Type.Unknown({ description: 'Tool output payload (already serialized)' }),
    isError: Type.Optional(Type.Boolean({ description: 'When true the invocation failed' })),
    metadata: Type.Optional(Type.Record(Type.String(), Type.Unknown())),
  },
  {
    $id: 'AgentToolResult',
  }
);

export type AgentToolDefinition = Static<typeof ToolDefinitionSchema>;
export type AgentToolInvocation = Static<typeof ToolInvocationSchema>;
export type AgentToolResult = Static<typeof ToolResultSchema>;

export const isAgentToolDefinition = createValidator(ToolDefinitionSchema);
export const isAgentToolInvocation = createValidator(ToolInvocationSchema);
export const isAgentToolResult = createValidator(ToolResultSchema);
