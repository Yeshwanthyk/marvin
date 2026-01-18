# @marvin-agents/base-tools

Core file system and shell tools for AI coding agents.

## Tools

- **read** — Read file contents (text and images)
- **write** — Write content to files
- **edit** — Surgical text replacement
- **bash** — Execute shell commands

## Installation

```bash
npm install @marvin-agents/base-tools
```

## Usage

```typescript
import { createToolRegistry, createReadTool } from "@marvin-agents/base-tools";

const cwd = process.cwd();

const registry = createToolRegistry(cwd);
const readTool = await registry.read.load();

const directReadTool = createReadTool(cwd);

const result = await readTool.execute("id", { path: "./file.ts" });
```

## License

MIT
