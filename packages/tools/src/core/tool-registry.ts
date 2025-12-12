import type { AgentToolDefinition } from '@mu-agents/types';
import { validate } from '@mu-agents/types';
import type { Static, TSchema } from '@sinclair/typebox';
import os from 'node:os';

import {
  DEFAULT_TRUNCATION_CONFIG,
  type ToolTruncationConfig,
} from './truncation';

export interface ToolExecutionContext {
  cwd: string;
  env: NodeJS.ProcessEnv;
  tmpDir: string;
  truncation: ToolTruncationConfig;
}

export type ToolExecutionOverrides = Partial<ToolExecutionContext>;

export interface ToolRegistryOptions {
  defaultContext?: ToolExecutionOverrides;
}

export interface ToolHandler<TS extends TSchema> {
  (input: Static<TS>, context: ToolExecutionContext): Promise<unknown> | unknown;
}

export interface ToolRegistration<TS extends TSchema = TSchema> {
  name: string;
  description: string;
  schema: TS;
  timeoutMs?: number;
  cacheTtlMs?: number;
  metadata?: AgentToolDefinition['metadata'];
  handler: ToolHandler<TS>;
}

type AnyToolRegistration = ToolRegistration<TSchema>;

interface RegisteredTool extends AnyToolRegistration {
  definition: AgentToolDefinition;
}

const mergeTruncation = (
  base: ToolTruncationConfig,
  overrides?: ToolTruncationConfig
): ToolTruncationConfig => {
  if (!overrides) {
    return base;
  }

  return {
    text: { ...base.text, ...overrides.text },
    command: { ...base.command, ...overrides.command },
  };
};

export class ToolRegistry {
  private readonly registrations = new Map<string, RegisteredTool>();
  private readonly defaultContext: ToolExecutionContext;

  constructor(options: ToolRegistryOptions = {}) {
    this.defaultContext = {
      cwd: options.defaultContext?.cwd ?? process.cwd(),
      env: options.defaultContext?.env ?? process.env,
      tmpDir: options.defaultContext?.tmpDir ?? os.tmpdir(),
      truncation: mergeTruncation(
        DEFAULT_TRUNCATION_CONFIG,
        options.defaultContext?.truncation
      ),
    };
  }

  register<TS extends TSchema>(tool: ToolRegistration<TS>): this {
    if (this.registrations.has(tool.name)) {
      throw new Error(`Tool "${tool.name}" already registered`);
    }

    const definition: AgentToolDefinition = {
      name: tool.name,
      description: tool.description,
      input: tool.schema,
      timeoutMs: tool.timeoutMs,
      cacheTtlMs: tool.cacheTtlMs,
      metadata: tool.metadata,
    };

    const baseRegistration: AnyToolRegistration = {
      name: tool.name,
      description: tool.description,
      schema: tool.schema,
      timeoutMs: tool.timeoutMs,
      cacheTtlMs: tool.cacheTtlMs,
      metadata: tool.metadata,
      handler: tool.handler as ToolHandler<TSchema>,
    };

    const registration: RegisteredTool = {
      ...baseRegistration,
      definition,
    };

    this.registrations.set(tool.name, registration);
    return this;
  }

  getDefinition(name: string): AgentToolDefinition | undefined {
    return this.registrations.get(name)?.definition;
  }

  listDefinitions(): AgentToolDefinition[] {
    return Array.from(this.registrations.values()).map(
      (registration) => registration.definition
    );
  }

  async invoke(name: string, args: unknown, overrides?: ToolExecutionOverrides): Promise<unknown> {
    const registration = this.registrations.get(name);
    if (!registration) {
      throw new Error(`Tool "${name}" is not registered`);
    }

    const input = validate(registration.schema, args, `Invalid payload for tool ${name}`);
    const context = this.resolveContext(overrides);
    return registration.handler(input, context);
  }

  private resolveContext(overrides?: ToolExecutionOverrides): ToolExecutionContext {
    if (!overrides) {
      return this.defaultContext;
    }

    return {
      cwd: overrides.cwd ?? this.defaultContext.cwd,
      env: overrides.env ?? this.defaultContext.env,
      tmpDir: overrides.tmpDir ?? this.defaultContext.tmpDir,
      truncation: mergeTruncation(this.defaultContext.truncation, overrides.truncation),
    };
  }
}
