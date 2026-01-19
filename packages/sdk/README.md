# @yeshwanthyk/sdk

Headless SDK for running Marvin agents using the Effect runtime.

## Installation

```bash
npm install @yeshwanthyk/sdk
```

## Usage

```typescript
import { runAgent } from "@yeshwanthyk/sdk";

const result = await runAgent({ prompt: "Hello", cwd: process.cwd() });
```

## License

MIT
