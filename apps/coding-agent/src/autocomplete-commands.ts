import { getModels, getProviders } from '@marvin-agents/ai';
import type { ThinkingLevel } from '@marvin-agents/agent-core';
import { THEME_NAMES } from "./theme-names.js";

type KnownProvider = ReturnType<typeof getProviders>[number];

export interface AutocompleteContext {
  currentProvider: KnownProvider;
}

export interface SlashCommand {
  name: string;
  description: string;
  getArgumentCompletions?: (argumentText: string, ctx: AutocompleteContext) => Array<{ value: string; label: string; description?: string }>;
}

const resolveProvider = (raw: string): KnownProvider | undefined => {
  const trimmed = raw.trim();
  if (!trimmed) return undefined;
  const providers = getProviders();
  return providers.includes(trimmed as KnownProvider) ? (trimmed as KnownProvider) : undefined;
};

export const slashCommands: SlashCommand[] = [
  { name: 'clear', description: 'Clear chat + reset agent' },
  { name: 'compact', description: 'Compact context into summary + start fresh' },
  { name: 'abort', description: 'Abort in-flight request' },
  { name: 'exit', description: 'Exit' },
  { name: 'rewind', description: 'Rewind working tree to a snapshot' },
  {
    name: 'theme',
    description: 'Set theme: /theme <name> (or /theme to list)',
    getArgumentCompletions: (argumentText: string) => {
      const prefix = argumentText.trim().toLowerCase();
      return THEME_NAMES
        .filter((t) => t.startsWith(prefix))
        .map((t) => ({ value: t, label: t }));
    },
  },
  {
    name: 'model',
    description: 'Set model: /model <provider> <modelId> (or /model <modelId>)',
    getArgumentCompletions: (argumentText: string, ctx: AutocompleteContext) => {
      const text = argumentText.trimStart();
      const providers = getProviders();

      const providerItems = (prefix: string) =>
        providers
          .filter((p) => p.toLowerCase().startsWith(prefix.toLowerCase()))
          .map((p) => ({ value: `${p} `, label: p, description: 'provider' }));

      const spaceIdx = text.search(/\s/);
      if (!text || spaceIdx === -1) {
        const prefix = text;
        const models = getModels(ctx.currentProvider)
          .filter((m) => m.id.toLowerCase().startsWith(prefix.toLowerCase()))
          .slice(0, 50)
          .map((m) => ({ value: m.id, label: m.id, description: m.name }));

        return [...providerItems(prefix), ...models];
      }

      const providerToken = text.slice(0, spaceIdx);
      const provider = resolveProvider(providerToken);
      if (!provider) {
        return providerItems(providerToken);
      }

      const modelPrefix = text.slice(spaceIdx + 1).trimStart();
      return getModels(provider)
        .filter((m) => m.id.toLowerCase().startsWith(modelPrefix.toLowerCase()))
        .slice(0, 50)
        .map((m) => ({ value: `${provider} ${m.id}`, label: m.id, description: m.name }));
    },
  },
  {
    name: 'thinking',
    description: 'Set thinking: /thinking off|minimal|low|medium|high|xhigh',
    getArgumentCompletions: (argumentPrefix: string) => {
      const levels: ThinkingLevel[] = ['off', 'minimal', 'low', 'medium', 'high', 'xhigh'];
      const prefix = argumentPrefix.trim().toLowerCase();
      return levels
        .filter((level) => level.startsWith(prefix))
        .map((level) => ({ value: level, label: level }));
    },
  },
];

export function createAutocompleteCommands(getContext: () => AutocompleteContext) {
  return slashCommands.map((cmd) => ({
    name: cmd.name,
    description: cmd.description,
    getArgumentCompletions: cmd.getArgumentCompletions
      ? (text: string) => cmd.getArgumentCompletions!(text, getContext())
      : undefined,
  }));
}
