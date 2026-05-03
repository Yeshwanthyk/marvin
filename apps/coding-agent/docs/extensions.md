> Marvin can create extensions. Ask it to read this file and build one for your use case.

# Extensions

Extensions are TypeScript modules that extend Marvin at runtime. Marvin supports its native hook API and the Pi-compatible extension API used by packages that declare `package.json` `pi.extensions`.

## Locations

Marvin discovers extensions from:

| Location | Scope |
| --- | --- |
| `~/.config/marvin/extensions/*.ts` | Global |
| `~/.config/marvin/extensions/*/index.ts` | Global package-style directories |
| `.marvin/extensions/*.ts` | Project-local |
| `.marvin/extensions/*/index.ts` | Project-local package-style directories |
| `.pi/extensions/*.ts` | Pi-compatible project extensions |
| `.pi/extensions/*/index.ts` | Pi-compatible project package-style directories |

You can also pass extensions explicitly:

```bash
marvin --extension ./my-extension.ts
marvin -e ./my-package
marvin -e npm-package-unpacked-dir
```

Set config paths in `~/.config/marvin/config.json`:

```json
{
  "extensions": ["./local-extension.ts", "./local-package"],
  "extensionsEnabled": true
}
```

Disable discovery with `--no-extensions`.

## Pi-Compatible Quick Start

Create `.pi/extensions/hello.ts`:

```typescript
import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { Type } from "typebox";

export default function (pi: ExtensionAPI) {
  pi.on("session_start", async (_event, ctx) => {
    ctx.ui.notify("hello extension loaded", "info");
  });

  pi.registerTool({
    name: "hello_name",
    label: "Hello Name",
    description: "Return a greeting for a name",
    parameters: Type.Object({
      name: Type.String({ description: "Name to greet" }),
    }),
    async execute(_toolCallId, params) {
      return {
        content: [{ type: "text", text: `Hello, ${params.name}!` }],
        details: {},
      };
    },
  });

  pi.registerCommand("hello", {
    description: "Show a greeting",
    handler: async (args, ctx) => {
      ctx.ui.notify(`Hello ${args.trim() || "world"}`, "info");
    },
  });
}
```

Run:

```bash
marvin -e .pi/extensions/hello.ts
```

## Package Manifests

Marvin reads the Pi manifest from `package.json`:

```json
{
  "name": "my-marvin-extension",
  "type": "module",
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

If no manifest is present, Marvin looks for `index.ts`, `index.js`, or direct `.ts`/`.js` files in the directory.

## Supported Pi API Surface

Marvin supports the core API used by common Pi extensions:

- `pi.on("session_start" | "session_resume" | "session_tree" | "session_clear" | "session_shutdown", handler)`
- native Marvin event names such as `session.start`, `agent.start`, `turn.end`, `tool.execute.before`, `tool.execute.after`
- `pi.registerTool({ name, label, description, parameters, execute })`
- `pi.registerCommand(name, { description, handler })`
- `pi.registerShortcut(key, { description, handler })`
- `pi.registerMessageRenderer(customType, renderer)`
- `pi.send(text)`, `pi.sendUserMessage(text, options)`, `pi.steer(text)`, `pi.followUp(text)`
- `pi.sendMessage(message, { triggerTurn })`
- `pi.appendEntry(customType, data)`

Extension handlers receive `ctx` with:

- `cwd`, `configDir`, `sessionId`, `sessionManager`, `model`
- `exec(command, args, options)` and `execInteractive(command, args)`
- `ui.select`, `ui.confirm`, `ui.input`, `ui.editor`, `ui.notify`, `ui.custom`
- `ui.setWidget`, `ui.setEditorText`, `ui.getEditorText`
- `session.summarize`, `session.toast`, `session.getTokenUsage`, `session.getContextLimit`, `session.complete`

Some Pi UI methods degrade gracefully in Marvin. `registerShortcut` records compatibility and avoids load failures; full global shortcut dispatch is not yet a stable contract.

## Tool Results

Use Pi-style results:

```typescript
return {
  content: [{ type: "text", text: "result text" }],
  details: { count: 1 },
};
```

Use `onUpdate` for progress:

```typescript
onUpdate?.({
  content: [{ type: "text", text: "Working..." }],
  details: { phase: "start" },
});
```

Throw to signal tool failure. Returning `isError` is preserved in details but does not replace throwing for control flow.

## Imports

Pi-compatible imports are resolved for extension packages:

| Import | Use |
| --- | --- |
| `@mariozechner/pi-coding-agent` | Extension types |
| `@mariozechner/pi-ai` | Model helpers, `complete`, `StringEnum`, TypeBox helpers |
| `@mariozechner/pi-tui` | Lightweight TUI rendering compatibility |
| `typebox` | Tool parameter schemas |

Runtime dependencies belong in package `dependencies`. Install them next to the package before loading a local unpacked package:

```bash
npm install --prefix ./my-package
marvin -e ./my-package
```

## Native Marvin Events

Native event names remain available for Marvin-specific extensions:

- `app.start`
- `session.start`, `session.resume`, `session.clear`, `session.shutdown`
- `agent.before_start`, `agent.start`, `agent.end`
- `turn.start`, `turn.end`
- `tool.execute.before`, `tool.execute.after`
- `chat.message`, `chat.messages.transform`, `chat.system.transform`, `chat.params`
- `auth.get`, `model.resolve`

Prefer Pi-compatible event names when writing packages intended to run in both Pi and Marvin.
