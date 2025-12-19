import chalk from 'chalk';
import * as Diff from 'diff';
import type { Message, TextContent, ThinkingContent } from '@marvin-agents/ai';
import { getLanguageFromPath, highlightCode as highlightCodeLines, replaceTabs } from '../syntax-highlighting.js';
import { colors } from './themes.js';

// Tool-specific colors
export const toolColors: Record<string, string> = {
  bash: '#98c379',   // green
  read: '#61afef',   // blue  
  write: '#e5c07b',  // yellow
  edit: '#c678dd',   // purple
};

export const textFromBlocks = (blocks: Array<{ type: string }>): string => {
  const parts: string[] = [];
  for (const block of blocks) {
    if (block.type === 'text') parts.push((block as TextContent).text);
  }
  return parts.join('');
};

export const renderMessage = (message: Message, includeThinking = true): string => {
  if (message.role === 'user') {
    if (typeof message.content === 'string') return message.content;
    return textFromBlocks(message.content);
  }

  if (message.role === 'assistant') {
    const parts: string[] = [];
    const dim = chalk.hex(colors.dimmed);
    
    for (const block of message.content) {
      if (block.type === 'text') {
        parts.push(block.text);
      } else if (block.type === 'thinking' && includeThinking) {
        const thinking = (block as ThinkingContent).thinking;
        if (thinking?.trim()) {
          // Render thinking with label
          const label = chalk.hex('#e5c07b')('Thinking: ');
          parts.push(label + dim.italic(thinking.trim()));
        }
      }
    }
    return parts.join('\n\n');
  }

  return textFromBlocks(message.content);
};

// Shorten path with ~ for home directory
export const shortenPath = (p: string): string => {
  const home = process.env.HOME || process.env.USERPROFILE || '';
  if (home && p.startsWith(home)) return '~' + p.slice(home.length);
  return p;
};

// Get text content from tool result
export const getToolText = (result: unknown): string => {
  if (!result || typeof result !== 'object') return String(result);
  const maybe = result as { content?: unknown };
  const content = Array.isArray(maybe.content) ? maybe.content : [];
  return textFromBlocks(content as Array<{ type: string }>);
};

// Get diff text from tool result details (edit tool)
export const getEditDiffText = (result: unknown): string | null => {
  if (!result || typeof result !== 'object') return null;
  const maybe = result as { details?: { diff?: string } };
  return maybe.details?.diff || null;
};

/**
 * Render a diff with word-level highlighting for 1:1 line changes.
 * Format expected: `+NN content`, `-NN content`, ` NN content`, ` NN ...`
 */
export const renderEditDiff = (diffText: string): string => {
  const dim = chalk.hex(colors.dimmed);
  const removedColor = chalk.hex('#bf616a');
  const addedColor = chalk.hex('#a3be8c');

  interface ParsedLine {
    type: '+' | '-' | ' ';
    prefix: string; // the "+NN " or "-NN " or " NN " part
    content: string;
    raw: string;
  }

  const lines = diffText.split('\n');
  const parsed: ParsedLine[] = [];

  // Parse each line into type, prefix, content
  for (const line of lines) {
    const normalized = replaceTabs(line);
    if (normalized.length === 0) {
      parsed.push({ type: ' ', prefix: '', content: '', raw: normalized });
      continue;
    }

    const firstChar = normalized[0];
    if (firstChar === '+' || firstChar === '-' || firstChar === ' ') {
      // Find end of line number portion (prefix includes the +/-/space and line number)
      // Format: "+NN " or "-NN " or " NN " where NN is padded line number
      const match = normalized.match(/^([+\- ])(\s*\d+\s)/);
      if (match) {
        const prefix = match[0];
        const content = normalized.slice(prefix.length);
        parsed.push({ type: firstChar as '+' | '-' | ' ', prefix, content, raw: normalized });
      } else {
        // Fallback for lines that don't match expected format (like "  ...")
        parsed.push({ type: firstChar as '+' | '-' | ' ', prefix: normalized, content: '', raw: normalized });
      }
    } else {
      parsed.push({ type: ' ', prefix: '', content: normalized, raw: normalized });
    }
  }

  // Render with word-level diffs for 1:1 removed/added pairs
  const output: string[] = [];
  let i = 0;

  while (i < parsed.length) {
    const line = parsed[i];

    // Look for consecutive removed lines followed by consecutive added lines
    if (line.type === '-') {
      const removedLines: ParsedLine[] = [];
      let j = i;
      while (j < parsed.length && parsed[j].type === '-') {
        removedLines.push(parsed[j]);
        j++;
      }

      const addedLines: ParsedLine[] = [];
      while (j < parsed.length && parsed[j].type === '+') {
        addedLines.push(parsed[j]);
        j++;
      }

      // If exactly 1 removed + 1 added: word-level diff
      if (removedLines.length === 1 && addedLines.length === 1) {
        const rm = removedLines[0];
        const add = addedLines[0];

        output.push(renderWordDiffLine(rm.prefix, rm.content, removedColor, add.content, false));
        output.push(renderWordDiffLine(add.prefix, add.content, addedColor, rm.content, true));
        i = j;
        continue;
      }

      // Otherwise: whole-line coloring
      for (const r of removedLines) {
        output.push(removedColor(r.raw));
      }
      for (const a of addedLines) {
        output.push(addedColor(a.raw));
      }
      i = j;
      continue;
    }

    // Context or other lines
    if (line.type === '+') {
      output.push(addedColor(line.raw));
    } else {
      output.push(dim(line.raw));
    }
    i++;
  }

  return output.join('\n');
};

/**
 * Render a single line with word-level diff highlighting.
 * Highlights tokens that differ from the comparison line using inverse.
 */
function renderWordDiffLine(
  prefix: string,
  content: string,
  baseColor: ReturnType<typeof chalk.hex>,
  compareContent: string,
  isAdded: boolean,
): string {
  // Extract leading whitespace to avoid inverting indentation
  const leadingMatch = content.match(/^(\s*)/);
  const leadingWs = leadingMatch ? leadingMatch[1] : '';
  const textContent = content.slice(leadingWs.length);

  const compareLeadingMatch = compareContent.match(/^(\s*)/);
  const compareLeadingWs = compareLeadingMatch ? compareLeadingMatch[1] : '';
  const compareTextContent = compareContent.slice(compareLeadingWs.length);

  // Get word-level diff
  const wordDiff = Diff.diffWords(compareTextContent, textContent);

  const parts: string[] = [];
  for (const part of wordDiff) {
    if (isAdded) {
      // For added line: highlight added parts
      if (part.added) {
        parts.push(baseColor.inverse(part.value));
      } else if (!part.removed) {
        parts.push(baseColor(part.value));
      }
    } else {
      // For removed line: highlight removed parts
      if (part.removed) {
        parts.push(baseColor.inverse(part.value));
      } else if (!part.added) {
        parts.push(baseColor(part.value));
      }
    }
  }

  return baseColor(prefix + leadingWs) + parts.join('');
}

const bashBadge = (cmd: string): string => {
  const first = cmd.trim().split(/\s+/)[0] || '';
  return { git: 'GIT', ls: 'LIST', fd: 'LIST', cat: 'READ', head: 'READ', tail: 'READ',
    rg: 'SEARCH', grep: 'SEARCH', npm: 'NPM', cargo: 'CARGO', bun: 'BUN' }[first] || 'RUN';
};

// Render tool header based on tool type
export const renderToolHeader = (toolName: string, args: any, isError: boolean = false): string => {
  const dim = chalk.hex(colors.dimmed);
  const text = chalk.hex(colors.text);
  const toolColor = chalk.hex(toolColors[toolName] || colors.code);
  
  switch (toolName) {
    case 'bash': {
      const cmd = args?.command || '...';
      const firstLine = cmd.split('\n')[0];
      const badge = bashBadge(cmd);
      const truncated = firstLine.length > 80 ? firstLine.slice(0, 77) + '...' : firstLine;
      return toolColor.bold(badge) + ' ' + dim(truncated);
    }
    case 'read': {
      const path = shortenPath(args?.path || args?.file_path || '');
      const offset = args?.offset;
      const limit = args?.limit;
      let range = '';
      if (offset || limit) {
        const start = offset || 1;
        const end = limit ? start + limit - 1 : '';
        range = dim(`:${start}${end ? `-${end}` : ''}`);
      }
      return toolColor.bold('read ') + text(path || '...') + range;
    }
    case 'write': {
      const path = shortenPath(args?.path || args?.file_path || '');
      const content = args?.content || '';
      const lines = content.split('\n').length;
      const lineInfo = lines > 1 ? dim(` (${lines} lines)`) : '';
      return toolColor.bold('write ') + text(path || '...') + lineInfo;
    }
    case 'edit': {
      const path = shortenPath(args?.path || args?.file_path || '');
      return toolColor.bold('edit ') + text(path || '...');
    }
    default:
      return toolColor.bold(toolName);
  }
};

// Render tool body based on tool type and result
export const renderToolBody = (toolName: string, args: any, result: unknown, isPartial: boolean): string => {
  const text = getToolText(result);
  const dim = chalk.hex(colors.dimmed);
  const output = chalk.hex('#c5c5c0'); // slightly brighter for output on dark bg
  
  switch (toolName) {
    case 'bash': {
      if (!text) return isPartial ? dim('...') : '';
      const lines = text.trim().split('\n');
      const total = lines.length;
      
      // Compact: show first 2 + last 3 lines max
      const headCount = 2;
      const tailCount = 3;
      const maxShow = headCount + tailCount;
      
      if (total <= maxShow) {
        return lines.map(l => output(l)).join('\n');
      }
      
      // Show head...tail with count
      const head = lines.slice(0, headCount);
      const tail = lines.slice(-tailCount);
      const skipped = total - maxShow;
      return [
        ...head.map(l => output(l)),
        dim(`  ... ${skipped} lines, Ctrl+O to expand ...`),
        ...tail.map(l => output(l)),
      ].join('\n');
    }
    case 'read': {
      // Just show line count, no content (too noisy)
      if (!text) return isPartial ? dim('reading...') : '';
      const lineCount = text.split('\n').length;
      return dim(`${lineCount} lines`);
    }
    case 'write': {
      const content = args?.content || '';
      if (!content) return isPartial ? dim('writing...') : '';

      const rawPath = args?.path || args?.file_path || '';
      const lang = getLanguageFromPath(rawPath);
      const normalized = replaceTabs(content);

      let lines: string[];
      let highlighted = false;
      if (lang) {
        try {
          lines = highlightCodeLines(normalized, lang);
          highlighted = true;
        } catch {
          lines = normalized.split('\n');
        }
      } else {
        lines = normalized.split('\n');
      }

      const renderLine = (line: string) => highlighted ? line : output(line);

      const maxLines = 8;
      const prefix = isPartial ? dim('Creating file:\n\n') : '';
      if (lines.length > maxLines) {
        const shown = lines.slice(0, maxLines);
        const remaining = lines.length - maxLines;
        return prefix + shown.map(renderLine).join('\n') + dim(`\n... ${remaining} more lines, Ctrl+O to expand`);
      }
      return prefix + lines.map(renderLine).join('\n');
    }
    case 'edit': {
      const diffText = getEditDiffText(result);
      if (diffText) return renderEditDiff(diffText);
      // Error case - show the error message
      if (text) return chalk.hex(colors.accent)(text);
      return isPartial ? dim('editing...') : '';
    }
    default: {
      // Generic: show args as JSON then result text
      const parts: string[] = [];
      if (args && Object.keys(args).length > 0) {
        parts.push(dim(JSON.stringify(args, null, 2)));
      }
      if (text) {
        parts.push(output(text));
      }
      return parts.join('\n\n') || (isPartial ? dim('...') : '');
    }
  }
};

// Full tool render
export const renderTool = (toolName: string, args: any, result: unknown, isError: boolean, isPartial: boolean): string => {
  // Read: single line, no body
  if (toolName === 'read') {
    const dim = chalk.hex(colors.dimmed);
    const text = chalk.hex(colors.text);
    const toolColor = chalk.hex(toolColors.read);
    const path = shortenPath(args?.path || args?.file_path || '');
    const content = getToolText(result);
    
    if (isPartial || !content) {
      return toolColor.bold('read') + ' ' + text(path);
    }
    const lineCount = content.split('\n').length;
    return toolColor.bold('read') + ' ' + text(path) + dim(` (${lineCount} lines)`);
  }
  
  const header = renderToolHeader(toolName, args, isError);
  const body = renderToolBody(toolName, args, result, isPartial);
  
  if (body) {
    return `${header}\n\n${body}`;
  }
  return header;
};

// Tool render with expand/collapse toggle for stored output
export const renderToolWithExpand = (
  toolName: string,
  args: any,
  fullOutput: string,
  expanded: boolean,
  editDiff?: string,
): string => {
  // Read: always single line, no expand
  if (toolName === 'read') {
    const dim = chalk.hex(colors.dimmed);
    const text = chalk.hex(colors.text);
    const toolColor = chalk.hex(toolColors.read);
    const path = shortenPath(args?.path || args?.file_path || '');
    const lineCount = fullOutput ? fullOutput.split('\n').length : 0;
    return toolColor.bold('read') + ' ' + text(path) + (lineCount ? dim(` (${lineCount} lines)`) : '');
  }

  const header = renderToolHeader(toolName, args);
  const dim = chalk.hex(colors.dimmed);
  const output = chalk.hex('#c5c5c0');

  // edit: always show diff (expanded or collapsed uses same diff rendering)
  if (toolName === 'edit' && editDiff) {
    return `${header}\n\n${renderEditDiff(editDiff)}`;
  }

  // write: show full content with syntax highlighting
  if (toolName === 'write') {
    const content = args?.content || '';
    if (!content) return header;

    const rawPath = args?.path || args?.file_path || '';
    const lang = getLanguageFromPath(rawPath);
    const normalized = replaceTabs(content);

    let lines: string[];
    let highlighted = false;
    if (lang) {
      try {
        lines = highlightCodeLines(normalized, lang);
        highlighted = true;
      } catch {
        lines = normalized.split('\n');
      }
    } else {
      lines = normalized.split('\n');
    }

    const renderLine = (line: string) => (highlighted ? line : output(line));

    if (expanded) {
      // Show full content
      return `${header}\n\n${lines.map(renderLine).join('\n')}`;
    } else {
      // Show collapsed with hint
      const maxLines = 8;
      if (lines.length > maxLines) {
        const shown = lines.slice(0, maxLines);
        const remaining = lines.length - maxLines;
        return `${header}\n\n${shown.map(renderLine).join('\n')}${dim(`\n... ${remaining} more lines, Ctrl+O to expand`)}`;
      }
      return `${header}\n\n${lines.map(renderLine).join('\n')}`;
    }
  }

  // Default behavior for other tools (bash, etc.)
  if (!fullOutput) return header;

  const lines = fullOutput.trim().split('\n');
  const maxLines = toolName === 'bash' ? 25 : 15;

  if (expanded || lines.length <= maxLines) {
    // Show full output
    return `${header}\n\n${lines.map((l) => output(l)).join('\n')}`;
  } else {
    // Show collapsed with hint
    const skipped = lines.length - maxLines;
    const shown = lines.slice(-maxLines);
    return `${header}\n\n${dim(`... (${skipped} earlier lines, Ctrl+O to expand)\n`)}${shown.map((l) => output(l)).join('\n')}`;
  }
};
