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
    const a = argv[i]!;
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
      args.session = argv[i + 1];
      i += 1;
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
      args.configDir = argv[i + 1];
      i += 1;
      continue;
    }
    if (a === "--config") {
      args.configPath = argv[i + 1];
      i += 1;
      continue;
    }
    if (a === '--provider') {
      args.provider = argv[i + 1];
      i += 1;
      continue;
    }
    if (a === '--model') {
      args.model = argv[i + 1];
      i += 1;
      continue;
    }
    if (a === '--thinking') {
      const level = argv[i + 1];
      if (level === 'off' || level === 'minimal' || level === 'low' || level === 'medium' || level === 'high' || level === 'xhigh') {
        args.thinking = level;
      } else if (level !== undefined) {
        rest.push(a, level);
      } else {
        rest.push(a);
      }
      i += 1;
      continue;
    }
    rest.push(a);
  }

  if (rest.length) args.prompt = rest.join(" ");
  return args;
};
