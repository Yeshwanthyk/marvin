# Marvin Slash Commands Implementation Plan

## Overview

Add file-backed custom slash commands to Marvin’s TUI so typing `/<name> [args]` expands to a prompt template stored in `~/.config/marvin/commands/` (or `--config-dir`).

## Current State Analysis

- Built-in slash commands exist and are handled inline in the TUI (`apps/coding-agent/src/tui/command-handlers.ts`).
- Slash command autocomplete exists (`apps/coding-agent/src/tui/autocomplete-commands.ts`) via `CombinedAutocompleteProvider`.
- There is no mechanism for user-defined commands stored on disk.

## Desired End State

- Users can create prompt templates in `~/.config/marvin/commands/<name>.md` (also allow `.txt`, `.prompt`).
- In the Marvin TUI, typing `/<name> [args]`:
  - If `<name>` is a built-in command, run the built-in behavior.
  - Else if `<name>` matches a custom command file, expand to that template and send the expanded prompt to the agent.
- Autocomplete includes custom command names alongside built-ins.

### Command Rules

- Command name = filename (no extension).
- Allowed names: `^[a-zA-Z0-9][a-zA-Z0-9_-]*$`.
- Reserved names: all built-ins (and `/quit` alias).
- Argument expansion:
  - If template contains `{{args}}`, substitute it.
  - Else append args after a blank line.

## What We’re NOT Doing

- Headless mode slash command expansion.
- Hot-reloading command files while Marvin is running.
- Nested directories / categories.
- Rich templating beyond `{{args}}`.

## Implementation Approach

1. Add a small “custom commands” loader that scans exactly one directory: `<configDir>/commands`.
2. Extend the TUI boot to:
   - load + validate custom commands once
   - add them to the autocomplete provider
3. In editor submit:
   - run built-in handler first
   - if not handled and matches a custom command, expand and submit expanded prompt text

## Phase 1: Custom Command Loader

### Changes

**File**: `apps/coding-agent/src/tui/custom-commands.ts`
- Implement:
  - `loadCustomSlashCommands({ configDir, reservedNames })`
  - `parseSlashInvocation(line)`
  - `expandCustomSlashCommand(cmd, argsText)`
- Enforce name + extension rules.

### Success Criteria

#### Automated Verification
- Typecheck passes: `bun run typecheck`
- Unit tests cover:
  - name filtering
  - reserved name filtering
  - `{{args}}` replacement and fallback append

#### Manual Verification
- Create `~/.config/marvin/commands/review.md` and confirm loader picks it up.

## Phase 2: TUI Wiring (Autocomplete + Submit Expansion)

### Changes

**File**: `apps/coding-agent/src/tui-app.ts`
- Load custom commands at startup using `loaded.configDir`.
- Extend autocomplete command list with the loaded custom commands.
- On submit:
  - try built-ins
  - else expand custom command (if present) and submit expanded prompt

### Success Criteria

#### Automated Verification
- `bun run typecheck`

#### Manual Verification
1. Start Marvin: `bun run marvin`
2. Type `/review <args>` and confirm:
   - it expands into the prompt template
   - agent receives expanded text
   - autocomplete suggests `/review`

## Phase 3: Tests + Help Output

### Changes

**File**: `apps/coding-agent/tests/custom-commands.test.ts`
- Add/adjust tests to only target `<configDir>/commands`.

**File**: `apps/coding-agent/src/index.ts`
- Update `--help` output to mention `~/.config/marvin/commands`.

### Success Criteria

#### Automated Verification
- Full check: `bun run check`

## Testing Strategy

### Unit Tests
- Loader ignores invalid filenames and reserved names.
- `.md`/`.txt`/`.prompt` accepted; other extensions ignored.
- Expansion behavior with/without `{{args}}`.

### Manual Testing
- Ensure built-ins still win for reserved names.
- Verify large templates render acceptably in the TUI (multi-line user message).

## Performance Considerations

- Scan directory once at startup; command count expected small. No watchers.

## Migration Notes

- None.

## References

- Built-in slash handling: `apps/coding-agent/src/tui/command-handlers.ts`
- Autocomplete plumbing: `apps/coding-agent/src/tui/autocomplete-commands.ts`, `packages/tui/src/autocomplete.ts`
- TUI main loop: `apps/coding-agent/src/tui-app.ts`
