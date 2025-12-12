import { runHeadless } from './headless';
import { runTui } from './tui-app';
import { parseArgs } from './args';

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

