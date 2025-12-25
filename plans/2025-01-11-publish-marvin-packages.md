# Publish @marvin-agents/* Packages to npm

## Overview

Make all `@marvin-agents/*` packages publishable to npm using the pi-mono pattern: semver deps + tsconfig paths for dev, dist entrypoints always, lockstep versioning.

## Current State

### Package Status

| Package | Version | private | Entrypoints | Build | Internal Deps |
|---------|---------|---------|-------------|-------|---------------|
| `@marvin-agents/ai` | 0.23.3 | no | `src/index.ts` | ✓ | none |
| `@marvin-agents/agent-core` | 0.23.3 | no | `src/index.ts` | ✓ | `file:../ai` |
| `@marvin-agents/base-tools` | 0.1.0 | **yes** | `src/index.ts` | ✗ | `file:../ai` |
| `@marvin-agents/lsp` | 0.1.0 | **yes** | `src/index.ts` | ✗ | `file:../ai` |

### Key Discoveries

- Pi-mono uses **semver deps + tsconfig paths** — package.json looks publishable, TS resolves to src/ via paths
- Opencode uses **exports rewriting** — more complex, same result
- npm's `publishConfig` does NOT override `main`/`types`/`exports` — only registry/tag/access
- Both references use **custom lockstep versioning**, not changesets

### Reference Implementation

From pi-mono's `tsconfig.json`:
```json
{
  "compilerOptions": {
    "paths": {
      "@mariozechner/pi-ai": ["./packages/ai/src/index.ts"],
      "@mariozechner/pi-agent-core": ["./packages/agent/src/index.ts"]
    }
  }
}
```

From pi-mono's package.json deps:
```json
"dependencies": {
  "@mariozechner/pi-ai": "^0.27.6",
  "@mariozechner/pi-agent-core": "^0.27.6"
}
```

## Desired End State

1. All packages publishable with `npm publish -ws --access public`
2. Package.json deps are semver (`"^0.24.0"`), not `file:`
3. TypeScript paths resolve to `src/` for local dev
4. Entrypoints always point to `dist/`
5. Lockstep versioning via `sync-versions.js`
6. Hooks can `npm install @marvin-agents/ai`

### Verification

```bash
# Build + publish dry run
bun run build:packages
npm publish -ws --access public --dry-run

# Test in isolated environment
mkdir /tmp/test-marvin && cd /tmp/test-marvin
npm init -y
npm install @marvin-agents/ai @marvin-agents/base-tools
node -e "import('@marvin-agents/ai').then(m => console.log(Object.keys(m)))"
```

## Out of Scope

- `@marvin-agents/open-tui` — TUI framework, not needed for hooks/SDK
- CI/CD automation (manual first)
- SDK creation (separate plan)

---

## Phase 1: Add Build Infrastructure

### Overview

Add `tsconfig.build.json` and build scripts to `base-tools` and `lsp`.

### Prerequisites

- [ ] Working tree clean
- [ ] `bun run check` passes

### Changes

#### 1. Create tsconfig.build.json for base-tools

**File**: `packages/base-tools/tsconfig.build.json` (new)

**Add**:
```json
{
	"extends": "../../tsconfig.base.json",
	"compilerOptions": {
		"outDir": "./dist",
		"rootDir": "./src",
		"declaration": true,
		"declarationMap": true,
		"sourceMap": true
	},
	"include": ["src/**/*.ts"],
	"exclude": ["node_modules", "dist", "**/*.test.ts", "tests"]
}
```

#### 2. Create tsconfig.build.json for lsp

**File**: `packages/lsp/tsconfig.build.json` (new)

**Add**:
```json
{
	"extends": "../../tsconfig.base.json",
	"compilerOptions": {
		"outDir": "./dist",
		"rootDir": "./src",
		"declaration": true,
		"declarationMap": true,
		"sourceMap": true
	},
	"include": ["src/**/*.ts"],
	"exclude": ["node_modules", "dist", "**/*.test.ts", "tests"]
}
```

#### 3. Update base-tools package.json

**File**: `packages/base-tools/package.json`

**Before**:
```json
{
  "name": "@marvin-agents/base-tools",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "main": "src/index.ts",
  "types": "src/index.ts",
  "scripts": {
    "test": "node -e \"process.exit(0)\""
  },
  "dependencies": {
    "@marvin-agents/ai": "file:../ai",
    "@sinclair/typebox": "^0.34.41",
    "diff": "^8.0.2",
    "file-type": "^21.1.1"
  }
}
```

**After**:
```json
{
  "name": "@marvin-agents/base-tools",
  "version": "0.23.3",
  "type": "module",
  "main": "./dist/index.js",
  "types": "./dist/index.d.ts",
  "exports": {
    ".": {
      "types": "./dist/index.d.ts",
      "import": "./dist/index.js"
    },
    "./package.json": "./package.json"
  },
  "files": [
    "dist",
    "README.md"
  ],
  "scripts": {
    "clean": "rm -rf dist",
    "build": "tsc -p tsconfig.build.json",
    "test": "bun test tests",
    "prepublishOnly": "npm run clean && npm run build"
  },
  "dependencies": {
    "@marvin-agents/ai": "^0.23.3",
    "@sinclair/typebox": "^0.34.41",
    "diff": "^8.0.2",
    "file-type": "^21.1.1"
  },
  "keywords": ["ai", "agent", "tools", "coding"],
  "author": "Yesh Yendamuri",
  "license": "MIT",
  "repository": {
    "type": "git",
    "url": "git+https://github.com/Yeshwanthyk/marvin.git",
    "directory": "packages/base-tools"
  },
  "engines": {
    "node": ">=20.0.0"
  }
}
```

**Key changes**:
- Removed `private: true`
- Version synced to `0.23.3`
- Entrypoints point to `dist/`
- Dep changed from `file:../ai` to `^0.23.3`

#### 4. Update lsp package.json

**File**: `packages/lsp/package.json`

**Before**:
```json
{
  "name": "@marvin-agents/lsp",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "main": "src/index.ts",
  "types": "src/index.ts",
  "scripts": {
    "test": "bun test tests"
  },
  "dependencies": {
    "@marvin-agents/ai": "file:../ai",
    "vscode-jsonrpc": "^8.2.1",
    "vscode-languageserver-types": "^3.17.5"
  }
}
```

**After**:
```json
{
  "name": "@marvin-agents/lsp",
  "version": "0.23.3",
  "type": "module",
  "main": "./dist/index.js",
  "types": "./dist/index.d.ts",
  "exports": {
    ".": {
      "types": "./dist/index.d.ts",
      "import": "./dist/index.js"
    },
    "./package.json": "./package.json"
  },
  "files": [
    "dist",
    "README.md"
  ],
  "scripts": {
    "clean": "rm -rf dist",
    "build": "tsc -p tsconfig.build.json",
    "test": "bun test tests",
    "prepublishOnly": "npm run clean && npm run build"
  },
  "dependencies": {
    "@marvin-agents/ai": "^0.23.3",
    "vscode-jsonrpc": "^8.2.1",
    "vscode-languageserver-types": "^3.17.5"
  },
  "keywords": ["ai", "agent", "lsp", "language-server"],
  "author": "Yesh Yendamuri",
  "license": "MIT",
  "repository": {
    "type": "git",
    "url": "git+https://github.com/Yeshwanthyk/marvin.git",
    "directory": "packages/lsp"
  },
  "engines": {
    "node": ">=20.0.0"
  }
}
```

#### 5. Update ai package.json entrypoints

**File**: `packages/ai/package.json`
**Lines**: 5-7

**Before**:
```json
  "main": "src/index.ts",
  "types": "src/index.ts",
  "files": [
```

**After**:
```json
  "main": "./dist/index.js",
  "types": "./dist/index.d.ts",
  "exports": {
    ".": {
      "types": "./dist/index.d.ts",
      "import": "./dist/index.js"
    },
    "./package.json": "./package.json"
  },
  "files": [
```

#### 6. Update agent-core package.json

**File**: `packages/agent/package.json`
**Lines**: 5-12

**Before**:
```json
  "main": "src/index.ts",
  "types": "src/index.ts",
  "files": [
    "dist",
    "README.md"
  ],
```

**After**:
```json
  "main": "./dist/index.js",
  "types": "./dist/index.d.ts",
  "exports": {
    ".": {
      "types": "./dist/index.d.ts",
      "import": "./dist/index.js"
    },
    "./package.json": "./package.json"
  },
  "files": [
    "dist",
    "README.md"
  ],
```

#### 7. Update agent-core dependency to semver

**File**: `packages/agent/package.json`

**Before** (in dependencies):
```json
  "dependencies": {
    "@marvin-agents/ai": "file:../ai"
  }
```

**After**:
```json
  "dependencies": {
    "@marvin-agents/ai": "^0.23.3"
  }
```

### Success Criteria

```bash
# All packages build
cd packages/ai && npm run build && ls dist/index.js
cd packages/agent && npm run build && ls dist/index.js
cd packages/base-tools && npm run build && ls dist/index.js
cd packages/lsp && npm run build && ls dist/index.js
```

### Rollback

```bash
git checkout HEAD -- packages/
```

---

## Phase 2: Add TypeScript Paths for Dev Resolution

### Overview

Add tsconfig paths so TypeScript resolves `@marvin-agents/*` to local `src/` during development.

### Prerequisites

- [ ] Phase 1 builds succeed

### Changes

#### 1. Update root tsconfig.json (create if needed)

**File**: `tsconfig.json` (new or update)

**Add**:
```json
{
  "extends": "./tsconfig.base.json",
  "compilerOptions": {
    "noEmit": true,
    "paths": {
      "@marvin-agents/ai": ["./packages/ai/src/index.ts"],
      "@marvin-agents/ai/*": ["./packages/ai/src/*"],
      "@marvin-agents/agent-core": ["./packages/agent/src/index.ts"],
      "@marvin-agents/agent-core/*": ["./packages/agent/src/*"],
      "@marvin-agents/base-tools": ["./packages/base-tools/src/index.ts"],
      "@marvin-agents/base-tools/*": ["./packages/base-tools/src/*"],
      "@marvin-agents/lsp": ["./packages/lsp/src/index.ts"],
      "@marvin-agents/lsp/*": ["./packages/lsp/src/*"]
    }
  },
  "include": [
    "packages/*/src/**/*",
    "packages/*/test/**/*",
    "apps/*/src/**/*"
  ]
}
```

**Why**: TypeScript uses these paths during type-checking. Bun also respects tsconfig paths at runtime.

#### 2. Update coding-agent dependencies to semver

**File**: `apps/coding-agent/package.json`

**Before** (in dependencies):
```json
  "dependencies": {
    "@marvin-agents/agent-core": "file:../../packages/agent",
    "@marvin-agents/ai": "file:../../packages/ai",
    "@marvin-agents/base-tools": "file:../../packages/base-tools",
    "@marvin-agents/lsp": "file:../../packages/lsp",
    "@marvin-agents/open-tui": "file:../../packages/open-tui",
```

**After**:
```json
  "dependencies": {
    "@marvin-agents/agent-core": "^0.23.3",
    "@marvin-agents/ai": "^0.23.3",
    "@marvin-agents/base-tools": "^0.23.3",
    "@marvin-agents/lsp": "^0.23.3",
    "@marvin-agents/open-tui": "file:../../packages/open-tui",
```

**Note**: Keep `open-tui` as `file:` since we're not publishing it.

### Success Criteria

```bash
# TypeScript resolves correctly
bun run typecheck

# Runtime resolves correctly (Bun respects tsconfig paths)
bun run marvin --help

# Test local dev workflow
bun run check
```

### Rollback

```bash
git checkout HEAD -- tsconfig.json apps/coding-agent/package.json
```

---

## Phase 3: Add Lockstep Versioning Script

### Overview

Create `sync-versions.js` to enforce all packages stay at same version.

### Prerequisites

- [ ] Phase 2 succeeds

### Changes

#### 1. Create sync-versions script

**File**: `scripts/sync-versions.js` (new)

**Add**:
```javascript
#!/usr/bin/env node

/**
 * Syncs ALL @marvin-agents/* package dependency versions to match their current versions.
 * Ensures lockstep versioning across the monorepo.
 * 
 * Usage: node scripts/sync-versions.js
 */

import { readFileSync, writeFileSync, readdirSync } from 'fs';
import { join } from 'path';

const packagesDir = join(process.cwd(), 'packages');
const appsDir = join(process.cwd(), 'apps');

// Packages to sync (excludes open-tui)
const SYNC_PACKAGES = ['ai', 'agent', 'base-tools', 'lsp'];

// Read package.json files
function readPkg(dir) {
  const pkgPath = join(dir, 'package.json');
  try {
    return { path: pkgPath, data: JSON.parse(readFileSync(pkgPath, 'utf8')) };
  } catch {
    return null;
  }
}

// Collect all packages
const packages = new Map();
const versionMap = new Map();

for (const name of SYNC_PACKAGES) {
  const pkg = readPkg(join(packagesDir, name));
  if (pkg) {
    packages.set(name, pkg);
    versionMap.set(pkg.data.name, pkg.data.version);
  }
}

// Also check apps
for (const name of readdirSync(appsDir, { withFileTypes: true }).filter(d => d.isDirectory()).map(d => d.name)) {
  const pkg = readPkg(join(appsDir, name));
  if (pkg) packages.set(`apps/${name}`, pkg);
}

console.log('Current versions:');
for (const [name, version] of [...versionMap.entries()].sort()) {
  console.log(`  ${name}: ${version}`);
}

// Verify lockstep
const versions = new Set(versionMap.values());
if (versions.size > 1) {
  console.error('\n❌ ERROR: Not all packages have the same version!');
  console.error('Run: npm run version:patch (or minor/major)');
  process.exit(1);
}

console.log('\n✅ All packages at same version (lockstep)');

// Update inter-package dependencies
let totalUpdates = 0;

for (const [dir, pkg] of packages) {
  let updated = false;
  
  for (const depType of ['dependencies', 'devDependencies']) {
    const deps = pkg.data[depType];
    if (!deps) continue;
    
    for (const [depName, currentVersion] of Object.entries(deps)) {
      const targetVersion = versionMap.get(depName);
      if (targetVersion) {
        const newVersion = `^${targetVersion}`;
        if (currentVersion !== newVersion && !currentVersion.startsWith('file:')) {
          console.log(`${pkg.data.name}: ${depName} ${currentVersion} → ${newVersion}`);
          deps[depName] = newVersion;
          updated = true;
          totalUpdates++;
        }
      }
    }
  }
  
  if (updated) {
    writeFileSync(pkg.path, JSON.stringify(pkg.data, null, 2) + '\n');
  }
}

if (totalUpdates === 0) {
  console.log('All inter-package dependencies in sync.');
} else {
  console.log(`\n✅ Updated ${totalUpdates} dependency version(s)`);
}
```

#### 2. Add version scripts to root package.json

**File**: `package.json`

**Before** (scripts):
```json
  "scripts": {
    "typecheck": "...",
    "test": "bun scripts/test-all.ts",
    "check": "bun run typecheck && bun run test",
    "build": "cd apps/coding-agent && bun scripts/build.ts",
    "marvin": "bun apps/coding-agent/src/index.ts"
  },
```

**After**:
```json
  "scripts": {
    "typecheck": "tsc --noEmit",
    "test": "bun scripts/test-all.ts",
    "check": "bun run typecheck && bun run test",
    "build": "cd apps/coding-agent && bun scripts/build.ts",
    "build:packages": "npm run build -w @marvin-agents/ai && npm run build -w @marvin-agents/agent-core && npm run build -w @marvin-agents/base-tools && npm run build -w @marvin-agents/lsp",
    "marvin": "bun apps/coding-agent/src/index.ts",
    "sync-versions": "node scripts/sync-versions.js",
    "version:patch": "npm version patch -ws --no-git-tag-version && npm run sync-versions",
    "version:minor": "npm version minor -ws --no-git-tag-version && npm run sync-versions",
    "version:major": "npm version major -ws --no-git-tag-version && npm run sync-versions",
    "prepublishOnly": "npm run build:packages && npm run check",
    "publish:packages": "npm run prepublishOnly && npm publish -ws --access public",
    "publish:dry": "npm run prepublishOnly && npm publish -ws --access public --dry-run"
  },
```

**Note**: Changed `typecheck` to use root tsconfig.json with paths.

### Success Criteria

```bash
# Sync check passes
node scripts/sync-versions.js

# Version bump works
npm run version:patch
git diff packages/*/package.json  # All versions bumped
git checkout -- packages/  # Revert test

# Dry run publish
npm run publish:dry
```

### Rollback

```bash
rm scripts/sync-versions.js
git checkout HEAD -- package.json
```

---

## Phase 4: Add READMEs

### Overview

Add minimal READMEs for npm package pages.

### Prerequisites

- [ ] Phase 3 succeeds

### Changes

#### 1. Create README for base-tools

**File**: `packages/base-tools/README.md` (new)

**Add**:
```markdown
# @marvin-agents/base-tools

Core file system and shell tools for AI coding agents.

## Tools

- **read** — Read file contents (text and images)
- **write** — Write content to files
- **edit** — Surgical text replacement
- **bash** — Execute shell commands

## Installation

```bash
npm install @marvin-agents/base-tools
```

## Usage

```typescript
import { codingTools, readTool, bashTool } from '@marvin-agents/base-tools';

// Use all tools
const tools = codingTools;

// Or individual tools
const result = await readTool.execute('id', { path: './file.ts' });
```

## License

MIT
```

#### 2. Create README for lsp

**File**: `packages/lsp/README.md` (new)

**Add**:
```markdown
# @marvin-agents/lsp

LSP integration for AI coding agents. Provides real-time diagnostics from language servers.

## Installation

```bash
npm install @marvin-agents/lsp
```

## Usage

```typescript
import { createLspManager, wrapToolsWithLspDiagnostics } from '@marvin-agents/lsp';

const lsp = createLspManager({ cwd: process.cwd(), enabled: true });
const tools = wrapToolsWithLspDiagnostics(baseTools, lsp, { cwd });
```

## License

MIT
```

### Success Criteria

```bash
ls packages/base-tools/README.md packages/lsp/README.md
```

---

## Phase 5: First Publish

### Overview

Publish all packages to npm.

### Prerequisites

- [ ] All previous phases complete
- [ ] `npm whoami` returns your username
- [ ] All changes committed

### Steps

#### 1. Final build and check

```bash
npm run build:packages
npm run check
```

#### 2. Dry run

```bash
npm run publish:dry
```

Verify output shows all 4 packages would be published.

#### 3. Publish

```bash
npm run publish:packages
```

#### 4. Tag release

```bash
VERSION=$(node -p "require('./packages/ai/package.json').version")
git tag -a "v${VERSION}" -m "Release v${VERSION}"
git push origin main --tags
```

### Success Criteria

```bash
# Packages visible on npm
npm view @marvin-agents/ai
npm view @marvin-agents/agent-core
npm view @marvin-agents/base-tools
npm view @marvin-agents/lsp

# Installable
mkdir /tmp/test && cd /tmp/test
npm init -y
npm install @marvin-agents/ai @marvin-agents/base-tools
node -e "import('@marvin-agents/ai').then(m => console.log('OK:', Object.keys(m).length, 'exports'))"
```

---

## Phase 6: Update Hooks to Use Published Packages

### Overview

Install published packages in hooks directory and update `auto-compact-90.ts` to use them instead of hardcoded values.

### Prerequisites

- [ ] Phase 5 complete

### Steps

#### 1. Initialize hooks directory as npm package

```bash
cd ~/.config/marvin/hooks
npm init -y
npm install @marvin-agents/ai
```

#### 2. Update auto-compact-90.ts

Remove hardcoded `CONTEXT_WINDOWS` map and restore `@marvin-agents/ai` import:

**Before** (current workaround):
```typescript
// Hardcoded context windows to avoid @marvin-agents/ai dependency
const CONTEXT_WINDOWS: Record<string, number> = { ... }

const resolveContextWindow = (_provider: string, modelId: string): number | null => {
	return CONTEXT_WINDOWS[modelId] ?? null
}
```

**After**:
```typescript
import { getModels } from "@marvin-agents/ai"

const resolveContextWindow = (provider: string, modelId: string): number | null => {
	const models = getModels(provider as Parameters<typeof getModels>[0])
	const model = models.find((m) => m.id === modelId)
	return model?.contextWindow ?? null
}
```

### Success Criteria

```bash
# From any directory
cd /tmp
marvin  # Hook loads without "Cannot find module" error

# Verify auto-compact hook works
MARVIN_TUI_PROFILE=1 marvin 2>&1 | grep -v "Hook load error"
```

### Notes

The hook currently uses a hardcoded `CONTEXT_WINDOWS` map as a workaround until packages are published. See `~/.config/marvin/hooks/auto-compact-90.ts` TODO comment.

---

## Appendix: Workflow After Setup

### Daily Development

```bash
# No build needed - Bun uses tsconfig paths
bun run marvin

# Type checking
bun run check
```

### Before PR

```bash
bun run check
```

### Releasing

```bash
# Bump version (all packages together)
npm run version:patch  # or minor/major

# Commit
git add -A
git commit -m "chore: bump version to $(node -p "require('./packages/ai/package.json').version")"

# Publish
npm run publish:packages

# Tag
VERSION=$(node -p "require('./packages/ai/package.json').version")
git tag -a "v${VERSION}" -m "Release v${VERSION}"
git push origin main --tags
```

---

## References

- Pi-mono publish pattern: `/Users/yesh/Documents/personal/reference/pi-mono/package.json`
- Pi-mono tsconfig paths: `/Users/yesh/Documents/personal/reference/pi-mono/tsconfig.json`
- Pi-mono sync-versions: `/Users/yesh/Documents/personal/reference/pi-mono/scripts/sync-versions.js`
