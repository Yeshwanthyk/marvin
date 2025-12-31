# Changelog

## [0.2.0] - 2024-12-31

### Added

- **Shell mode**: `!` prefix for quick shell commands, `!!` injects output into context
- **`/status` command**: Show agent/session status with autocomplete
- **`/conceal` command**: Toggle markdown syntax hiding
- **`/editor` command**: Open external editor for composing messages
- **`ask_user_question` tool**: Structured user prompts dialog in TUI
- **ACP server mode**: `--acp` flag for Zed integration
- **`send()` API for custom tools**: Queue user input programmatically
- **Snapshot hook**: OpenCode-style working tree snapshots
- **Usage data in `turn.end` event**: Enables auto-compact hooks
- **LSP status in footer**: Server status, diagnostic counts, pulse animation on activity
- **LSP managed binaries**: Auto-downloads rust-analyzer, biome, ruff, ty
- **Cache efficiency indicator**: Shows compacting state in footer
- **Queue indicator in header**: Replaced cache indicator
- **Image attachments in read tool**: Render images inline
- **Tree-sitter markdown parser**: For syntax highlighting

### Changed

- **MESSAGE_CAP increased to 75**: Up from 30 for longer conversations
- **Ctrl+C clears input**: Esc now aborts (behavior swap)
- **Thinking block styling**: Colorized labels by level, markdown conceal support
- **SelectList autocomplete picker**: Replaced custom picker implementation

### Performance

- **Adaptive throttle + text tail**: Streaming optimization
- **Skip tree-sitter during streaming**: Defer highlighting until complete
- **Structured compaction format**: File tracking for smarter context management
- **Iterative summary updates**: More efficient compaction

### Fixed

- Markdown concealment in compiled binary
- Path shortening improvements
