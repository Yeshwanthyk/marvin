import { StrictObject } from '@mu-agents/types';
import { Type } from '@sinclair/typebox';
import type { Static } from '@sinclair/typebox';
import { spawn } from 'node:child_process';
import { promises as fs } from 'node:fs';
import type { Dirent } from 'node:fs';
import path from 'node:path';

import type { ToolRegistry } from '../core/tool-registry';
import type { ToolExecutionContext } from '../core/tool-registry';
import { resolveWorkspacePath, relativeToWorkspace } from '../core/paths';
import { summarizeText, truncateTail } from '../core/truncation';

const LsInputSchema = StrictObject({
  path: Type.Optional(Type.String({ default: '.' })),
  recursive: Type.Optional(Type.Boolean({ default: false })),
  includeHidden: Type.Optional(Type.Boolean({ default: false })),
  maxEntries: Type.Optional(Type.Integer({ minimum: 1 })),
});

const GrepInputSchema = StrictObject({
  pattern: Type.String({ minLength: 1 }),
  path: Type.Optional(Type.String({ default: '.' })),
  regex: Type.Optional(Type.Boolean({ default: false })),
  caseSensitive: Type.Optional(Type.Boolean({ default: true })),
  maxMatches: Type.Optional(Type.Integer({ minimum: 1 })),
  contextLines: Type.Optional(Type.Integer({ minimum: 0 })),
  globs: Type.Optional(Type.Array(Type.String({ minLength: 1 }))),
  ignores: Type.Optional(Type.Array(Type.String({ minLength: 1 }))),
});

const BashInputSchema = StrictObject({
  command: Type.String({ minLength: 1 }),
  stdin: Type.Optional(Type.String()),
  cwd: Type.Optional(Type.String()),
  timeoutMs: Type.Optional(Type.Integer({ minimum: 1 })),
});

type LsInput = Static<typeof LsInputSchema>;
type GrepInput = Static<typeof GrepInputSchema>;
type BashInput = Static<typeof BashInputSchema>;

interface ProcessOptions {
  cwd: string;
  env: NodeJS.ProcessEnv;
  stdin?: string;
  timeoutMs?: number;
}

interface ProcessResult {
  stdout: string;
  stderr: string;
  exitCode: number | null;
  signal: NodeJS.Signals | null;
  durationMs: number;
  timedOut: boolean;
}

const runProcess = (
  command: string,
  args: string[],
  options: ProcessOptions
): Promise<ProcessResult> => {
  return new Promise((resolve, reject) => {
    const start = Date.now();
    const child = spawn(command, args, {
      cwd: options.cwd,
      env: options.env,
      stdio: 'pipe',
    });

    const stdoutChunks: Buffer[] = [];
    const stderrChunks: Buffer[] = [];

    let completed = false;
    let timeout: NodeJS.Timeout | undefined;
    let timedOut = false;

    const settle = (result: ProcessResult) => {
      if (completed) {
        return;
      }
      completed = true;
      if (timeout) {
        clearTimeout(timeout);
      }
      resolve(result);
    };

    child.stdout?.on('data', (chunk: Buffer) => {
      stdoutChunks.push(chunk);
    });

    child.stderr?.on('data', (chunk: Buffer) => {
      stderrChunks.push(chunk);
    });

    child.once('error', (error) => {
      if (timeout) {
        clearTimeout(timeout);
      }
      reject(error);
    });

    if (options.stdin !== undefined) {
      child.stdin?.end(options.stdin);
    } else {
      child.stdin?.end();
    }

    if (options.timeoutMs) {
      timeout = setTimeout(() => {
        timedOut = true;
        child.kill('SIGTERM');
      }, options.timeoutMs);
    }

    child.once('close', (code, signal) => {
      settle({
        stdout: Buffer.concat(stdoutChunks).toString('utf8'),
        stderr: Buffer.concat(stderrChunks).toString('utf8'),
        exitCode: code,
        signal,
        durationMs: Date.now() - start,
        timedOut,
      });
    });
  });
};

type EntryType = 'file' | 'directory' | 'symlink' | 'other';

interface EntrySummary {
  path: string;
  type: EntryType;
  size?: number;
}

const detectEntryType = (dirent: Dirent): EntryType => {
  if (dirent.isSymbolicLink()) {
    return 'symlink';
  }
  if (dirent.isDirectory()) {
    return 'directory';
  }
  if (dirent.isFile()) {
    return 'file';
  }
  return 'other';
};

const listDirectory = async (context: ToolExecutionContext, input: LsInput) => {
  const absolute = resolveWorkspacePath(context.cwd, input.path ?? '.');
  const includeHidden = input.includeHidden ?? false;
  const recursive = input.recursive ?? false;
  const limit = input.maxEntries ?? 500;

  const queue: string[] = [absolute];
  const entries: EntrySummary[] = [];
  let truncated = false;

  while (queue.length > 0) {
    const current = queue.shift();
    if (!current) break;

    const dirEntries = await fs.readdir(current, { withFileTypes: true });
    for (const dirent of dirEntries) {
      if (!includeHidden && dirent.name.startsWith('.')) {
        continue;
      }

      const fullPath = path.join(current, dirent.name);
      const relative = relativeToWorkspace(context.cwd, fullPath);
      const entryType = detectEntryType(dirent);
      const summary: EntrySummary = {
        path: relative,
        type: entryType,
      };

      if (entryType === 'file') {
        const stat = await fs.stat(fullPath);
        summary.size = stat.size;
      }

      entries.push(summary);
      if (entries.length >= limit) {
        truncated = true;
        break;
      }

      if (recursive && dirent.isDirectory()) {
        queue.push(fullPath);
      }
    }

    if (truncated) {
      break;
    }
  }

  entries.sort((a, b) => a.path.localeCompare(b.path));

  return {
    basePath: absolute,
    entries,
    truncated,
    count: entries.length,
  };
};

interface RipgrepEvent {
  type: string;
  data: {
    path?: { text: string };
    lines?: { text: string };
    line_number?: number;
    submatches?: Array<{ match: { text: string }; start: number; end: number }>;
  };
}

interface GrepMatch {
  file: string;
  lineNumber: number;
  preview: string;
  submatches: Array<{ match: string; start: number; end: number }>;
}

const runRipgrep = async (context: ToolExecutionContext, input: GrepInput) => {
  const searchRoot = resolveWorkspacePath(context.cwd, input.path ?? '.');
  const args = [
    '--json',
    '--line-number',
    '--color',
    'never',
    '--with-filename',
  ];

  if (!(input.caseSensitive ?? true)) {
    args.push('--ignore-case');
  }

  if (!(input.regex ?? false)) {
    args.push('--fixed-strings');
  }

  if (input.contextLines && input.contextLines > 0) {
    args.push('-C', String(input.contextLines));
  }

  if (input.maxMatches) {
    args.push('-m', String(input.maxMatches));
  }

  for (const glob of input.globs ?? []) {
    args.push('-g', glob);
  }

  for (const ignore of input.ignores ?? []) {
    args.push('-g', `!${ignore}`);
  }

  args.push(input.pattern, searchRoot);

  let result: ProcessResult;
  try {
    result = await runProcess('rg', args, {
      cwd: context.cwd,
      env: context.env,
    });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      throw new Error('ripgrep (rg) is not installed on this system');
    }
    throw error;
  }

  if (result.exitCode !== 0 && result.exitCode !== 1) {
    throw new Error(
      `rg exited with code ${result.exitCode}. stderr: ${result.stderr.trim()}`
    );
  }

  const matches: GrepMatch[] = [];
  const lines = result.stdout.split('\n').filter((line) => line.trim().length > 0);

  for (const line of lines) {
    try {
      const event = JSON.parse(line) as RipgrepEvent;
      if (event.type === 'match' && event.data.path && event.data.lines && event.data.line_number) {
        matches.push({
          file: event.data.path.text,
          lineNumber: event.data.line_number,
          preview: event.data.lines.text.trimEnd(),
          submatches:
            event.data.submatches?.map((item) => ({
              match: item.match.text,
              start: item.start,
              end: item.end,
            })) ?? [],
        });
      }
    } catch {
      // ignore lines that fail to parse
    }
  }

  const stdoutSummary = summarizeText(result.stdout, {
    config: context.truncation.text,
  });
  const stderrTruncation = truncateTail(result.stderr, {
    maxBytes: context.truncation.command.maxBytes,
    indicator: context.truncation.command.tailIndicator,
  });

  return {
    command: ['rg', ...args],
    exitCode: result.exitCode,
    matches,
    stdout: stdoutSummary.value,
    stderr: stderrTruncation.value,
    truncated: {
      stdout: stdoutSummary.truncated,
      stderr: stderrTruncation.truncated ?? false,
    },
    durationMs: result.durationMs,
  };
};

const runBash = async (context: ToolExecutionContext, input: BashInput) => {
  const cwd = input.cwd
    ? resolveWorkspacePath(context.cwd, input.cwd)
    : context.cwd;

  const result = await runProcess(
    'bash',
    ['-lc', input.command],
    {
      cwd,
      env: context.env,
      stdin: input.stdin,
      timeoutMs: input.timeoutMs,
    }
  );

  const stdoutTruncation = truncateTail(result.stdout, {
    maxBytes: context.truncation.command.maxBytes,
    indicator: context.truncation.command.tailIndicator,
  });
  const stderrTruncation = truncateTail(result.stderr, {
    maxBytes: context.truncation.command.maxBytes,
    indicator: context.truncation.command.tailIndicator,
  });

  return {
    command: input.command,
    exitCode: result.exitCode,
    signal: result.signal,
    stdout: stdoutTruncation.value,
    stderr: stderrTruncation.value,
    truncated: {
      stdout: stdoutTruncation.truncated,
      stderr: stderrTruncation.truncated,
    },
    durationMs: result.durationMs,
    timedOut: result.timedOut,
  };
};

export const registerShellTools = (registry: ToolRegistry) => {
  registry.register({
    name: 'fs.ls',
    description: 'List files in a directory (optionally recursive) with size metadata',
    schema: LsInputSchema,
    handler: (input, context) => listDirectory(context, input),
  });

  registry.register({
    name: 'fs.grep',
    description: 'Search files using ripgrep. Outputs JSON matches plus truncated stdout/stderr.',
    schema: GrepInputSchema,
    handler: (input, context) => runRipgrep(context, input),
  });

  registry.register({
    name: 'shell.bash',
    description: 'Execute a bash command with stdout/stderr truncation.',
    schema: BashInputSchema,
    handler: (input, context) => runBash(context, input),
  });
};
