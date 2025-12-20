import pkg from '../package.json';
import { parseArgs } from './args.js';
import { runHeadless } from './headless.js';
import { runTui } from './tui-app.js';

// Dynamic import for OpenTUI (requires solid plugin)
const runOpenTui = async (args: Parameters<typeof runTui>[0]) => {
  // Register solid plugin before importing TSX
  const solidPlugin = (await import("@opentui/solid/bun-plugin")).default;
  Bun.plugin(solidPlugin);
  const { runTuiOpen } = await import("./tui-app-open.js");
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
      '  --open                       Use OpenTUI (experimental)',
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

  const tuiArgs = {
    configDir: args.configDir,
    configPath: args.configPath,
    provider: args.provider,
    model: args.model,
    thinking: args.thinking,
    continueSession: args.continue,
    resumeSession: args.resume,
  };

  if (args.open) {
    await runOpenTui(tuiArgs);
    return;
  }

  await runTui(tuiArgs);
};

await main();
