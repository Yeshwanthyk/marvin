# @yeshwanthyk/lsp

LSP integration for AI coding agents. Provides real-time diagnostics from language servers.

## Installation

```bash
npm install @yeshwanthyk/lsp
```

## Usage

```typescript
import { createLspManager, wrapToolsWithLspDiagnostics } from "@yeshwanthyk/lsp";

const lsp = createLspManager({ cwd: process.cwd(), enabled: true });
const tools = wrapToolsWithLspDiagnostics(baseTools, lsp, { cwd: process.cwd() });
```

## License

MIT
