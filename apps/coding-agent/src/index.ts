import { runHeadless } from './headless';
import { runTui } from './tui-app';
import { parseArgs } from './args';
import pkg from '../package.json';

const printHelp = () => {
  process.stdout.write(
    [
      'Usage:',
      '  coding-agent [options] [prompt...]',
      '',
      'Options:',
      '  --provider <name>            Provider (overrides config)',
      '  --model <name>               Model (overrides config)',
      '  --thinking <level>           off|low|medium|high (overrides config)',
      '  --config-dir <dir>           Config directory (default: ~/.config/mu-agent)',
      '  --config <path>              Config file path (default: <config-dir>/config.json)',
      '  --headless                   Run without TUI; reads prompt from args or stdin',
      '  -h, --help                   Show help',
      '  -v, --version                Print version',
      '',
      'Notes:',
      '  You can run without a config file by passing --provider and --model.',
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
