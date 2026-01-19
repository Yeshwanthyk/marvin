# Changelog

## [0.3.1] - 2026-01-19

### Fixed
- **Global install resolution**: Publish-time tsconfig and path fallbacks now let Bun resolve internal aliases and workspace deps when installed from npm.

## [0.3.0] - 2026-01-19

### Added
- **Effect runtime foundation**: Core orchestration, session handling, and SDK entrypoints now use the Effect-based runtime.
- **SDK publish readiness**: Packages are published under the `@yeshwanthyk/*` scope for npm consumption.

### Changed
- **TUI hook visibility**: `agent.before_start` hook messages are surfaced in the UI again after the prompt path refactor.

## [0.2.3] - 2026-01-18

### Added
- **Two-way steering queues**: Agent core now exposes dedicated steering/follow-up queues, parity with pi’s delivery semantics.
- **Session APIs**: `SessionController`/Hook API gain `steer()`, `followUp()`, and `sendUserMessage({ deliverAs })` helpers plus queue restore metadata.
- **TUI commands**: Built-in `/steer` and `/followup` commands, composer enter-while-streaming follow-up behavior, queue badges split by mode.
- **Hook example**: `examples/hooks/steer-followup.ts` demonstrates steering/follow-up helpers.

### Changed
- Legacy `agent.queueMessage()` now aliases to follow-up with a deprecation warning.
- Hook transports/controllers updated to propagate steering + follow-up fetchers through provider/app transports.
- Docs updated (`apps/coding-agent/README.md`, `docs/pi.md`, examples README) to explain new delivery modes and migration steps.

## [0.2.2] - 2026-01-02

### Added
- **Interview tool**: Browser-based interactive forms for structured user input (replaces `ask_user_question`)
  - Question types: single/multi-choice, text, image selection
  - Supports inline questions object or JSON file path
  - Directory-based custom tool with `hasUI` API
- **Hook lifecycle events**: `session.before_compact` and `session.compact` for compaction control
- **HookSessionContext.complete()**: Signal hook completion from async operations
- **HookedTransport**: Transport-level hook integration for all adapters
- **Modal components**: TUI dialogs for hook UI interactions

### Changed
- **Adapter architecture**: TUI, headless, and ACP adapters with domain types
- **Command registry**: Centralized builtin command definitions

### Removed
- `ask_user_question` tool (replaced by interview tool)

## [0.2.1] - 2025-01-27

### Added
- **Edit file review**: Click `[e]` on completed edit tool blocks to open file in editor, review changes, and queue follow-up message with diff

## [0.2.0] - 2025-01-21

### Added
- **Iterative compaction**: Smart context compression with file tracking and structured summaries
- **ask_user_question tool**: TUI dialog for structured user prompts
- **Custom tools send() API**: Queue user input from custom tools
- **Usage data in hooks**: `turn.end` event includes token usage for auto-compact triggers
- **MESSAGE_CAP**: Limit UI message count to 30 for performance

### Changed
- More compact tool and thinking block rendering
- Increased tool block indent for visual hierarchy
- More subdued tool headers

## [0.1.0] - 2025-01-15

Initial release.

### Features
- Multi-provider LLM support (Anthropic, OpenAI, Google, Codex, OpenRouter, Groq, xAI, Mistral, Cerebras)
- SolidJS-powered terminal UI with 30+ themes
- Core tools: read, write, edit, bash, subagent
- LSP integration with auto-spawning language servers
- Session persistence with resume support
- Configurable thinking levels
- Custom tools, commands, and lifecycle hooks
- Precision diff viewing with OpenTUI
