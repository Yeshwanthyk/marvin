# `@mu-agents/tui-lite`

Minimal, Bun-friendly TUI building blocks:

- A small **render model** (`Span`/`Line`/`Widget`) that’s **not terminal-specific**
- An **ANSI renderer** (`renderLineToAnsi`) + **line-diff writer** (`diffAnsiScreens`)
- Bun/Node-compatible **process terminal adapter** (`ProcessTerminal`)
- Widgets: `Text`, `TruncatedText`, `MarkdownLite`, `Input`, `StatusBar`
- Git branch watching via `.git/HEAD` (`GitBranchWatcher`)

## Extension points

- **New widgets**: implement `Widget` and return `RenderResult` (`Line[]` of styled `Span`s).
- **Alternative renderers**: consume `RenderResult.lines` directly (e.g. React/Ink, web canvas, native UI). The ANSI layer is just one renderer.
- **Alternative terminals**: implement `Terminal` (useful for tests or embedding into another UI shell).
- **Custom diff strategy**: swap `diffAnsiScreens` if you need region-based diffs, cursor tracking, or scrollback.

## Example (status bar + input)

```ts
import { ProcessTerminal, Tui, KeyReader, Input, StatusBar, StatusBarModel } from '@mu-agents/tui-lite';

const terminal = new ProcessTerminal();
const input = new Input({ prompt: '> ' });
const status = new StatusBar({
  model: new StatusBarModel({ cwd: process.cwd(), branch: undefined }),
});

const app = new Tui(terminal, { main: input, status });
const keys = new KeyReader(terminal);

app.start();
keys.start((key) => {
  input.handleKey(key);
  app.render();
});
```

