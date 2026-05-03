export interface ParsedArgs {
  headless: boolean;
  acp: boolean;
  command?: 'validate';
  prompt?: string;
  configDir?: string;
  configPath?: string;
  provider?: string;
  /** Single model or comma-separated list for Ctrl+P cycling */
  model?: string;
  thinking?: 'off' | 'minimal' | 'low' | 'medium' | 'high' | 'xhigh';
  continue: boolean;
  resume: boolean;
  /** Session ID (full UUID, prefix, or path) to load directly */
  session?: string;
  help: boolean;
  version: boolean;
}

const optionValue = (argv: string[], index: number): string | undefined => {
  const value = argv[index]
  return value && !value.startsWith("-") ? value : undefined
}

export const parseArgs = (argv: string[]): ParsedArgs => {
  const args: ParsedArgs = {
    headless: false,
    acp: false,
    prompt: undefined,
    configDir: undefined,
    configPath: undefined,
    provider: undefined,
    model: undefined,
    thinking: undefined,
    continue: false,
    resume: false,
    session: undefined,
    help: false,
    version: false,
  };

  const rest: string[] = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === undefined) continue;
    if (!a.startsWith('-') && !args.command && rest.length === 0 && a === 'validate') {
      args.command = 'validate';
      continue;
    }
    if (a === '--help' || a === '-h') {
      args.help = true;
      continue;
    }
    if (a === '--version' || a === '-v') {
      args.version = true;
      continue;
    }
    if (a === '--continue' || a === '-c') {
      args.continue = true;
      continue;
    }
    if (a === '--resume' || a === '-r') {
      args.resume = true;
      continue;
    }
    if (a === '--session' || a === '-s') {
      const value = optionValue(argv, i + 1)
      if (value) {
        args.session = value
        i += 1
      } else {
        rest.push(a)
      }
      continue;
    }
    if (a === "--headless") {
      args.headless = true;
      continue;
    }
    if (a === "--acp") {
      args.acp = true;
      continue;
    }
    if (a === "--config-dir") {
      const value = optionValue(argv, i + 1)
      if (value) {
        args.configDir = value
        i += 1
      } else {
        rest.push(a)
      }
      continue;
    }
    if (a === "--config") {
      const value = optionValue(argv, i + 1)
      if (value) {
        args.configPath = value
        i += 1
      } else {
        rest.push(a)
      }
      continue;
    }
    if (a === '--provider') {
      const value = optionValue(argv, i + 1)
      if (value) {
        args.provider = value
        i += 1
      } else {
        rest.push(a)
      }
      continue;
    }
    if (a === '--model') {
      const value = optionValue(argv, i + 1)
      if (value) {
        args.model = value
        i += 1
      } else {
        rest.push(a)
      }
      continue;
    }
    if (a === '--thinking') {
      const level = optionValue(argv, i + 1)
      if (level === 'off' || level === 'minimal' || level === 'low' || level === 'medium' || level === 'high' || level === 'xhigh') {
        args.thinking = level;
        i += 1;
      } else if (level !== undefined) {
        rest.push(a, level);
        i += 1;
      } else {
        rest.push(a);
      }
      continue;
    }
    rest.push(a);
  }

  if (rest.length) args.prompt = rest.join(" ");
  return args;
};
