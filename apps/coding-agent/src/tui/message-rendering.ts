import chalk from 'chalk';
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

export const renderEditDiff = (diffText: string): string => {
  const dim = chalk.hex(colors.dimmed);
  const removed = chalk.hex('#bf616a');
  const added = chalk.hex('#a3be8c');

  return diffText
    .split('\n')
    .map((line) => {
      const normalized = replaceTabs(line);
      if (normalized.startsWith('+')) return added(normalized);
      if (normalized.startsWith('-')) return removed(normalized);
      return dim(normalized);
    })
    .join('\n');
};

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
      
      // Compact: show first 3 + last 5 lines max
      const headCount = 3;
      const tailCount = 5;
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
        dim(`  ... ${skipped} lines ...`),
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

      const maxLines = 15;
      const prefix = isPartial ? dim('Creating file:\n\n') : '';
      if (lines.length > maxLines) {
        const shown = lines.slice(0, maxLines);
        const remaining = lines.length - maxLines;
        return prefix + shown.map(renderLine).join('\n') + dim(`\n... (${remaining} more lines)`);
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
export const renderToolWithExpand = (toolName: string, args: any, fullOutput: string, expanded: boolean): string => {
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
  
  if (!fullOutput) return header;
  
  const lines = fullOutput.trim().split('\n');
  const maxLines = toolName === 'bash' ? 25 : 15;
  
  if (expanded || lines.length <= maxLines) {
    // Show full output
    return `${header}\n\n${lines.map(l => output(l)).join('\n')}`;
  } else {
    // Show collapsed with hint
    const skipped = lines.length - maxLines;
    const shown = lines.slice(-maxLines);
    return `${header}\n\n${dim(`... (${skipped} earlier lines, Ctrl+O to expand)\n`)}${shown.map(l => output(l)).join('\n')}`;
  }
};
