export interface ParsedArgs {
  headless: boolean;
  prompt?: string;
  configDir?: string;
  configPath?: string;
}

export const parseArgs = (argv: string[]): ParsedArgs => {
  const args: ParsedArgs = {
    headless: false,
    prompt: undefined,
    configDir: undefined,
    configPath: undefined,
  };

  const rest: string[] = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]!;
    if (a === "--headless") {
      args.headless = true;
      continue;
    }
    if (a === "--config-dir") {
      args.configDir = argv[i + 1];
      i += 1;
      continue;
    }
    if (a === "--config") {
      args.configPath = argv[i + 1];
      i += 1;
      continue;
    }
    rest.push(a);
  }

  if (rest.length) args.prompt = rest.join(" ");
  return args;
};

