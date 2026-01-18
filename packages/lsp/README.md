# @marvin-agents/lsp

LSP integration for AI coding agents. Provides real-time diagnostics from language servers.

## Installation

```bash
npm install @marvin-agents/lsp
```

## Usage

```typescript
import { createLspManager, wrapToolsWithLspDiagnostics } from "@marvin-agents/lsp";

const lsp = createLspManager({ cwd: process.cwd(), enabled: true });
const tools = wrapToolsWithLspDiagnostics(baseTools, lsp, { cwd: process.cwd() });
```

## License

MIT
