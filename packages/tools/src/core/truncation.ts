export interface TruncationResult {
  value: string;
  truncated: boolean;
  omittedBytes: number;
  indicator?: string;
}

export interface LineTruncationResult extends TruncationResult {
  omittedLines: number;
}

export interface TruncateBytesOptions {
  maxBytes: number;
  indicator?: string;
  encoding?: BufferEncoding;
}

export interface TruncateLinesOptions {
  maxLines: number;
  indicator?: string;
  position?: 'head' | 'tail';
}

const DEFAULT_HEAD_INDICATOR = '\n--- (output truncated: head) ---\n';
const DEFAULT_TAIL_INDICATOR = '\n--- (output truncated: tail) ---\n';
const DEFAULT_LINE_INDICATOR = '\n--- (additional lines truncated) ---\n';

const clampMax = (value: number): number => {
  if (!Number.isFinite(value) || value <= 0) {
    return 0;
  }

  return Math.floor(value);
};

export const truncateTail = (value: string, options: TruncateBytesOptions): TruncationResult => {
  const maxBytes = clampMax(options.maxBytes);
  const encoding = options.encoding ?? 'utf8';

  if (maxBytes === 0) {
    return {
      value: '',
      truncated: value.length > 0,
      omittedBytes: Buffer.byteLength(value, encoding),
      indicator: options.indicator ?? DEFAULT_TAIL_INDICATOR,
    };
  }

  const buffer = Buffer.from(value, encoding);
  if (buffer.byteLength <= maxBytes) {
    return { value, truncated: false, omittedBytes: 0 };
  }

  const truncatedBuffer = buffer.subarray(0, maxBytes);
  const indicator = options.indicator ?? DEFAULT_TAIL_INDICATOR;

  return {
    value: `${truncatedBuffer.toString(encoding)}${indicator}`,
    truncated: true,
    omittedBytes: buffer.byteLength - truncatedBuffer.byteLength,
    indicator,
  };
};

export const truncateHead = (value: string, options: TruncateBytesOptions): TruncationResult => {
  const maxBytes = clampMax(options.maxBytes);
  const encoding = options.encoding ?? 'utf8';

  if (maxBytes === 0) {
    return {
      value: '',
      truncated: value.length > 0,
      omittedBytes: Buffer.byteLength(value, encoding),
      indicator: options.indicator ?? DEFAULT_HEAD_INDICATOR,
    };
  }

  const buffer = Buffer.from(value, encoding);
  if (buffer.byteLength <= maxBytes) {
    return { value, truncated: false, omittedBytes: 0 };
  }

  const indicator = options.indicator ?? DEFAULT_HEAD_INDICATOR;
  const startIndex = buffer.byteLength - maxBytes;
  const truncatedBuffer = buffer.subarray(startIndex);

  return {
    value: `${indicator}${truncatedBuffer.toString(encoding)}`,
    truncated: true,
    omittedBytes: startIndex,
    indicator,
  };
};

export const truncateLines = (
  value: string,
  options: TruncateLinesOptions
): LineTruncationResult => {
  const maxLines = clampMax(options.maxLines);
  if (maxLines === 0) {
    const lines = value.length > 0 ? value.split(/\r?\n/u).length : 0;
    return {
      value: '',
      truncated: lines > 0,
      omittedBytes: Buffer.byteLength(value, 'utf8'),
      omittedLines: lines,
      indicator: options.indicator ?? DEFAULT_LINE_INDICATOR,
    };
  }

  const normalized = value.split(/\r?\n/u);
  if (normalized.length <= maxLines) {
    return {
      value,
      truncated: false,
      omittedBytes: 0,
      omittedLines: 0,
    };
  }

  const indicator = options.indicator ?? DEFAULT_LINE_INDICATOR;
  const position = options.position ?? 'tail';
  if (position === 'head') {
    const sliced = normalized.slice(normalized.length - maxLines).join('\n');
    const removed = normalized.length - maxLines;
    return {
      value: `${indicator}${sliced}`,
      truncated: true,
      omittedBytes: Buffer.byteLength(value, 'utf8') - Buffer.byteLength(sliced, 'utf8'),
      omittedLines: removed,
      indicator,
    };
  }

  const sliced = normalized.slice(0, maxLines).join('\n');
  const removed = normalized.length - maxLines;
  return {
    value: `${sliced}${indicator}`,
    truncated: true,
    omittedBytes: Buffer.byteLength(value, 'utf8') - Buffer.byteLength(sliced, 'utf8'),
    omittedLines: removed,
    indicator,
  };
};

export interface TextTruncationConfig {
  maxBytes: number;
  maxLines: number;
  headIndicator: string;
  tailIndicator: string;
  lineIndicator: string;
}

export interface CommandTruncationConfig {
  maxBytes: number;
  tailIndicator: string;
}

export interface ToolTruncationConfig {
  text: TextTruncationConfig;
  command: CommandTruncationConfig;
}

export const DEFAULT_TRUNCATION_CONFIG: ToolTruncationConfig = {
  text: {
    maxBytes: 32_768,
    maxLines: 400,
    headIndicator: DEFAULT_HEAD_INDICATOR,
    tailIndicator: DEFAULT_TAIL_INDICATOR,
    lineIndicator: DEFAULT_LINE_INDICATOR,
  },
  command: {
    maxBytes: 65_536,
    tailIndicator: '\n--- (command output truncated) ---\n',
  },
};

export interface SummarizeTextOptions {
  maxBytes?: number;
  maxLines?: number;
  config?: TextTruncationConfig;
}

export interface TextSummary {
  value: string;
  truncated: boolean;
  omittedBytes: number;
  omittedLines: number;
}

export const summarizeText = (
  value: string,
  options: SummarizeTextOptions = {}
): TextSummary => {
  const config = options.config ?? DEFAULT_TRUNCATION_CONFIG.text;
  const byteLimit = clampMax(options.maxBytes ?? config.maxBytes);
  const lineLimit = clampMax(options.maxLines ?? config.maxLines);

  let summaryValue = value;
  let truncated = false;
  let omittedBytes = 0;

  if (byteLimit > 0) {
    const result = truncateTail(summaryValue, {
      maxBytes: byteLimit,
      indicator: config.tailIndicator,
    });
    summaryValue = result.value;
    truncated ||= result.truncated;
    omittedBytes = result.omittedBytes;
  }

  let omittedLines = 0;
  if (lineLimit > 0) {
    const result = truncateLines(summaryValue, {
      maxLines: lineLimit,
      indicator: config.lineIndicator,
    });
    summaryValue = result.value;
    truncated ||= result.truncated;
    omittedLines = result.omittedLines;
  }

  return {
    value: summaryValue,
    truncated,
    omittedBytes,
    omittedLines,
  };
};
