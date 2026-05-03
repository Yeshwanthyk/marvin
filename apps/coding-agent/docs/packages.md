> Marvin can bundle extensions into Pi-compatible packages. Ask it to read this file when creating one.

# Extension Packages

Marvin loads local package directories that declare resources with a Pi manifest. This lets one package work in Pi and Marvin.

## Minimal Package

```
my-web-tools/
├── package.json
└── index.ts
```

`package.json`:

```json
{
  "name": "my-web-tools",
  "version": "0.1.0",
  "type": "module",
  "keywords": ["pi-package", "marvin-extension"],
  "dependencies": {
    "typebox": "^1.0.0"
  },
  "peerDependencies": {
    "@mariozechner/pi-coding-agent": "*",
    "@mariozechner/pi-ai": "*",
    "@mariozechner/pi-tui": "*"
  },
  "pi": {
    "extensions": ["./index.ts"]
  }
}
```

`index.ts`:

```typescript
import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";

export default function (pi: ExtensionAPI) {
  pi.registerCommand("ping", {
    description: "Show package status",
    handler: async (_args, ctx) => {
      ctx.ui.notify("pong", "info");
    },
  });
}
```

Run locally:

```bash
npm install --prefix ./my-web-tools
marvin -e ./my-web-tools
```

Install into Marvin:

```bash
marvin install npm:pi-web-access
marvin install github:owner/repo
marvin install owner/repo@ref
```

Persist in `~/.config/marvin/config.json`:

```json
{
  "extensions": ["./my-web-tools"]
}
```

## Manifest Rules

Marvin reads:

```json
{
  "pi": {
    "extensions": ["./index.ts", "./extensions"]
  }
}
```

Paths are relative to the package root. Directories load `index.ts`, `index.js`, or direct `.ts`/`.js` modules.

If there is no manifest, Marvin falls back to:

- `index.ts`
- `index.js`
- direct `.ts` and `.js` files
- child directories with `index.ts` or `index.js`

## Dependencies

Put runtime dependencies in `dependencies`. Do not rely on `devDependencies` at runtime.

For Pi core imports, use peer dependencies with `"*"`:

```json
{
  "peerDependencies": {
    "@mariozechner/pi-coding-agent": "*",
    "@mariozechner/pi-ai": "*",
    "@mariozechner/pi-tui": "*"
  }
}
```

Marvin provides compatibility shims for those names while loading extensions. That is why packages such as `pi-web-access` can load without changing their source imports.

## Security

Packages execute arbitrary TypeScript with the user’s permissions. Review package source and lock versions before sharing a config with a team.

## Current Scope

Marvin supports extension package loading, Pi-compatible extension APIs, and `marvin install` for npm/GitHub extension packages. It does not yet implement update/remove/config package commands or skill/theme/prompt resource loading from packages. Use local paths with `--extension` or config `extensions` when you do not want Marvin to manage the install path.
