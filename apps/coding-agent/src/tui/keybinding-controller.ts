import type { Component, Editor } from '@marvin-agents/tui';

export interface KeybindingHandlers {
  onCtrlC: () => void;
  onEscape: () => boolean;
  onCtrlO: () => void;
  onCtrlP: () => void;
  onShiftTab: () => void;
}

export class FocusProxy implements Component {
  constructor(
    private readonly editor: Editor,
    private readonly handlers: KeybindingHandlers,
  ) {}

  render(width: number): string[] {
    return this.editor.render(width);
  }

  invalidate(): void {
    this.editor.invalidate();
  }

  handleInput(data: string): void {
    const code = data.charCodeAt(0);
    
    // Ctrl+C
    if (code === 3) {
      this.handlers.onCtrlC();
      return;
    }

    // Ctrl+O (toggle tool output)
    if (code === 15) {
      this.handlers.onCtrlO();
      return;
    }

    // Ctrl+P (cycle models)
    if (code === 16) {
      this.handlers.onCtrlP();
      return;
    }

    // Shift+Tab (cycle thinking)
    if (data === '\x1b[Z') {
      this.handlers.onShiftTab();
      return;
    }

    if (data === '\x1b') {
      const handled = this.handlers.onEscape();
      if (handled) return;
    }

    this.editor.handleInput?.(data);
  }
}
