export * from './core/truncation';
export * from './core/tool-registry';
export { registerFsTools } from './tools/fs';
export { registerShellTools } from './tools/shell';

import type { ToolRegistryOptions } from './core/tool-registry';
import { ToolRegistry } from './core/tool-registry';
import { registerFsTools } from './tools/fs';
import { registerShellTools } from './tools/shell';

export const registerDefaultTools = (registry: ToolRegistry) => {
  registerFsTools(registry);
  registerShellTools(registry);
  return registry;
};

export const createDefaultToolRegistry = (options?: ToolRegistryOptions) => {
  const registry = new ToolRegistry(options);
  registerDefaultTools(registry);
  return registry;
};
