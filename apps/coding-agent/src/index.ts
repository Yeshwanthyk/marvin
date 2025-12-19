import pkg from '../package.json';
import { parseArgs } from './args.js';
import { runHeadless } from './headless.js';
import { runTui } from './tui-app.js';

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
      'Environment:',
      '  MU_PROVIDER / MU_MODEL / MU_THINKING / MU_SYSTEM_PROMPT',
      '  OPENAI_API_KEY / ANTHROPIC_API_KEY / ... (see below)',
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
