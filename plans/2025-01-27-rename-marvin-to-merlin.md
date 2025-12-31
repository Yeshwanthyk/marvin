# Rename marvin → merlin Implementation Plan

## Plan Metadata
- Created: 2025-01-27
- Ticket: N/A
- Status: draft
- Owner: yesh
- Assumptions:
  - No external consumers of `@marvin-agents/*` packages yet (pre-publish)
  - GitHub repo rename will be done separately (manual)
  - Backward compatibility for config paths is desired during transition

## Progress Tracking
- [ ] Phase 1: Package Namespace Rename
- [ ] Phase 2: Binary/CLI Name
- [ ] Phase 3: Configuration Directory (Additive Migration)
- [ ] Phase 4: Hook API Convention
- [ ] Phase 5: Default Theme Name
- [ ] Phase 6: Environment Variables
- [ ] Phase 7: Personal Configuration Migration
- [ ] Phase 8: GitHub/Repository References
- [ ] Phase 9: Documentation Updates

## Overview
Rename the project from "marvin" to "merlin" across all touchpoints: package names, CLI binary, config paths, API conventions, theme names, environment variables, and documentation.

## Current State
The name "marvin" appears in 97+ files across 9 distinct domains:
- Package namespace: `@marvin-agents/*` (7 packages)
- Binary: `marvin` command
- Config: `~/.config/marvin/`
- Hook API: `function(marvin: HookAPI)`
- Theme: `"marvin"` as default
- Env vars: `MARVIN_TUI_PROFILE`, `MARVIN_COMPACT_THRESHOLD`
- Personal config: `~/.config/marvin/` with hooks, tools, commands, agents
- GitHub: `Yeshwanthyk/marvin`
- Docs: 50+ files in `docs/`, `plans/`, READMEs

### Key Discoveries
- `apps/coding-agent/src/config.ts:102` — `resolveConfigDir()` hardcodes `~/.config/marvin`
- `packages/open-tui/src/context/theme.tsx:575-608` — "marvin" theme is hardcoded palette, not a JSON file
- `apps/coding-agent/src/hooks/types.ts:197` — HookAPI type definition
- `apps/coding-agent/scripts/build.ts:18` — build outputs to `~/commands/marvin`
- No install.sh exists yet — planned in `plans/2025-01-11-publish-marvin-packages.md`

## Desired End State
- All packages use `@merlin-agents/*` namespace
- CLI binary is `merlin`
- Config lives in `~/.config/merlin/`
- Hook API convention uses `merlin` parameter
- Default theme is `"merlin"`
- Env vars prefixed with `MERLIN_`
- User's personal config migrated to new location
- GitHub references updated (repo rename separate)
- Documentation reflects new naming

### Verification
```bash
# Binary name
which merlin && merlin --version

# Package names
grep -r "@merlin-agents" packages/*/package.json

# Config path
ls ~/.config/merlin/config.json

# Theme
merlin --headless "echo test" 2>&1 | head -1  # Should not error

# Env vars
MERLIN_TUI_PROFILE=1 merlin --help
```

## Out of Scope
- GitHub repository rename (manual operation)
- npm publishing (separate effort)
- Desktop/Tauri app updates (future plan)
- Breaking existing `~/.config/marvin/` — will be preserved

## Breaking Changes
| Change | Migration |
|--------|-----------|
| Package imports | Find-replace in user code |
| CLI command | Update aliases, scripts |
| Config path | Auto-migration on first run |
| Env vars | Update shell config |
| Hook parameter | Convention only, not enforced |

## Dependency and Configuration Changes

### Additions
None — this is a rename, not a feature addition.

### Updates
All `package.json` files updated with new names (no version changes).

### Removals
None — old config path preserved for backward compatibility.

### Configuration Changes
**File**: `apps/coding-agent/src/config.ts`

**Before**:
```typescript
const resolveConfigDir = (): string => path.join(os.homedir(), '.config', 'marvin');
```

**After**:
```typescript
const resolveConfigDir = (): string => path.join(os.homedir(), '.config', 'merlin');
```

**Impact**: Users must migrate config or use `--config-dir` flag.

## Error Handling Strategy
- If `~/.config/merlin/` doesn't exist but `~/.config/marvin/` does, emit warning suggesting migration
- Migration command copies files, never deletes source
- Build failures from missed renames caught by typecheck

## Implementation Approach
Phased rename with additive config migration:
1. Rename all package namespaces first (most invasive, pure code change)
2. Update binary name and build output
3. Add config migration support (copy-based, non-destructive)
4. Update conventions (hook API, theme, env vars)
5. Migrate personal config
6. Update external references (GitHub, docs)

**Alternative rejected**: Big-bang rename in single commit — too hard to review, debug, or rollback.

## Phase Dependencies and Parallelization
- Dependencies: Phase 2 depends on Phase 1; Phase 7 depends on Phase 3
- Parallelizable: Phases 4, 5, 6 can run in parallel after Phase 2
- Suggested @agents: None needed — sequential execution recommended for rename coherence

---

## Phase 1: Package Namespace Rename

### Overview
Rename all `@marvin-agents/*` packages to `@merlin-agents/*` and update all internal imports.

### Prerequisites
- [ ] Clean git state (`git status` shows no changes)
- [ ] All tests passing (`bun run check`)

### Change Checklist
- [ ] Root package.json
- [ ] packages/ai/package.json + internal refs
- [ ] packages/agent/package.json + internal refs
- [ ] packages/base-tools/package.json + internal refs
- [ ] packages/lsp/package.json + internal refs
- [ ] packages/open-tui/package.json + internal refs
- [ ] apps/coding-agent/package.json + internal refs
- [ ] All cross-package imports updated
- [ ] bun.lock regenerated

### Changes

#### 1. Root package.json
**File**: `package.json`
**Location**: line 2

**Before**:
```json
{
  "name": "marvin-agent",
```

**After**:
```json
{
  "name": "merlin-agent",
```

#### 2. packages/ai/package.json
**File**: `packages/ai/package.json`
**Location**: line 2

**Before**:
```json
{
  "name": "@marvin-agents/ai",
```

**After**:
```json
{
  "name": "@merlin-agents/ai",
```

#### 3. packages/agent/package.json
**File**: `packages/agent/package.json`
**Location**: lines 2, 22

**Before**:
```json
{
  "name": "@marvin-agents/agent-core",
  ...
  "dependencies": {
    "@marvin-agents/ai": "file:../ai",
```

**After**:
```json
{
  "name": "@merlin-agents/agent-core",
  ...
  "dependencies": {
    "@merlin-agents/ai": "file:../ai",
```

#### 4. packages/base-tools/package.json
**File**: `packages/base-tools/package.json`
**Location**: lines 2, 12

**Before**:
```json
{
  "name": "@marvin-agents/base-tools",
  ...
  "dependencies": {
    "@marvin-agents/ai": "file:../ai",
```

**After**:
```json
{
  "name": "@merlin-agents/base-tools",
  ...
  "dependencies": {
    "@merlin-agents/ai": "file:../ai",
```

#### 5. packages/lsp/package.json
**File**: `packages/lsp/package.json`
**Location**: lines 2, 12

**Before**:
```json
{
  "name": "@marvin-agents/lsp",
  ...
  "dependencies": {
    "@marvin-agents/ai": "file:../ai",
```

**After**:
```json
{
  "name": "@merlin-agents/lsp",
  ...
  "dependencies": {
    "@merlin-agents/ai": "file:../ai",
```

#### 6. packages/open-tui/package.json
**File**: `packages/open-tui/package.json`
**Location**: line 2

**Before**:
```json
{
  "name": "@marvin-agents/open-tui",
```

**After**:
```json
{
  "name": "@merlin-agents/open-tui",
```

#### 7. apps/coding-agent/package.json
**File**: `apps/coding-agent/package.json`
**Location**: lines 2, 14-18

**Before**:
```json
{
  "name": "@marvin-agents/coding-agent",
  ...
  "dependencies": {
    "@marvin-agents/agent-core": "file:../../packages/agent",
    "@marvin-agents/ai": "file:../../packages/ai",
    "@marvin-agents/base-tools": "file:../../packages/base-tools",
    "@marvin-agents/lsp": "file:../../packages/lsp",
    "@marvin-agents/open-tui": "file:../../packages/open-tui",
```

**After**:
```json
{
  "name": "@merlin-agents/coding-agent",
  ...
  "dependencies": {
    "@merlin-agents/agent-core": "file:../../packages/agent",
    "@merlin-agents/ai": "file:../../packages/ai",
    "@merlin-agents/base-tools": "file:../../packages/base-tools",
    "@merlin-agents/lsp": "file:../../packages/lsp",
    "@merlin-agents/open-tui": "file:../../packages/open-tui",
```

#### 8. Bulk Import Updates (All Source Files)
**Command to find all files**:
```bash
rg -l "@marvin-agents" --type ts -g '!node_modules' -g '!bun.lock'
```

**Bulk replacement** (run from repo root):
```bash
# Preview changes
rg "@marvin-agents" --type ts -g '!node_modules' -g '!bun.lock'

# Apply replacement
fd -e ts -e tsx -x sed -i '' 's/@marvin-agents/@merlin-agents/g' {}
```

**Files affected** (partial list — bulk replace handles all):
- `packages/ai/src/*.ts`
- `packages/agent/src/*.ts`
- `packages/base-tools/src/tools/*.ts`
- `packages/lsp/src/*.ts`
- `packages/open-tui/src/*.ts`
- `apps/coding-agent/src/**/*.ts`
- `apps/coding-agent/tests/*.ts`
- `examples/**/*.ts`

#### 9. Regenerate Lockfile
**Command**:
```bash
rm bun.lock
bun install
```

**Why**: Lockfile contains old package names, must regenerate.

### Edge Cases to Handle
- [ ] Imports in test files: included in bulk replace
- [ ] Imports in example files: included in bulk replace
- [ ] Dynamic imports (string literals): verify with grep after bulk replace

### Success Criteria

**Automated**:
```bash
bun run typecheck          # Zero type errors
bun run test               # All tests pass
```

**Before proceeding**:
```bash
# Verify no remaining references
rg "@marvin-agents" --type ts -g '!node_modules' -g '!bun.lock'
# Should return empty

# Verify imports resolve
bun run marvin --help
```

**Manual**:
- [ ] `bun install` completes without errors
- [ ] IDE shows no import errors

### Rollback
```bash
git restore -- .
rm bun.lock && bun install
```

### Notes
[Space for implementer to record discoveries/decisions]

---

## Phase 2: Binary/CLI Name

### Overview
Rename the CLI binary from `marvin` to `merlin` and update all references.

### Prerequisites
- [ ] Phase 1 complete and passing

### Change Checklist
- [ ] package.json bin field
- [ ] Root package.json script
- [ ] Build script default output
- [ ] Help text
- [ ] AGENTS.md reference

### Changes

#### 1. Binary Name in package.json
**File**: `apps/coding-agent/package.json`
**Location**: lines 7-9

**Before**:
```json
  "bin": {
    "marvin": "./src/index.ts"
  },
```

**After**:
```json
  "bin": {
    "merlin": "./src/index.ts"
  },
```

#### 2. Root Script Alias
**File**: `package.json`
**Location**: line 10

**Before**:
```json
    "marvin": "bun apps/coding-agent/src/index.ts"
```

**After**:
```json
    "merlin": "bun apps/coding-agent/src/index.ts"
```

#### 3. Build Script Default Output
**File**: `apps/coding-agent/scripts/build.ts`
**Location**: line 18

**Before**:
```typescript
const outfile = process.argv[2] || join(process.env.HOME!, "commands", "marvin");
```

**After**:
```typescript
const outfile = process.argv[2] || join(process.env.HOME!, "commands", "merlin");
```

#### 4. Help Text
**File**: `apps/coding-agent/src/index.ts`
**Location**: lines 67-84

**Before**:
```typescript
const printHelp = () => {
  process.stdout.write(
    [
      'Usage:',
      '  marvin [options] [prompt...]',
      '',
      'Options:',
      ...
      'Custom Commands:',
      '  Place .md files in ~/.config/marvin/commands/',
      ...
      'Lifecycle Hooks:',
      '  Place .ts files in ~/.config/marvin/hooks/',
      '  Export default function(marvin) { marvin.on(event, handler) }',
      ...
      'Custom Tools:',
      '  Place .ts files in ~/.config/marvin/tools/',
```

**After**:
```typescript
const printHelp = () => {
  process.stdout.write(
    [
      'Usage:',
      '  merlin [options] [prompt...]',
      '',
      'Options:',
      ...
      'Custom Commands:',
      '  Place .md files in ~/.config/merlin/commands/',
      ...
      'Lifecycle Hooks:',
      '  Place .ts files in ~/.config/merlin/hooks/',
      '  Export default function(merlin) { merlin.on(event, handler) }',
      ...
      'Custom Tools:',
      '  Place .ts files in ~/.config/merlin/tools/',
```

#### 5. AGENTS.md Reference
**File**: `AGENTS.md`
**Location**: line 17

**Before**:
```markdown
bun run marvin             # alias for coding-agent
```

**After**:
```markdown
bun run merlin             # alias for coding-agent
```

### Success Criteria

**Automated**:
```bash
bun run typecheck
bun run test
```

**Before proceeding**:
```bash
# Test new script name
bun run merlin --help

# Verify old name removed
grep -r '"marvin"' package.json apps/coding-agent/package.json
# Should only show in devDependencies if any, not in bin/scripts
```

**Manual**:
- [ ] `bun run merlin --help` shows updated help text
- [ ] Help text shows `~/.config/merlin/` paths

### Rollback
```bash
git restore -- package.json apps/coding-agent/package.json apps/coding-agent/scripts/build.ts apps/coding-agent/src/index.ts AGENTS.md
```

---

## Phase 3: Configuration Directory (Additive Migration)

### Overview
Update config path resolution from `~/.config/marvin/` to `~/.config/merlin/` with backward-compatible migration support.

### Prerequisites
- [ ] Phase 2 complete and passing

### Change Checklist
- [ ] config.ts — resolveConfigDir()
- [ ] config.ts — GLOBAL_AGENTS_PATHS
- [ ] session-manager.ts — default constructor
- [ ] Add migration warning when old path exists

### Changes

#### 1. Config Directory Resolution
**File**: `apps/coding-agent/src/config.ts`
**Location**: line 102

**Before**:
```typescript
const resolveConfigDir = (): string => path.join(os.homedir(), '.config', 'marvin');
```

**After**:
```typescript
const resolveConfigDir = (): string => path.join(os.homedir(), '.config', 'merlin');
```

#### 2. Global Agents Paths
**File**: `apps/coding-agent/src/config.ts`
**Location**: lines 10-14

**Before**:
```typescript
const GLOBAL_AGENTS_PATHS = [
  () => path.join(os.homedir(), '.config', 'marvin', 'agents.md'),
  () => path.join(os.homedir(), '.codex', 'agents.md'),
  () => path.join(os.homedir(), '.claude', 'CLAUDE.md'),
];
```

**After**:
```typescript
const GLOBAL_AGENTS_PATHS = [
  () => path.join(os.homedir(), '.config', 'merlin', 'agents.md'),
  () => path.join(os.homedir(), '.codex', 'agents.md'),
  () => path.join(os.homedir(), '.claude', 'CLAUDE.md'),
];
```

#### 3. Session Manager Default Path
**File**: `apps/coding-agent/src/session-manager.ts`
**Location**: line 67

**Before**:
```typescript
  constructor(configDir: string = join(process.env.HOME || '', '.config', 'marvin')) {
```

**After**:
```typescript
  constructor(configDir: string = join(process.env.HOME || '', '.config', 'merlin')) {
```

#### 4. Add Migration Helper Function
**File**: `apps/coding-agent/src/config.ts`
**Location**: Add after line 102 (after resolveConfigDir)

**Add**:
```typescript
const LEGACY_CONFIG_DIR = path.join(os.homedir(), '.config', 'marvin');

/**
 * Check if legacy config exists and new config doesn't.
 * Returns path to legacy dir if migration is needed, undefined otherwise.
 */
export const checkLegacyConfig = async (): Promise<string | undefined> => {
  const newDir = resolveConfigDir();
  const newExists = await fileExists(newDir);
  const legacyExists = await fileExists(LEGACY_CONFIG_DIR);
  
  if (legacyExists && !newExists) {
    return LEGACY_CONFIG_DIR;
  }
  return undefined;
};

/**
 * Copy legacy config to new location.
 * Does not delete source — user can do that manually.
 */
export const migrateConfig = async (): Promise<void> => {
  const newDir = resolveConfigDir();
  await fs.cp(LEGACY_CONFIG_DIR, newDir, { recursive: true });
};
```

#### 5. Add Migration Warning to App Startup
**File**: `apps/coding-agent/src/tui-app.tsx`
**Location**: After config loading (around line 93)

**Add** (after `loadAppConfig` call):
```typescript
import { checkLegacyConfig, migrateConfig } from './config.js';

// In the startup function, after loadAppConfig:
const legacyDir = await checkLegacyConfig();
if (legacyDir) {
  console.warn(`\n⚠️  Found legacy config at ${legacyDir}`);
  console.warn(`   Run 'merlin migrate' to copy to ~/.config/merlin/\n`);
}
```

#### 6. Add Migrate Command
**File**: `apps/coding-agent/src/index.ts`
**Location**: Add new command handler before `main()`

**Add**:
```typescript
import { checkLegacyConfig, migrateConfig } from './config.js';

const runMigrate = async () => {
  const legacyDir = await checkLegacyConfig();
  if (!legacyDir) {
    console.log('No migration needed — already using ~/.config/merlin/ or no legacy config found.');
    return;
  }
  
  console.log(`Copying ${legacyDir} → ~/.config/merlin/`);
  await migrateConfig();
  console.log('Migration complete. You can now delete ~/.config/marvin/ if desired.');
};
```

**Update** `main()` to handle migrate command:
```typescript
const main = async () => {
  const argv = process.argv.slice(2);
  
  // Handle migrate command before parsing other args
  if (argv[0] === 'migrate') {
    await runMigrate();
    return;
  }
  
  const args = parseArgs(argv);
  // ... rest of main
```

### Edge Cases to Handle
- [ ] Both dirs exist: Use new dir, no warning
- [ ] Neither exists: Create new dir on first config write
- [ ] Legacy exists, new exists: Use new dir, no migration needed
- [ ] Migration interrupted: Safe — source preserved, can retry

### Success Criteria

**Automated**:
```bash
bun run typecheck
bun run test
```

**Before proceeding**:
```bash
# Test migration detection (with legacy dir)
mkdir -p ~/.config/marvin-test
MERLIN_CONFIG_DIR=~/.config/merlin-test bun run merlin --help
# Should show warning about legacy config
```

**Manual**:
- [ ] `merlin migrate` copies config successfully
- [ ] After migration, `merlin` starts without warnings
- [ ] Original `~/.config/marvin/` preserved

### Rollback
```bash
git restore -- apps/coding-agent/src/config.ts apps/coding-agent/src/session-manager.ts apps/coding-agent/src/tui-app.tsx apps/coding-agent/src/index.ts
```

---

## Phase 4: Hook API Convention

### Overview
Update hook API convention from `marvin` to `merlin` parameter name in types, examples, and documentation.

### Prerequisites
- [ ] Phase 2 complete

### Change Checklist
- [ ] Hook type definitions
- [ ] Example hooks
- [ ] Hook loader comments

### Changes

#### 1. Hook Types Documentation
**File**: `apps/coding-agent/src/hooks/types.ts`
**Location**: lines 177, 197 (comments/examples)

**Before** (if any inline examples use `marvin`):
```typescript
// Example: export default function(marvin: HookAPI) { ... }
```

**After**:
```typescript
// Example: export default function(merlin: HookAPI) { ... }
```

#### 2. Auto-Compact Example
**File**: `apps/coding-agent/examples/auto-compact.ts`
**Location**: lines 15-40

**Before**:
```typescript
export default function autoCompact(marvin: HookAPI): void {
  const threshold = Number(process.env.MARVIN_COMPACT_THRESHOLD) || 85
  let shouldCompact = false
  let compactPending = false

  marvin.on("turn.end", (event) => {
    ...
  })

  marvin.on("agent.end", () => {
    if (shouldCompact && !compactPending) {
      compactPending = true
      shouldCompact = false
      marvin.send("/compact")
    }
  })
}
```

**After**:
```typescript
export default function autoCompact(merlin: HookAPI): void {
  const threshold = Number(process.env.MERLIN_COMPACT_THRESHOLD) || 85
  let shouldCompact = false
  let compactPending = false

  merlin.on("turn.end", (event) => {
    ...
  })

  merlin.on("agent.end", () => {
    if (shouldCompact && !compactPending) {
      compactPending = true
      shouldCompact = false
      merlin.send("/compact")
    }
  })
}
```

#### 3. Git Context Hook Example
**File**: `examples/hooks/git-context.ts`
**Location**: lines 8-22

**Before**:
```typescript
export default function gitContext(marvin: HookAPI): void {
  marvin.on("session.start", async () => {
    ...
    marvin.send(context)
  })
}
```

**After**:
```typescript
export default function gitContext(merlin: HookAPI): void {
  merlin.on("session.start", async () => {
    ...
    merlin.send(context)
  })
}
```

#### 4. Tool Logger Hook Example
**File**: `examples/hooks/tool-logger.ts`
**Location**: lines 8-21

**Before**:
```typescript
export default function toolLogger(marvin: HookAPI): void {
  marvin.on("tool.execute.before", (event) => {
    ...
  })
  marvin.on("tool.execute.after", (event) => {
    ...
  })
}
```

**After**:
```typescript
export default function toolLogger(merlin: HookAPI): void {
  merlin.on("tool.execute.before", (event) => {
    ...
  })
  merlin.on("tool.execute.after", (event) => {
    ...
  })
}
```

#### 5. Hook Loader Comments
**File**: `apps/coding-agent/src/hooks/loader.ts`
**Location**: lines 1-7 (docstring)

**Before**:
```typescript
/**
 * Hook loader - discovers and loads TypeScript hook modules.
 *
 * Hooks are loaded from ~/.config/marvin/hooks/*.ts (non-recursive).
 * Uses Bun's native import() which handles TypeScript directly.
 */
```

**After**:
```typescript
/**
 * Hook loader - discovers and loads TypeScript hook modules.
 *
 * Hooks are loaded from ~/.config/merlin/hooks/*.ts (non-recursive).
 * Uses Bun's native import() which handles TypeScript directly.
 */
```

#### 6. Custom Tools Loader Comments
**File**: `apps/coding-agent/src/custom-tools/loader.ts`
**Location**: lines 1-7 (docstring)

**Before**:
```typescript
/**
 * Custom tool loader - discovers and loads TypeScript tool modules.
 *
 * Tools are loaded from ~/.config/marvin/tools/*.ts (non-recursive).
 * Uses Bun's native import() which handles TypeScript directly.
 */
```

**After**:
```typescript
/**
 * Custom tool loader - discovers and loads TypeScript tool modules.
 *
 * Tools are loaded from ~/.config/merlin/tools/*.ts (non-recursive).
 * Uses Bun's native import() which handles TypeScript directly.
 */
```

### Success Criteria

**Automated**:
```bash
bun run typecheck
bun run test
```

**Manual**:
- [ ] Example hooks execute without errors
- [ ] Hook type definitions compile

### Rollback
```bash
git restore -- apps/coding-agent/src/hooks/ apps/coding-agent/examples/ examples/hooks/
```

---

## Phase 5: Default Theme Name

### Overview
Rename the built-in default theme from "marvin" to "merlin".

### Prerequisites
- [ ] Phase 2 complete

### Change Checklist
- [ ] Theme names list
- [ ] Config default theme
- [ ] Theme provider resolution
- [ ] Theme provider available themes list

### Changes

#### 1. Theme Names Constant
**File**: `apps/coding-agent/src/theme-names.ts`
**Location**: line 7

**Before**:
```typescript
export const THEME_NAMES = [
	"marvin",
	"aura",
```

**After**:
```typescript
export const THEME_NAMES = [
	"merlin",
	"aura",
```

#### 2. Config Default Theme
**File**: `apps/coding-agent/src/config.ts`
**Location**: line 191

**Before**:
```typescript
  const theme = typeof themeRaw === 'string' && themeRaw.trim() ? themeRaw.trim() : 'marvin';
```

**After**:
```typescript
  const theme = typeof themeRaw === 'string' && themeRaw.trim() ? themeRaw.trim() : 'merlin';
```

#### 3. Theme Provider Default
**File**: `packages/open-tui/src/context/theme.tsx`
**Location**: line 575

**Before**:
```typescript
export interface ThemeProviderProps extends ParentProps {
	/** Initial theme mode */
	mode?: ThemeMode
	/** Initial theme name (default: "marvin") */
	themeName?: string
```

**After**:
```typescript
export interface ThemeProviderProps extends ParentProps {
	/** Initial theme mode */
	mode?: ThemeMode
	/** Initial theme name (default: "merlin") */
	themeName?: string
```

#### 4. Theme Provider Store Default
**File**: `packages/open-tui/src/context/theme.tsx`
**Location**: line 586

**Before**:
```typescript
	const [store, setStore] = createStore({
		mode: props.mode ?? "dark",
		themeName: props.themeName ?? "marvin",
	})
```

**After**:
```typescript
	const [store, setStore] = createStore({
		mode: props.mode ?? "dark",
		themeName: props.themeName ?? "merlin",
	})
```

#### 5. Theme Resolution Check
**File**: `packages/open-tui/src/context/theme.tsx`
**Location**: lines 607-608

**Before**:
```typescript
		// "marvin" is the built-in default
		if (name === "marvin" || !BUILTIN_THEMES[name]) {
```

**After**:
```typescript
		// "merlin" is the built-in default
		if (name === "merlin" || !BUILTIN_THEMES[name]) {
```

#### 6. Available Themes List
**File**: `packages/open-tui/src/context/theme.tsx`
**Location**: line 645

**Before**:
```typescript
		availableThemes: (): string[] => ["marvin", ...Object.keys(BUILTIN_THEMES)],
```

**After**:
```typescript
		availableThemes: (): string[] => ["merlin", ...Object.keys(BUILTIN_THEMES)],
```

### Success Criteria

**Automated**:
```bash
bun run typecheck
bun run test
```

**Before proceeding**:
```bash
# Verify theme list
bun run merlin --help  # Should work
```

**Manual**:
- [ ] `/theme` command lists "merlin" first
- [ ] Default theme renders correctly (same colors as before)

### Rollback
```bash
git restore -- apps/coding-agent/src/theme-names.ts apps/coding-agent/src/config.ts packages/open-tui/src/context/theme.tsx
```

---

## Phase 6: Environment Variables

### Overview
Rename environment variables from `MARVIN_*` to `MERLIN_*`.

### Prerequisites
- [ ] Phase 2 complete

### Change Checklist
- [ ] MARVIN_TUI_PROFILE → MERLIN_TUI_PROFILE
- [ ] MARVIN_COMPACT_THRESHOLD → MERLIN_COMPACT_THRESHOLD

### Changes

#### 1. Profiler Environment Variable
**File**: `apps/coding-agent/src/profiler.ts`
**Location**: line 5

**Before**:
```typescript
const enabled = process.env["MARVIN_TUI_PROFILE"] === "1"
```

**After**:
```typescript
const enabled = process.env["MERLIN_TUI_PROFILE"] === "1"
```

#### 2. Auto-Compact Example Env Var
**File**: `apps/coding-agent/examples/auto-compact.ts`
**Location**: lines 7, 16

**Before**:
```typescript
 *   MARVIN_COMPACT_THRESHOLD - percentage threshold (default: 85)
...
	const threshold = Number(process.env.MARVIN_COMPACT_THRESHOLD) || 85
```

**After**:
```typescript
 *   MERLIN_COMPACT_THRESHOLD - percentage threshold (default: 85)
...
	const threshold = Number(process.env.MERLIN_COMPACT_THRESHOLD) || 85
```

### Success Criteria

**Automated**:
```bash
bun run typecheck
bun run test
```

**Manual**:
- [ ] `MERLIN_TUI_PROFILE=1 merlin` enables profiling output

### Rollback
```bash
git restore -- apps/coding-agent/src/profiler.ts apps/coding-agent/examples/auto-compact.ts
```

---

## Phase 7: Personal Configuration Migration

### Overview
Copy personal config from `~/.config/marvin/` to `~/.config/merlin/` and update internal references.

### Prerequisites
- [ ] Phase 3 complete (migration helper exists)
- [ ] Phase 4, 5, 6 complete (conventions updated)

### Change Checklist
- [ ] Run migration command
- [ ] Update hook imports in copied files
- [ ] Update hook parameter names
- [ ] Update tool imports
- [ ] Update ~/.zshrc alias

### Changes

#### 1. Run Migration
**Command**:
```bash
merlin migrate
```

**Expected output**:
```
Copying /Users/yesh/.config/marvin → ~/.config/merlin/
Migration complete. You can now delete ~/.config/marvin/ if desired.
```

#### 2. Update Hook Imports
**Files**: `~/.config/merlin/hooks/*.ts`

**Before** (in each hook file):
```typescript
import type { HookAPI } from "@marvin-agents/coding-agent/hooks"
```

**After**:
```typescript
import type { HookAPI } from "@merlin-agents/coding-agent/hooks"
```

**Command**:
```bash
sed -i '' 's/@marvin-agents/@merlin-agents/g' ~/.config/merlin/hooks/*.ts
```

#### 3. Update Hook Parameter Names
**Files**: `~/.config/merlin/hooks/*.ts`

**Before**:
```typescript
export default function autoCompact(marvin: HookAPI): void {
  marvin.on(...)
  marvin.send(...)
}
```

**After**:
```typescript
export default function autoCompact(merlin: HookAPI): void {
  merlin.on(...)
  merlin.send(...)
}
```

**Command**:
```bash
# For each hook file
sed -i '' 's/(marvin:/(merlin:/g; s/marvin\.on/merlin.on/g; s/marvin\.send/merlin.send/g' ~/.config/merlin/hooks/*.ts
```

#### 4. Update Tool Imports
**Files**: `~/.config/merlin/tools/*.ts`

**Command**:
```bash
sed -i '' 's/@marvin-agents/@merlin-agents/g' ~/.config/merlin/tools/*.ts 2>/dev/null || true
```

#### 5. Update Environment Variable References
**File**: `~/.config/merlin/hooks/auto-compact.ts`

**Before**:
```typescript
const threshold = Number(process.env.MARVIN_COMPACT_THRESHOLD) || 90
```

**After**:
```typescript
const threshold = Number(process.env.MERLIN_COMPACT_THRESHOLD) || 90
```

#### 6. Update Shell Alias
**File**: `~/.zshrc`
**Location**: lines 435-436

**Before**:
```bash
# Marvin alias
alias mr="marvin --model claude-opus-4-5,codex/gpt-5.2-codex,opencode/glm-4.7-free"
```

**After**:
```bash
# Merlin alias
alias mr="merlin --model claude-opus-4-5,codex/gpt-5.2-codex,opencode/glm-4.7-free"
```

**Command**:
```bash
sed -i '' 's/# Marvin alias/# Merlin alias/; s/marvin --model/merlin --model/' ~/.zshrc
source ~/.zshrc
```

### Success Criteria

**Manual**:
- [ ] `merlin` starts without import errors
- [ ] Hooks load and execute (check with `/status` or trigger a hook)
- [ ] `mr` alias works after sourcing zshrc
- [ ] Custom tools load without errors

### Rollback
```bash
# Remove migrated config (original still exists)
rm -rf ~/.config/merlin

# Restore zshrc
git -C ~ restore .zshrc  # or restore from backup
```

---

## Phase 8: GitHub/Repository References

### Overview
Update GitHub repository references in package.json files and documentation.

### Prerequisites
- [ ] Phase 1-6 complete
- [ ] Decision made on repo rename (manual, separate from this plan)

### Change Checklist
- [ ] packages/ai/package.json repository URL
- [ ] packages/agent/package.json repository URL
- [ ] packages/open-tui/package.json repository URL
- [ ] CHANGELOG.md references (optional — historical)

### Changes

#### 1. AI Package Repository
**File**: `packages/ai/package.json`
**Location**: line 47

**Before**:
```json
		"url": "git+https://github.com/Yeshwanthyk/marvin.git",
```

**After**:
```json
		"url": "git+https://github.com/Yeshwanthyk/merlin.git",
```

#### 2. Agent Package Repository
**File**: `packages/agent/package.json`
**Location**: line 35

**Before**:
```json
		"url": "git+https://github.com/Yeshwanthyk/marvin.git",
```

**After**:
```json
		"url": "git+https://github.com/Yeshwanthyk/merlin.git",
```

#### 3. Open TUI Package Repository
**File**: `packages/open-tui/package.json`
**Location**: line 33

**Before**:
```json
		"url": "git+https://github.com/Yeshwanthyk/marvin.git",
```

**After**:
```json
		"url": "git+https://github.com/Yeshwanthyk/merlin.git",
```

#### 4. Note on CHANGELOG.md
**File**: `packages/ai/CHANGELOG.md`

**Decision**: Leave historical PR/issue references as-is. GitHub redirects work after repo rename. Updating would rewrite history.

### Success Criteria

**Automated**:
```bash
bun run typecheck
```

**Manual**:
- [ ] `npm pkg get repository` shows new URL in each package

### Rollback
```bash
git restore -- packages/*/package.json
```

---

## Phase 9: Documentation Updates

### Overview
Update documentation files to reflect the new naming.

### Prerequisites
- [ ] All previous phases complete

### Change Checklist
- [ ] README.md (root)
- [ ] apps/coding-agent/README.md
- [ ] packages/*/README.md
- [ ] docs/*.md (selective)
- [ ] plans/*.md (preserve historical plans, update active ones)

### Changes

#### 1. Root README.md
**File**: `README.md`

**Bulk replacement**:
```bash
sed -i '' 's/marvin/merlin/g; s/Marvin/Merlin/g' README.md
```

**Manual review needed for**:
- Title: `# merlin`
- Install paths
- Usage examples
- Config paths

#### 2. Coding Agent README.md
**File**: `apps/coding-agent/README.md`

**Bulk replacement**:
```bash
sed -i '' 's/marvin/merlin/g; s/Marvin/Merlin/g; s/@marvin-agents/@merlin-agents/g' apps/coding-agent/README.md
```

#### 3. Package READMEs
**Files**: `packages/*/README.md`

**Command**:
```bash
for f in packages/*/README.md; do
  sed -i '' 's/marvin/merlin/g; s/Marvin/Merlin/g; s/@marvin-agents/@merlin-agents/g' "$f"
done
```

#### 4. Architecture Docs
**File**: `docs/architecture.md`

**Selective update** — focus on:
- Config paths (`~/.config/marvin/` → `~/.config/merlin/`)
- Package names (`@marvin-agents/*` → `@merlin-agents/*`)

**Command**:
```bash
sed -i '' 's/~\/.config\/marvin/~\/.config\/merlin/g; s/@marvin-agents/@merlin-agents/g' docs/architecture.md
```

#### 5. Examples README
**File**: `examples/hooks/README.md`

**Command**:
```bash
sed -i '' 's/marvin/merlin/g; s/Marvin/Merlin/g; s/@marvin-agents/@merlin-agents/g' examples/hooks/README.md
```

#### 6. Plans — Active vs Historical

**Keep unchanged** (historical reference):
- `plans/2025-01-11-publish-marvin-packages.md`
- `plans/2025-12-23-marvin-embedded-sdk.md`
- `plans/2025-01-14-marvin-desktop-tauri.md`
- Other completed/historical plans

**Update** (if still active):
- Any in-progress plans that reference the old name in future work

### Success Criteria

**Manual**:
- [ ] README.md renders correctly with new name
- [ ] No broken internal links
- [ ] Code examples in docs use correct package names

### Rollback
```bash
git restore -- README.md apps/coding-agent/README.md packages/*/README.md docs/*.md examples/*/README.md
```

---

## Testing Strategy

### Unit Tests to Verify

**Existing tests should pass**:
```bash
bun run test
```

**Config tests** (`apps/coding-agent/tests/config.test.ts`):
- May need update if they hardcode `marvin` path

**Hook tests** (`apps/coding-agent/tests/hooks.test.ts`):
- Verify hooks still load from new path

### Integration Tests

**Full app startup**:
```bash
bun run merlin --help
bun run merlin --headless "echo test"
```

**Config migration**:
```bash
# Setup
mkdir -p /tmp/test-marvin
echo '{"provider":"anthropic","model":"claude-sonnet-4"}' > /tmp/test-marvin/config.json

# Test migration
MERLIN_CONFIG_DIR=/tmp/test-merlin merlin migrate
ls /tmp/test-merlin/config.json
```

### Manual Testing Checklist
1. [ ] Fresh install: `merlin` creates `~/.config/merlin/` on first run
2. [ ] Migration: `merlin migrate` copies all files from old to new location
3. [ ] Hooks: Custom hooks load and execute
4. [ ] Tools: Custom tools load and are available
5. [ ] Sessions: Resume works with migrated sessions
6. [ ] Themes: `/theme merlin` applies default theme
7. [ ] Env vars: `MERLIN_TUI_PROFILE=1` enables profiling

## Deployment Instructions

### Build New Binary
```bash
cd apps/coding-agent && bun run build
# Output: ~/commands/merlin
```

### Update PATH
Ensure `~/commands/` is in PATH, or:
```bash
ln -sf ~/commands/merlin ~/.local/bin/merlin
```

### Verify Installation
```bash
which merlin
merlin --version
```

## Anti-Patterns to Avoid
- **Don't delete old config**: Users may have uncommitted changes
- **Don't force migration**: Warn, don't block
- **Don't update historical plans**: They're documentation of past decisions
- **Don't rename GitHub repo first**: Code changes should land first

## Open Questions (must resolve before implementation)
- [x] Should we support both config paths during transition? → Yes, warn if legacy exists
- [x] Should CHANGELOG.md PR links be updated? → No, GitHub redirects work
- [x] Should historical plans be updated? → No, preserve as documentation
- [x] What's the strategy for personal config? → Copy, then update in place

## References
- Analysis document: This conversation's earlier analysis
- Similar rename: N/A (first major rename)
- Config loading: `apps/coding-agent/src/config.ts`
- Theme system: `packages/open-tui/src/context/theme.tsx`
- Hook system: `apps/coding-agent/src/hooks/`
