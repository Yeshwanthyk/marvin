import { StrictObject } from '@mu-agents/types';
import { Type } from '@sinclair/typebox';
import type { Static } from '@sinclair/typebox';
import { promises as fs } from 'node:fs';
import path from 'node:path';

import type { ToolRegistry } from '../core/tool-registry';
import type { ToolExecutionContext } from '../core/tool-registry';
import { summarizeText } from '../core/truncation';
import { resolveWorkspacePath } from '../core/paths';
import { writeFileAtomic, writeTempFile } from '../core/temp-files';

const EncodingSchema = Type.Union([Type.Literal('utf8'), Type.Literal('base64')], {
  default: 'utf8',
});

const FsReadInputSchema = StrictObject({
  path: Type.String({ description: 'Path to read relative to the registry cwd' }),
  encoding: Type.Optional(EncodingSchema),
  maxBytes: Type.Optional(Type.Integer({ minimum: 1 })),
  maxLines: Type.Optional(Type.Integer({ minimum: 1 })),
});

const WriteModeSchema = Type.Union(
  [Type.Literal('overwrite'), Type.Literal('append')],
  { default: 'overwrite' }
);

const FsWriteInputSchema = StrictObject({
  path: Type.String({ description: 'Target file to write' }),
  content: Type.String({ description: 'Raw text payload' }),
  encoding: Type.Optional(EncodingSchema),
  mode: Type.Optional(WriteModeSchema),
  createDirectories: Type.Optional(Type.Boolean({ default: true })),
  ensureTrailingNewline: Type.Optional(Type.Boolean({
    description: 'Append a newline if the payload does not end with one',
    default: false,
  })),
});

const EditOperationSchema = StrictObject({
  find: Type.String({ minLength: 1, description: 'Exact snippet that must exist in the file' }),
  replace: Type.String({ description: 'Replacement snippet (can be empty)' }),
  occurrence: Type.Optional(
    Type.Integer({
      minimum: 1,
      description: 'Which occurrence to replace (defaults to first)',
    })
  ),
});

const FsEditInputSchema = StrictObject({
  path: Type.String({ description: 'File to mutate' }),
  encoding: Type.Optional(EncodingSchema),
  operations: Type.Array(EditOperationSchema, {
    minItems: 1,
    description: 'Sequential replacements applied in order',
  }),
  saveBackup: Type.Optional(
    Type.Boolean({
      default: true,
      description: 'Persist the original file contents to a temp file before editing',
    })
  ),
});

type FsReadInput = Static<typeof FsReadInputSchema>;
type FsWriteInput = Static<typeof FsWriteInputSchema>;
type FsEditInput = Static<typeof FsEditInputSchema>;

const ensureNewline = (value: string, enabled: boolean): string => {
  if (!enabled || value.endsWith('\n')) {
    return value;
  }

  return `${value}\n`;
};

const applyOperation = (content: string, operation: FsEditInput['operations'][number]) => {
  const { find, replace } = operation;
  const occurrence = operation.occurrence ?? 1;
  let idx = -1;
  let searchIndex = 0;
  for (let count = 0; count < occurrence; count += 1) {
    idx = content.indexOf(find, searchIndex);
    if (idx === -1) {
      break;
    }
    searchIndex = idx + find.length;
  }

  if (idx === -1) {
    throw new Error(`Unable to locate snippet "${find}" (occurrence ${occurrence})`);
  }

  return content.slice(0, idx) + replace + content.slice(idx + find.length);
};

const resolveEncoding = (encoding?: FsReadInput['encoding']): BufferEncoding =>
  encoding === 'base64' ? 'base64' : 'utf8';

const readFile = async (context: ToolExecutionContext, input: FsReadInput) => {
  const encoding = resolveEncoding(input.encoding);
  const absolutePath = resolveWorkspacePath(context.cwd, input.path);
  const raw = await fs.readFile(absolutePath, encoding);
  const summary = summarizeText(raw, {
    config: context.truncation.text,
    maxBytes: input.maxBytes,
    maxLines: input.maxLines,
  });

  return {
    path: absolutePath,
    encoding,
    byteLength: Buffer.byteLength(raw, encoding),
    content: summary.value,
    truncated: summary.truncated,
    omittedBytes: summary.omittedBytes,
    omittedLines: summary.omittedLines,
  };
};

const writeFile = async (context: ToolExecutionContext, input: FsWriteInput) => {
  const encoding = resolveEncoding(input.encoding);
  const absolutePath = resolveWorkspacePath(context.cwd, input.path);
  const payload = ensureNewline(input.content, input.ensureTrailingNewline ?? false);

  if (input.createDirectories ?? true) {
    await fs.mkdir(path.dirname(absolutePath), { recursive: true });
  }

  if (input.mode === 'append') {
    await fs.appendFile(absolutePath, payload, { encoding });
  } else {
    await writeFileAtomic(absolutePath, payload, { encoding });
  }

  return {
    path: absolutePath,
    encoding,
    bytesWritten: Buffer.byteLength(payload, encoding),
    mode: input.mode ?? 'overwrite',
  };
};

const editFile = async (context: ToolExecutionContext, input: FsEditInput) => {
  const encoding = resolveEncoding(input.encoding);
  const absolutePath = resolveWorkspacePath(context.cwd, input.path);
  const original = await fs.readFile(absolutePath, encoding);

  let mutated = original;
  for (const operation of input.operations) {
    mutated = applyOperation(mutated, operation);
  }

  let backupPath: string | undefined;
  if (input.saveBackup ?? true) {
    const base = `${path.basename(absolutePath)}.bak`;
    backupPath = await writeTempFile(base, original, { encoding, tmpDir: context.tmpDir });
  }

  await writeFileAtomic(absolutePath, mutated, { encoding });

  return {
    path: absolutePath,
    operations: input.operations.length,
    backupPath,
    changed: mutated !== original,
  };
};

export const registerFsTools = (registry: ToolRegistry) => {
  registry.register({
    name: 'fs.read',
    description: 'Read a UTF-8/base64 file from disk with truncation safeguards',
    schema: FsReadInputSchema,
    handler: (input, context) => readFile(context, input),
  });

  registry.register({
    name: 'fs.write',
    description: 'Write or append UTF-8/base64 content to disk using atomic renames',
    schema: FsWriteInputSchema,
    handler: (input, context) => writeFile(context, input),
  });

  registry.register({
    name: 'fs.edit',
    description:
      'Apply search-and-replace operations to a file. Each snippet must exist and is replaced sequentially.',
    schema: FsEditInputSchema,
    handler: (input, context) => editFile(context, input),
  });
};
