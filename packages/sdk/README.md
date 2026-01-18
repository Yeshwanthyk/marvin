# @marvin-agents/sdk

Headless SDK for running Marvin agents using the Effect runtime.

## Installation

```bash
npm install @marvin-agents/sdk
```

## Usage

```typescript
import { runAgent } from "@marvin-agents/sdk";

const result = await runAgent({ prompt: "Hello", cwd: process.cwd() });
```

## License

MIT
