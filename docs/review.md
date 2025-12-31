# Review Map (Bottom-Up)

## Stack Overview

Bottom-up dependency sketch:

```
[apps/coding-agent]  CLI + TUI + headless + ACP
        |
        v
[packages/open-tui]  Terminal UI primitives + themes
        |
        v
[packages/agent]     Agent state machine + transports
        |
        v
[packages/ai]        Types + streaming + providers + agent loop
       / \
      v   v
[base-tools]       [lsp]
read/write/edit    tool wrappers + diagnostics
```

## Review Chunks (read in order)

Each chunk is a self-contained reading block. We can walk these one at a time in follow-up sessions.

### Chunk 0: Orientation (optional)
Goal: align on product intent, architecture, and CLI behavior.

Files:
- README.md
- docs/architecture.md
- docs/walkthrough.md
- docs/testing.md
- docs/opencode.md
- docs/pi.md
- apps/coding-agent/README.md

### Chunk 1: Core Types and Utilities (packages/ai)
Goal: learn the canonical data shapes (messages, tools, events) and low-level helpers.

Files (read order):
- packages/ai/src/types.ts
- packages/ai/src/utils/event-stream.ts
- packages/ai/src/utils/json-parse.ts
- packages/ai/src/utils/typebox-helpers.ts
- packages/ai/src/utils/validation.ts
- packages/ai/src/utils/sanitize-unicode.ts
- packages/ai/src/utils/overflow.ts
- packages/ai/src/models.ts
- packages/ai/src/models.generated.ts
- packages/ai/src/index.ts

Tests and scripts:
- packages/ai/test/*.test.ts
- packages/ai/scripts/generate-models.ts
- packages/ai/scripts/generate-test-image.ts

### Chunk 2: Provider Adapters and Streaming (packages/ai)
Goal: see how provider-specific APIs map into unified streaming events.

Files:
- packages/ai/src/providers/transform-messages.ts
- packages/ai/src/providers/anthropic.ts
- packages/ai/src/providers/openai-completions.ts
- packages/ai/src/providers/openai-responses.ts
- packages/ai/src/providers/google.ts
- packages/ai/src/stream.ts

### Chunk 3: Agent Loop and Tool Execution (packages/ai/src/agent)
Goal: understand turn loop, tool calls, and event emission.

Files:
- packages/ai/src/agent/types.ts
- packages/ai/src/agent/tools/index.ts
- packages/ai/src/agent/tools/calculate.ts
- packages/ai/src/agent/tools/get-current-time.ts
- packages/ai/src/agent/agent-loop.ts
- packages/ai/src/agent/index.ts

### Chunk 4: Agent Core and Transports (packages/agent)
Goal: state machine, message queue, transport abstraction, Codex auth.

Files:
- packages/agent/src/types.ts
- packages/agent/src/agent.ts
- packages/agent/src/transports/types.ts
- packages/agent/src/transports/proxy-types.ts
- packages/agent/src/transports/AppTransport.ts
- packages/agent/src/transports/ProviderTransport.ts
- packages/agent/src/transports/RouterTransport.ts
- packages/agent/src/transports/CodexTransport.ts
- packages/agent/src/transports/codex/constants.ts
- packages/agent/src/transports/codex/types.ts
- packages/agent/src/transports/codex/model-map.ts
- packages/agent/src/transports/codex/instructions.ts
- packages/agent/src/transports/codex/request-transformer.ts
- packages/agent/src/transports/codex/fetch.ts
- packages/agent/src/transports/codex/auth.ts
- packages/agent/src/transports/codex/oauth-server.ts
- packages/agent/src/transports/codex/README.md
- packages/agent/src/transports/index.ts
- packages/agent/src/model-cycling.ts
- packages/agent/src/codex-auth-cli.ts
- packages/agent/src/index.ts

Tests and docs:
- packages/agent/test/*.test.ts
- packages/agent/README.md

### Chunk 5: Base Tools (packages/base-tools)
Goal: concrete read/write/edit/bash tools and shared utility helpers.

Files (read order):
- packages/base-tools/src/tools/path-utils.ts
- packages/base-tools/src/tools/truncate.ts
- packages/base-tools/src/utils/mime.ts
- packages/base-tools/src/utils/shell.ts
- packages/base-tools/src/tools/read.ts
- packages/base-tools/src/tools/write.ts
- packages/base-tools/src/tools/edit.ts
- packages/base-tools/src/tools/bash.ts
- packages/base-tools/src/index.ts

### Chunk 6: LSP Integration (packages/lsp)
Goal: LSP lifecycle and diagnostics injection for write/edit tools.

Files:
- packages/lsp/src/types.ts
- packages/lsp/src/path.ts
- packages/lsp/src/registry.ts
- packages/lsp/src/install.ts
- packages/lsp/src/client.ts
- packages/lsp/src/manager.ts
- packages/lsp/src/diagnostics.ts
- packages/lsp/src/tool-wrapper.ts
- packages/lsp/src/index.ts

Tests:
- packages/lsp/tests/*.test.ts

### Chunk 7: UI Primitives (packages/open-tui)
Goal: terminal UI components, theme system, and autocomplete.

Files (core):
- packages/open-tui/src/index.ts
- packages/open-tui/src/app.tsx
- packages/open-tui/src/parsers-config.ts
- packages/open-tui/src/opentui-augmentations.ts

Context, hooks, utils:
- packages/open-tui/src/context/terminal.tsx
- packages/open-tui/src/context/theme.tsx
- packages/open-tui/src/hooks/use-keyboard.ts
- packages/open-tui/src/utils/clipboard.ts
- packages/open-tui/src/utils/text-width.ts

Autocomplete:
- packages/open-tui/src/autocomplete/autocomplete.ts
- packages/open-tui/src/autocomplete/file-index.ts
- packages/open-tui/src/autocomplete/index.ts

Components:
- packages/open-tui/src/components/badge.tsx
- packages/open-tui/src/components/code-block.tsx
- packages/open-tui/src/components/diff.tsx
- packages/open-tui/src/components/dialog.tsx
- packages/open-tui/src/components/divider.tsx
- packages/open-tui/src/components/editor.tsx
- packages/open-tui/src/components/image.tsx
- packages/open-tui/src/components/loader.tsx
- packages/open-tui/src/components/markdown.tsx
- packages/open-tui/src/components/panel.tsx
- packages/open-tui/src/components/select-list.tsx
- packages/open-tui/src/components/spacer.tsx
- packages/open-tui/src/components/toast.tsx

Themes:
- packages/open-tui/src/themes/*.json

Examples and tests:
- packages/open-tui/examples/*
- packages/open-tui/tests/*.test.ts
- packages/open-tui/README.md

### Chunk 8: App Layer (apps/coding-agent)
Goal: CLI + TUI wiring, config, sessions, hooks, tool wrapping, ACP/headless modes.

Entry and args:
- apps/coding-agent/src/index.ts
- apps/coding-agent/src/args.ts

Config and editor:
- apps/coding-agent/src/config.ts
- apps/coding-agent/src/theme-names.ts
- apps/coding-agent/src/editor.ts
- apps/coding-agent/src/syntax-highlighting.ts

Sessions:
- apps/coding-agent/src/session-manager.ts
- apps/coding-agent/src/session-picker.tsx

Commands and autocomplete:
- apps/coding-agent/src/commands.ts
- apps/coding-agent/src/autocomplete-commands.ts
- apps/coding-agent/src/custom-commands.ts

Custom tools and hooks:
- apps/coding-agent/src/custom-tools/types.ts
- apps/coding-agent/src/custom-tools/loader.ts
- apps/coding-agent/src/custom-tools/index.ts
- apps/coding-agent/src/hooks/types.ts
- apps/coding-agent/src/hooks/loader.ts
- apps/coding-agent/src/hooks/runner.ts
- apps/coding-agent/src/hooks/tool-wrapper.ts
- apps/coding-agent/src/hooks/index.ts

Agent <-> UI glue:
- apps/coding-agent/src/types.ts
- apps/coding-agent/src/tool-ui-contracts.ts
- apps/coding-agent/src/agent-events.ts
- apps/coding-agent/src/utils.ts
- apps/coding-agent/src/compact-handler.ts
- apps/coding-agent/src/shell-runner.ts
- apps/coding-agent/src/profiler.ts

TUI and components:
- apps/coding-agent/src/tui-app.tsx
- apps/coding-agent/src/tui-open-rendering.tsx
- apps/coding-agent/src/keyboard-handler.ts
- apps/coding-agent/src/components/Header.tsx
- apps/coding-agent/src/components/Footer.tsx
- apps/coding-agent/src/components/MessageList.tsx
- apps/coding-agent/src/components/AskUserQuestionDialog.tsx

Tools and modes:
- apps/coding-agent/src/tools/ask-user-question.ts
- apps/coding-agent/src/headless.ts
- apps/coding-agent/src/acp/protocol.ts
- apps/coding-agent/src/acp/updates.ts
- apps/coding-agent/src/acp/session.ts
- apps/coding-agent/src/acp/index.ts

Build, docs, examples, tests:
- apps/coding-agent/scripts/build.ts
- apps/coding-agent/README.md
- apps/coding-agent/examples/auto-compact.ts
- apps/coding-agent/tests/*.test.ts

### Chunk 9: Repo Tooling and Examples
Goal: supporting scripts and extension examples.

Files:
- scripts/test-all.ts
- test/setup.ts
- examples/hooks/*
- examples/tools/subagent/*
- bunfig.toml
- tsconfig.base.json
- package.json

Notes:
- packages/snap-tui/ currently has no source files (only node_modules). If code appears later, slot it between Chunk 7 and Chunk 8.
