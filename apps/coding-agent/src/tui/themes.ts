import chalk from 'chalk';
import type { MarkdownTheme, EditorTheme } from '@marvin-agents/tui';
import { highlightCode as highlightCodeLines, replaceTabs } from '../syntax-highlighting.js';

// Clean, readable palette
export const colors = {
  text: '#d4d4d4',      // clean light gray (easier to read)
  dimmed: '#707070',    // muted gray
  accent: '#e06c75',    // soft red
  code: '#98c379',      // soft green
  border: '#3e3e3e',    // subtle border
};

export const markdownTheme: MarkdownTheme = {
  heading: (text) => chalk.hex('#e5e5e5').bold(text),
  link: (text) => chalk.hex('#61afef')(text),            // soft blue
  linkUrl: (text) => chalk.hex(colors.dimmed)(text),
  code: (text) => chalk.hex('#e5c07b')(text),            // warm yellow
  codeBlock: (text) => chalk.hex('#abb2bf')(text),       // muted for code
  codeBlockBorder: (text) => chalk.hex(colors.border)(text),
  quote: (text) => chalk.hex('#abb2bf').italic(text),
  quoteBorder: (text) => chalk.hex(colors.border)(text),
  hr: (text) => chalk.hex(colors.border)(text),
  listBullet: (text) => chalk.hex(colors.dimmed)(text),
  bold: (text) => chalk.hex('#e5e5e5').bold(text),
  italic: (text) => chalk.italic(text),
  strikethrough: (text) => chalk.strikethrough(text),
  underline: (text) => chalk.underline(text),
  highlightCode: (code, lang) => {
    try {
      return highlightCodeLines(replaceTabs(code), lang);
    } catch {
      return replaceTabs(code).split('\n').map((line) => chalk.hex('#abb2bf')(line));
    }
  },
};

export const editorTheme: EditorTheme = {
  borderColor: (text) => chalk.hex(colors.border)(text),
  selectList: {
    selectedPrefix: (text) => chalk.hex(colors.accent)(text),
    selectedText: (text) => chalk.hex(colors.text).bold(text),
    description: (text) => chalk.hex(colors.dimmed)(text),
    scrollInfo: (text) => chalk.hex(colors.dimmed)(text),
    noMatch: (text) => chalk.hex(colors.dimmed)(text),
  },
};
