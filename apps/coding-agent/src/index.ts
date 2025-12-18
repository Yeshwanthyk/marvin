import pkg from '../package.json';
import { parseArgs } from './args.js';
import { runHeadless } from './headless.js';
import { runTui } from './tui-app.js';

const printHelp = () => {
  process.stdout.write(
    [
      'Usage:',
      '  coding-agent [options] [prompt...]',
      '',
      'Options:',
      '  --provider <name>            Provider (e.g. openai, anthropic)',
      '  --model <id>                 Model id (provider-specific)',
      '  --thinking <level>           off|minimal|low|medium|high|xhigh',
      '  --config-dir <dir>           Config directory (default: ~/.config/mu-agent)',
      '  --config <path>              Config file path (default: <config-dir>/config.json)',
      '  --headless                   Run without TUI; reads prompt from args or stdin',
      '  -h, --help                   Show help',
      '  -v, --version                Print version',
      '',
      'Environment:',
      '  MU_PROVIDER / MU_MODEL / MU_THINKING / MU_SYSTEM_PROMPT',
      '  OPENAI_API_KEY / ANTHROPIC_API_KEY / ... (pi-ai env var names)',
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
  });
};

await main();
