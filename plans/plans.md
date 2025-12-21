# Marvin extensibility (minimal): slash commands, hooks, tools

Goal: add *local* extensibility that feels instantaneous (load-once, no watchers, small surfaces) while staying TS-typed for authoring.

## Research distillation

### Slash commands

**pi-mono**
- Source: `~/.pi/agent/commands/` + `./.pi/commands/`.
- Markdown files become commands; optional frontmatter for metadata.
- Expansion supports `$@` + `$1..$N`; args parsing handles quotes.
- Loader is file-system based; run-time expansion is just string substitution.

**opencode**
- Source: `~/.config/opencode/command/` + `./.opencode/command/` (plus JSON config).
- Markdown + frontmatter; supports `$ARGUMENTS` + `$1..$N`.
- Also supports shell injection (`!\`cmd\``) and file references (`@path`) inside templates.
- Can override built-ins (explicitly supported).

**Marvin today**
- Built-in slash commands are hard-coded (`apps/coding-agent/src/commands.ts`).
- Autocomplete is hard-coded (`apps/coding-agent/src/autocomplete-commands.ts`).
- No file-backed commands.

### Hooks

**pi-mono**
- Local TS hook modules loaded via `jiti` with aliasing.
- Hook author API is `pi.on(event, handler)` with a typed event union + `ctx` (`exec`, `ui`, etc).
- Tool interception is implemented by wrapping `AgentTool.execute`.

**opencode**
- Plugin modules return a typed `Hooks` table (string-literal hook keys).
- Central `Plugin.trigger(name, input, output)` calls hooks in order; output is mutated.
- Plugins can also register tools; hook keys include `tool.execute.before/after`, `chat.params`, etc.

**Marvin today**
- Agent lifecycle events exist as `AgentEvent` (`packages/agent/src/types.ts`).
- App already subscribes to those events for UI (`apps/coding-agent/src/agent-events.ts`).
- No hook runtime.

### Personal / external tools

**pi-mono**
- Loads custom tools from `~/.pi/agent/tools/*/index.ts` + project-local.
- Tools are TS modules; conflict detection; optional UI rendering.

**opencode**
- Tools can be provided by plugins (`Hooks.tool`).

**Marvin today**
- Built-in tools only (`read|bash|edit|write` from `packages/base-tools/src/index.ts`).

---

## Design nodes (Marvin, minimal)

- **Load once** at startup (TUI + headless). No FS watchers/hot reload.
- **Single config root**: `~/.config/marvin/` (already exists).
  - Commands: `~/.config/marvin/commands/`
  - Hooks: `~/.config/marvin/hooks/`
  - Tools: `~/.config/marvin/tools/`
- **Non-goals v1**: opencode-style `@file` include + `!\`cmd\`` injection, command overrides, nested categories, per-command model/agent overrides, UI-heavy hook prompts.
- **Error policy**: load failures are non-fatal; surface once in UI (system message) and via stderr in headless.

---

## Plan 1 — Slash commands (simple)

### Target UX
- User drops markdown templates in `~/.config/marvin/commands/`.
- Typing `/<name> [args...]` in the TUI expands to the template and sends it as a normal user message.
- Built-ins win (no overriding in v1).

### Minimal spec
- Files: `~/.config/marvin/commands/*.md` (non-recursive).
- Name: filename (no extension), validate `^[A-Za-z0-9][A-Za-z0-9_-]*$`.
- Description for autocomplete: first non-empty line, truncated.
- Args:
  - Replace `$ARGUMENTS` with raw args string (no quote parsing).
  - If template has no `$ARGUMENTS` and args exist, append `\n\n<args>`.

### Implementation steps
1. [x] Add loader `apps/coding-agent/src/custom-commands.ts`:
   - `loadCustomCommands(configDir): Map<string, { template: string; description: string }>`
   - no watchers; ignore invalid names; ignore non-`.md`.
2. [x] Wire into TUI:
   - In `apps/coding-agent/src/tui-app.tsx`, load once after `loadAppConfig`.
   - Extend `CombinedAutocompleteProvider` inputs with custom commands.
   - In `handleSubmit`, after built-in `handleSlashCommand`, attempt expansion; if expanded, submit expanded text.
3. [x] Help/docs:
   - Update `apps/coding-agent/src/index.ts` help to mention `~/.config/marvin/commands`.

### Verification
- [x] Unit tests for loader + expansion (temp dir).
- [ ] Manual: create `~/.config/marvin/commands/review.md`, run `bun run marvin`, type `/review X`.

---

## Plan 2 — Typed lifecycle hooks (minimal, opencode-ish typing)

### Goal
Expose a *small, stable* hook surface with TS types so hooks can attach precisely to lifecycle points without coupling to internal UI details.

### Event surface (v1)
Map from `packages/agent/src/types.ts` + session events from app:
- `app.start` (after config load)
- `session.start` / `session.resume` / `session.clear` (app-level, optional)
- `agent.start` / `agent.end`
- `turn.start` / `turn.end`
- `tool.execute.before` (can block)
- `tool.execute.after` (can rewrite result)

### Hook module format
- Hook file: `~/.config/marvin/hooks/*.ts` (non-recursive).
- Export default function `(marvin: HookAPI) => void` (pi-mono ergonomics), but **typed hook names** use opencode-style strings.
- Strong typing via a central `HookEventMap`/`HookHandler` map.

### Runtime policy
- `tool.execute.before`: fail-safe **deny** on hook error (security > convenience); no UI prompts in v1.
- Others: best-effort; bounded timeout (e.g. 2–5s) and errors reported once.

### Implementation steps
1. Add hook types: `apps/coding-agent/src/hooks/types.ts` (event map + context + result types).
2. Add loader: `apps/coding-agent/src/hooks/loader.ts`:
   - discover `*.ts` in `configDir/hooks` (and optionally `./.marvin/hooks` later).
   - load with `import(pathToFileURL(...))` under Bun.
   - constrain runtime imports: hooks should be self-contained; allow `import type` only (document this).
3. Add runner: `apps/coding-agent/src/hooks/runner.ts`:
   - register handlers; emit w/ timeout; error aggregation.
4. Tool interception: `apps/coding-agent/src/hooks/tool-wrapper.ts`:
   - wrap `AgentTool.execute` (same technique as pi-mono).
5. Wire in both modes:
   - TUI: `apps/coding-agent/src/tui-app.tsx` create runner, wrap tools before constructing `Agent`.
   - Headless: `apps/coding-agent/src/headless.ts` same.

### Verification
- Unit tests: loader discovery; tool blocking; tool result rewrite.
- Manual: hook that blocks `bash` unless command matches allowlist.

---

## Plan 3 — Personal / external tools (minimal)

### Goal
Allow user-defined tools without changing Marvin core, but keep it "small and boring".

### Minimal spec
- Tools live in `~/.config/marvin/tools/*.ts` (non-recursive).
- Each module exports a default factory that returns one `AgentTool` or an array.
- Conflict detection against built-in tool names; conflicts are rejected with a single error message.

### Tool author API
Provide a small `ToolAPI` passed to factories:
- `cwd`
- `exec(cmd, args, { timeoutMs?, signal? })`
- `Type` (re-export of `@sinclair/typebox`’s `Type`) so tool authors don’t need runtime imports.

### Integration
- Load tools at startup, append to `tools` passed to `Agent`.
- Hooks from Plan 2 automatically see these tools (wrapping occurs after tool load).

### Implementation steps
1. Implement loader `apps/coding-agent/src/custom-tools/loader.ts` (modeled after pi-mono but simpler; no jiti/alias).
2. Update app wiring (TUI + headless) to include loaded tools.
3. Add a docs snippet + sample tool skeleton.

### Verification
- Unit test: conflicts, multi-tool export.
- Manual: tool that calls `git status` and returns text.

---

## Reference files (what to copy patterns from)

### opencode
- Commands docs: `/Users/yesh/Documents/personal/reference/opencode/packages/web/src/content/docs/commands.mdx`
- Command loader: `/Users/yesh/Documents/personal/reference/opencode/packages/opencode/src/config/config.ts` (`loadCommand`)
- Hook typing: `/Users/yesh/Documents/personal/reference/opencode/packages/plugin/src/index.ts`
- Plugin trigger: `/Users/yesh/Documents/personal/reference/opencode/packages/opencode/src/plugin/index.ts`

### pi-mono
- Slash command loader: `/Users/yesh/Documents/personal/reference/pi-mono/packages/coding-agent/src/core/slash-commands.ts`
- Hook system: `/Users/yesh/Documents/personal/reference/pi-mono/packages/coding-agent/src/core/hooks/types.ts`, `.../loader.ts`, `.../runner.ts`, `.../tool-wrapper.ts`
- Custom tool loader: `/Users/yesh/Documents/personal/reference/pi-mono/packages/coding-agent/src/core/custom-tools/loader.ts`

### Marvin (touch points)
- Built-in slash commands: `apps/coding-agent/src/commands.ts`
- Slash command autocomplete: `apps/coding-agent/src/autocomplete-commands.ts`
- Submit pipeline + autocomplete provider: `apps/coding-agent/src/tui-app.tsx`
- Headless entrypoint: `apps/coding-agent/src/headless.ts`
- Agent events available for hooks: `packages/agent/src/types.ts`
- Built-in tools list: `packages/base-tools/src/index.ts`
