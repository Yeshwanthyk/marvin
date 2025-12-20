export interface ParsedArgs {
  headless: boolean;
  /** Use OpenTUI (experimental) instead of legacy TUI */
  open: boolean;
  prompt?: string;
  configDir?: string;
  configPath?: string;
  provider?: string;
  /** Single model or comma-separated list for Ctrl+P cycling */
  model?: string;
  thinking?: 'off' | 'minimal' | 'low' | 'medium' | 'high' | 'xhigh';
  continue: boolean;
  resume: boolean;
  help: boolean;
  version: boolean;
}

export const parseArgs = (argv: string[]): ParsedArgs => {
  const args: ParsedArgs = {
    headless: false,
    open: false,
    prompt: undefined,
    configDir: undefined,
    configPath: undefined,
    provider: undefined,
    model: undefined,
    thinking: undefined,
    continue: false,
    resume: false,
    help: false,
    version: false,
  };

  const rest: string[] = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]!;
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
    if (a === "--headless") {
      args.headless = true;
      continue;
    }
    if (a === "--open") {
      args.open = true;
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
