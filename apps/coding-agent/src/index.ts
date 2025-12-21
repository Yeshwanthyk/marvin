import pkg from '../package.json';
import { parseArgs } from './args.js';
import { runHeadless } from './headless.js';
import type { ThinkingLevel } from '@marvin-agents/agent-core';

// Dynamic import for TUI (requires solid plugin for TSX)
const runTui = async (args: {
  configDir?: string;
  configPath?: string;
  provider?: string;
  model?: string;
  thinking?: ThinkingLevel;
  continueSession?: boolean;
  resumeSession?: boolean;
}) => {
  const solidPlugin = (await import("@opentui/solid/bun-plugin")).default;
  Bun.plugin(solidPlugin);
  const { runTuiOpen } = await import("./tui-app.js");
  return runTuiOpen(args);
};

const printHelp = () => {
  process.stdout.write(
    [
      'Usage:',
      '  marvin [options] [prompt...]',
      '',
      'Options:',
      '  --provider <name>            Provider (e.g. openai, anthropic, codex)',
      '  --model <id>                 Model id or comma-separated list (Ctrl+P to cycle)',
      '  --thinking <level>           off|minimal|low|medium|high|xhigh',
      '  --config-dir <dir>           Config directory (default: ~/.config/marvin)',
      '  --config <path>              Config file path (default: <config-dir>/config.json)',
      '  -c, --continue               Resume most recent session for current directory',
      '  -r, --resume                 Pick from recent sessions to resume',
      '  --headless                   Run without TUI; reads prompt from args or stdin',
      '  -h, --help                   Show help',
      '  -v, --version                Print version',
      '',
      'Keybinds:',
      '  Ctrl+P                       Cycle through --models list',
      '  Shift+Tab                    Cycle thinking level',
      '  Ctrl+C                       Clear / double to exit',
      '  Esc                          Abort current request',
      '',
      'Custom Commands:',
      '  Place .md files in ~/.config/marvin/commands/',
      '  Use /<name> [args] to expand the template.',
      '  $ARGUMENTS in the template is replaced with args.',
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
  });
};

await main();
