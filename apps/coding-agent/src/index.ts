#!/usr/bin/env bun

import pkg from '../package.json';
import { existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from './args.js';
import { runHeadless } from './adapters/cli/headless.js';
import { runValidate } from './adapters/cli/validate.js';
import { runAcp } from './adapters/acp/index.js';
import type { ThinkingLevel } from '@yeshwanthyk/agent-core';

declare const OTUI_TREE_SITTER_WORKER_PATH: string | undefined;

const ensureTreeSitterWorkerPath = (): void => {
  if (
    process.env.OTUI_TREE_SITTER_WORKER_PATH ||
    typeof OTUI_TREE_SITTER_WORKER_PATH !== 'undefined'
  ) {
    return;
  }

  const candidates: string[] = [];

  const execDir = dirname(process.execPath);
  candidates.push(join(execDir, 'parser.worker.js'));

  try {
    const moduleDir = dirname(fileURLToPath(import.meta.url));
    candidates.push(join(moduleDir, 'parser.worker.js'));
  } catch {
    // Ignore non-file URLs (e.g. bundled snapshot)
  }

  try {
    const require = createRequire(import.meta.url);
    // Use dynamic string to prevent static analysis by bundler
    const modulePath = ['@opentui', 'core', 'parser.worker.js'].join('/');
    candidates.push(require.resolve(modulePath));
  } catch {
    // Ignore missing module resolution in minimal installs
  }

  for (const candidate of candidates) {
    if (candidate && existsSync(candidate)) {
      process.env.OTUI_TREE_SITTER_WORKER_PATH = candidate;
      break;
    }
  }
};

ensureTreeSitterWorkerPath();

// Dynamic import for TUI (requires solid plugin for TSX)
const runTui = async (args: {
  configDir?: string;
  configPath?: string;
  provider?: string;
  model?: string;
  thinking?: ThinkingLevel;
  continueSession?: boolean;
  resumeSession?: boolean;
  session?: string;
  prompt?: string;
}) => {
  const solidPlugin = (await import("@opentui/solid/bun-plugin")).default;
  Bun.plugin(solidPlugin);

  // Initialize tree-sitter parsers for code syntax highlighting
  const { addDefaultParsers } = await import("@opentui/core");
  const { parsersConfig } = await import("@yeshwanthyk/open-tui");
  addDefaultParsers(parsersConfig.parsers);

  const { runTuiOpen } = await import('./adapters/tui/app.js');
  return runTuiOpen(args);
};

const printHelp = () => {
  process.stdout.write(
    [
      'Usage:',
      '  marvin [options] [prompt...]',
      '  marvin validate [options]',
      '',
      'Options:',
      '  --provider <name>            Provider (e.g. openai, anthropic, codex)',
      '  --model <id>                 Model id or comma-separated list (Ctrl+P to cycle)',
      '  --thinking <level>           off|minimal|low|medium|high|xhigh',
      '  --config-dir <dir>           Config directory (default: ~/.config/marvin)',
      '  --config <path>              Config file path (default: <config-dir>/config.json)',
      '  -c, --continue               Resume most recent session for current directory',
      '  -r, --resume                 Pick from recent sessions to resume',
      '  -s, --session <id>           Load session by ID (UUID, prefix, or path)',
      '  --headless                   Run without TUI; reads prompt from args or stdin',
      '  --acp                        Run as ACP server for Zed integration',
      '  -h, --help                   Show help',
      '  -v, --version                Print version',
      '',
      'Keybinds:',
      '  Ctrl+P                       Cycle through --models list',
      '  Shift+Tab                    Cycle thinking level',
      '  Ctrl+C                       Clear input / double to exit',
      '  Esc                          Abort current request',
      '',
      'Custom Commands:',
      '  Place .md files in ~/.config/marvin/commands/',
      '  Use /<name> [args] to expand the template.',
      '  $ARGUMENTS in the template is replaced with args.',
      '',
      'Lifecycle Hooks:',
      '  Place .ts files in ~/.config/marvin/hooks/',
      '  Export default function(marvin) { marvin.on(event, handler) }',
      '  Events: app.start, session.start/resume/clear, agent.start/end,',
      '          turn.start/end, tool.execute.before/after',
      '  Use marvin.send(text) to inject messages into conversation',
      '',
      'Custom Tools:',
      '  Place .ts files in ~/.config/marvin/tools/',
      '  Export default function(api) returning AgentTool or AgentTool[]',
      '  api.cwd: current working directory',
      '  api.exec(cmd, args, opts): run commands',
      '',
      'Validation:',
      '  Run "marvin validate --config-dir <dir>" to check custom hooks/tools/commands',
      '',
      'Environment:',
      '  OPENAI_API_KEY / ANTHROPIC_API_KEY / GEMINI_API_KEY / ...',
      '',
    ].join('\n')
  );
};

const main = async () => {
  const argv = process.argv.slice(2);
  const args = parseArgs(argv);

  if (args.version) {
    process.stdout.write(`${pkg.name} ${pkg.version}\n`);
    return;
  }

  if (args.help) {
    printHelp();
    return;
  }

  if (args.command === 'validate') {
    await runValidate({
      configDir: args.configDir,
      configPath: args.configPath,
      provider: args.provider,
      model: args.model,
      thinking: args.thinking,
    });
    return;
  }

  if (args.acp) {
    await runAcp({
      configDir: args.configDir,
      configPath: args.configPath,
      model: args.model,
    });
    return;
  }

  if (args.headless) {
    await runHeadless({
      prompt: args.prompt,
      configDir: args.configDir,
      configPath: args.configPath,
      provider: args.provider,
      model: args.model,
      thinking: args.thinking,
    });
    return;
  }

  await runTui({
    configDir: args.configDir,
    configPath: args.configPath,
    provider: args.provider,
    model: args.model,
    thinking: args.thinking,
    continueSession: args.continue,
    resumeSession: args.resume,
    session: args.session,
    prompt: args.prompt,
  });
};

await main();
