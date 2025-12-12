import { runHeadless } from './headless';
import { runTui } from './tui-app';

const parseArgs = (argv: string[]) => {
  const args = { headless: false, prompt: undefined as string | undefined, configDir: undefined as string | undefined, configPath: undefined as string | undefined };
  const rest: string[] = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]!;
    if (a === '--headless') {
      args.headless = true;
      continue;
    }
    if (a === '--config-dir') {
      args.configDir = argv[i + 1];
      i += 1;
      continue;
    }
    if (a === '--config') {
      args.configPath = argv[i + 1];
      i += 1;
      continue;
    }
    rest.push(a);
  }
  if (rest.length) args.prompt = rest.join(' ');
  return args;
};

const main = async () => {
  const argv = process.argv.slice(2);
  const args = parseArgs(argv);
  if (args.headless) {
    await runHeadless({ prompt: args.prompt, configDir: args.configDir, configPath: args.configPath });
    return;
  }
  await runTui({ configDir: args.configDir, configPath: args.configPath });
};

await main();

