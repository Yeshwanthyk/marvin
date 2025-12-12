import { Type } from '@sinclair/typebox';
import type { Static, TSchema } from '@sinclair/typebox';
import { createValidator, StrictObject, StringEnum } from '../helpers/typebox-helpers';

type SchemaRecord = Record<string, TSchema>;

const metadataSchema = Type.Record(Type.String(), Type.Unknown(), {
  $id: 'AgentMessageMetadata',
  description: 'Provider specific metadata captured on a message',
});

export const MessageRoleSchema = StringEnum(['system', 'user', 'assistant', 'tool'] as const, {
  $id: 'AgentMessageRole',
});

const TextContentSchema = StrictObject(
  {
    type: Type.Literal('text'),
    text: Type.String({ description: 'UTF-8 text for the target agent or tool' }),
  },
  {
    $id: 'AgentTextContentBlock',
  }
);

const JsonContentSchema = StrictObject(
  {
    type: Type.Literal('json'),
    value: Type.Unknown({ description: 'Arbitrary JSON content' }),
  },
  {
    $id: 'AgentJsonContentBlock',
  }
);

const ToolCallContentSchema = StrictObject(
  {
    type: Type.Literal('tool-call'),
    toolName: Type.String({ minLength: 1, description: 'Registered tool name' }),
    callId: Type.Optional(Type.String({ description: 'Provider specific call identifier' })),
    arguments: Type.Record(
      Type.String(),
      Type.Unknown(),
      { description: 'Structured arguments passed to the tool invocation' }
    ),
  },
  {
    $id: 'AgentToolCallContentBlock',
  }
);

const ToolResultContentSchema = StrictObject(
  {
    type: Type.Literal('tool-result'),
    toolName: Type.String({ minLength: 1 }),
    callId: Type.Optional(Type.String()),
    result: Type.Unknown({ description: 'Raw tool result payload (prior to rendering)' }),
  },
  {
    $id: 'AgentToolResultContentBlock',
  }
);

export const MessageContentSchema = Type.Union(
  [TextContentSchema, JsonContentSchema, ToolCallContentSchema, ToolResultContentSchema],
  {
    $id: 'AgentMessageContent',
  }
);

const messageBaseProperties: SchemaRecord = {
  id: Type.Optional(
    Type.String({ description: 'Stable identifier for deduplication + logging' })
  ),
  createdAt: Type.Optional(
    Type.String({ format: 'date-time', description: 'RFC 3339 timestamp emitted by the provider' })
  ),
  metadata: Type.Optional(metadataSchema),
};

const createMessageSchema = <TRole extends string, TExt extends SchemaRecord>(
  role: TRole,
  extension: TExt,
  options?: Parameters<typeof StrictObject>[1]
) =>
  StrictObject(
    {
      role: Type.Literal(role, { description: `Message role (${role})` }),
      ...messageBaseProperties,
      ...extension,
    },
    options
  );

export const SystemMessageSchema = createMessageSchema(
  'system',
  {
    content: Type.Array(TextContentSchema, {
      minItems: 1,
      description: 'System prompts can contain one or more text fragments',
    }),
  },
  {
    $id: 'AgentSystemMessage',
  }
);

export const UserMessageSchema = createMessageSchema(
  'user',
  {
    name: Type.Optional(Type.String({ description: 'Optional name when using named user roles' })),
    content: Type.Array(MessageContentSchema, {
      minItems: 1,
      description: 'User messages support arbitrary blocks (text/json/tool results)',
    }),
  },
  {
    $id: 'AgentUserMessage',
  }
);

export const AssistantMessageSchema = createMessageSchema(
  'assistant',
  {
    content: Type.Array(MessageContentSchema, {
      minItems: 1,
      description: 'Assistant messages echo content visible to the user or tools',
    }),
  },
  {
    $id: 'AgentAssistantMessage',
  }
);

export const ToolMessageSchema = createMessageSchema(
  'tool',
  {
    toolName: Type.String({ minLength: 1, description: 'Name of the tool invoked by the assistant' }),
    callId: Type.Optional(Type.String({ description: 'Provider assigned call identifier' })),
    content: Type.Array(MessageContentSchema, {
      minItems: 1,
      description: 'Tool responses can be structured JSON or text blocks',
    }),
  },
  {
    $id: 'AgentToolMessage',
  }
);

export const MessageSchema = Type.Union(
  [SystemMessageSchema, UserMessageSchema, AssistantMessageSchema, ToolMessageSchema],
  {
    $id: 'AgentMessage',
  }
);

export const ConversationSchema = Type.Array(MessageSchema, {
  $id: 'AgentConversation',
  description: 'Ordered list of messages exchanged between the runtime and providers',
});

export type AgentMessageRole = Static<typeof MessageRoleSchema>;
export type AgentMessageContent = Static<typeof MessageContentSchema>;
export type AgentSystemMessage = Static<typeof SystemMessageSchema>;
export type AgentUserMessage = Static<typeof UserMessageSchema>;
export type AgentAssistantMessage = Static<typeof AssistantMessageSchema>;
export type AgentToolMessage = Static<typeof ToolMessageSchema>;
export type AgentMessage = Static<typeof MessageSchema>;
export type AgentConversation = Static<typeof ConversationSchema>;

export const isAgentMessage = createValidator(MessageSchema);
export const isAgentConversation = createValidator(ConversationSchema);
