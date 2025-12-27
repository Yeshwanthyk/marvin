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

## Distribution Strategy

Because marvin uses `@opentui/core` (native dylib + tree-sitter WASM), we use a **dual distribution model**:

1. **Library packages** → npm (`@marvin-agents/ai`, `@marvin-agents/base-tools`, etc.)
   - For hooks, custom tools, embedding in other projects
   - Standard `npm install @marvin-agents/ai`

2. **CLI binary** → GitHub Releases (compiled standalone executables)
   - Self-contained Bun binary with all deps embedded
   - Platform-specific: darwin-arm64, darwin-x64, linux-x64, linux-arm64
   - Users update via `marvin update` command

This differs from pi-mono (which can use `npm install -g` because pi-tui is pure JS) and follows opencode's model (native deps require compiled binaries).

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

## Phase 7: Add Self-Update Command

### Overview

Add `marvin update` command that checks GitHub releases and updates the binary in-place.

### Prerequisites

- [ ] Phase 6 complete
- [ ] GitHub releases exist (Phase 8)

### Changes

#### 1. Create updater module

**File**: `apps/coding-agent/src/updater.ts` (new)

**Add**:
```typescript
import { existsSync, unlinkSync, renameSync, chmodSync } from 'node:fs';
import { dirname } from 'node:path';
import pkg from '../package.json';

const GITHUB_REPO = 'Yeshwanthyk/marvin';
const RELEASES_URL = `https://api.github.com/repos/${GITHUB_REPO}/releases/latest`;

interface Release {
  tag_name: string;
  assets: { name: string; browser_download_url: string }[];
}

export async function checkForUpdate(): Promise<{ available: boolean; current: string; latest: string }> {
  const current = pkg.version;
  try {
    const res = await fetch(RELEASES_URL, {
      headers: { 'User-Agent': 'marvin-updater' },
    });
    if (!res.ok) return { available: false, current, latest: current };
    
    const release: Release = await res.json();
    const latest = release.tag_name.replace(/^v/, '');
    const available = latest !== current && compareVersions(latest, current) > 0;
    
    return { available, current, latest };
  } catch {
    return { available: false, current, latest: current };
  }
}

export async function performUpdate(silent = false): Promise<boolean> {
  const log = silent ? () => {} : console.log;
  
  const { available, current, latest } = await checkForUpdate();
  if (!available) {
    log(`Already at latest version (${current})`);
    return false;
  }
  
  log(`Updating marvin: ${current} → ${latest}`);
  
  const platform = process.platform === 'darwin' ? 'darwin' : 'linux';
  const arch = process.arch === 'arm64' ? 'arm64' : 'x64';
  const assetName = `marvin-${platform}-${arch}.tar.gz`;
  
  try {
    const res = await fetch(RELEASES_URL, {
      headers: { 'User-Agent': 'marvin-updater' },
    });
    const release: Release = await res.json();
    const asset = release.assets.find(a => a.name === assetName);
    
    if (!asset) {
      console.error(`No binary found for ${platform}-${arch}`);
      return false;
    }
    
    log(`Downloading ${assetName}...`);
    const downloadRes = await fetch(asset.browser_download_url, {
      headers: { 'User-Agent': 'marvin-updater' },
      redirect: 'follow',
    });
    
    if (!downloadRes.ok) {
      console.error(`Download failed: ${downloadRes.status}`);
      return false;
    }
    
    const execPath = process.execPath;
    const tempPath = `${execPath}.new`;
    const backupPath = `${execPath}.bak`;
    
    // Extract and write new binary
    const tarball = await downloadRes.arrayBuffer();
    const extracted = await extractTarGz(new Uint8Array(tarball));
    await Bun.write(tempPath, extracted);
    chmodSync(tempPath, 0o755);
    
    // Atomic swap
    if (existsSync(backupPath)) unlinkSync(backupPath);
    renameSync(execPath, backupPath);
    renameSync(tempPath, execPath);
    
    log(`✅ Updated to ${latest}`);
    log(`   Backup saved to ${backupPath}`);
    
    return true;
  } catch (err) {
    console.error('Update failed:', err);
    return false;
  }
}

async function extractTarGz(data: Uint8Array): Promise<Uint8Array> {
  // Use Bun's built-in decompression
  const decompressed = Bun.gunzipSync(data);
  
  // Simple tar extraction - find the marvin binary
  // TAR format: 512-byte header blocks, file content follows
  let offset = 0;
  while (offset < decompressed.length) {
    const header = decompressed.slice(offset, offset + 512);
    if (header[0] === 0) break; // End of archive
    
    const name = new TextDecoder().decode(header.slice(0, 100)).replace(/\0/g, '').trim();
    const sizeOctal = new TextDecoder().decode(header.slice(124, 136)).replace(/\0/g, '').trim();
    const size = parseInt(sizeOctal, 8) || 0;
    
    offset += 512; // Move past header
    
    if (name === 'marvin' || name.endsWith('/marvin')) {
      return decompressed.slice(offset, offset + size);
    }
    
    // Move to next file (size rounded up to 512-byte boundary)
    offset += Math.ceil(size / 512) * 512;
  }
  
  throw new Error('marvin binary not found in archive');
}

function compareVersions(a: string, b: string): number {
  const pa = a.split('.').map(Number);
  const pb = b.split('.').map(Number);
  for (let i = 0; i < 3; i++) {
    if ((pa[i] || 0) > (pb[i] || 0)) return 1;
    if ((pa[i] || 0) < (pb[i] || 0)) return -1;
  }
  return 0;
}

export async function checkUpdateOnStart(): Promise<void> {
  // Check once per day
  const lastCheckFile = `${process.env.HOME}/.config/marvin/.last-update-check`;
  const now = Date.now();
  
  try {
    if (existsSync(lastCheckFile)) {
      const lastCheck = parseInt(await Bun.file(lastCheckFile).text(), 10);
      if (now - lastCheck < 24 * 60 * 60 * 1000) return; // Less than 24h ago
    }
  } catch {}
  
  await Bun.write(lastCheckFile, String(now));
  
  const { available, latest } = await checkForUpdate();
  if (available) {
    console.log(`\n💡 New version available: ${latest}`);
    console.log(`   Run \`marvin update\` to upgrade\n`);
  }
}
```

#### 2. Add update command to args parser

**File**: `apps/coding-agent/src/args.ts`

**Add** to the args interface and parsing:
```typescript
// In parseArgs function, add:
if (argv[0] === 'update') {
  return { update: true };
}

// In Args interface, add:
update?: boolean;
```

#### 3. Handle update command in main

**File**: `apps/coding-agent/src/index.ts`

**Add** before TUI launch:
```typescript
import { performUpdate, checkUpdateOnStart } from './updater.js';

// In main(), add:
if (args.update) {
  const success = await performUpdate();
  process.exit(success ? 0 : 1);
}

// Before runTui(), add:
checkUpdateOnStart().catch(() => {}); // Silent background check
```

### Success Criteria

```bash
# Check for updates
marvin update

# Should show current version or update if available
```

---

## Phase 8: Multi-Platform Binary Builds

### Overview

Add build script for all platforms and GitHub Actions workflow for releases.

### Prerequisites

- [ ] Phase 7 complete

### Changes

#### 1. Create multi-platform build script

**File**: `apps/coding-agent/scripts/build-all.ts` (new)

**Add**:
```typescript
#!/usr/bin/env bun
/**
 * Build marvin binaries for all platforms.
 * Run from apps/coding-agent directory.
 */
import { $ } from 'bun';
import { mkdirSync, existsSync, readdirSync, realpathSync } from 'node:fs';
import { join, dirname, relative } from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import solidPlugin from '@opentui/solid/bun-plugin';
import pkg from '../package.json';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const projectRoot = join(__dirname, '..');
const distDir = join(projectRoot, 'dist');
const require = createRequire(import.meta.url);

const TARGETS = [
  { os: 'darwin', arch: 'arm64' },
  { os: 'darwin', arch: 'x64' },
  { os: 'linux', arch: 'x64' },
  { os: 'linux', arch: 'arm64' },
];

// Clean and create dist
if (existsSync(distDir)) await $`rm -rf ${distDir}`;
mkdirSync(distDir, { recursive: true });

// Resolve dylib for each platform
const getDylibPath = (os: string, arch: string): string => {
  const packageName = `@opentui/core-${os}-${arch}`;
  try {
    const pkgPath = require.resolve(`${packageName}/package.json`);
    const pkgDir = dirname(pkgPath);
    const files = readdirSync(pkgDir);
    const dylib = files.find(f => f.endsWith('.dylib') || f.endsWith('.so'));
    if (!dylib) throw new Error(`No dylib in ${pkgDir}`);
    return join(pkgDir, dylib);
  } catch (e) {
    console.warn(`Skipping ${packageName}: not installed`);
    return '';
  }
};

// Resolve parser worker
const opentuiCorePath = dirname(require.resolve('@opentui/core/package.json'));
const parserWorkerPath = realpathSync(join(opentuiCorePath, 'parser.worker.js'));
const bunfsRoot = '/$bunfs/root/';
const workerRelativePath = relative(projectRoot, parserWorkerPath).replaceAll('\\', '/');

for (const { os, arch } of TARGETS) {
  const dylibPath = getDylibPath(os, arch);
  if (!dylibPath) continue;

  const name = `marvin-${os}-${arch}`;
  const outDir = join(distDir, name);
  mkdirSync(outDir, { recursive: true });

  console.log(`Building ${name}...`);

  const result = await Bun.build({
    entrypoints: ['./src/index.ts', parserWorkerPath],
    target: 'bun',
    minify: false,
    plugins: [
      solidPlugin,
      {
        name: 'patch-dylib',
        setup(build) {
          build.onLoad({ filter: /index-.*\.js$/ }, async (args) => {
            let contents = await Bun.file(args.path).text();
            const pattern = /import\(`@opentui\/core-\$\{process\.platform\}-\$\{process\.arch\}\/index\.ts`\)/g;
            contents = contents.replace(pattern, `import("${dylibPath}", { with: { type: "file" } }).then(m => ({ default: m.default }))`);
            return { contents, loader: 'js' };
          });
        },
      },
    ],
    naming: { asset: '[name].[ext]' },
    define: {
      OTUI_TREE_SITTER_WORKER_PATH: bunfsRoot + workerRelativePath,
    },
    compile: {
      target: `bun-${os}-${arch}` as any,
      outfile: join(outDir, 'marvin'),
    },
  });

  if (!result.success) {
    console.error(`Failed to build ${name}`);
    continue;
  }

  // Create tarball
  await $`tar -czf ${join(distDir, `${name}.tar.gz`)} -C ${outDir} marvin`;
  console.log(`✅ ${name}.tar.gz`);
}

console.log('\nBinaries ready in dist/');
```

#### 2. Add build:all script to package.json

**File**: `apps/coding-agent/package.json`

**Add** to scripts:
```json
"build:all": "bun scripts/build-all.ts"
```

#### 3. Create GitHub Actions release workflow

**File**: `.github/workflows/release.yml` (new)

**Add**:
```yaml
name: Release

on:
  push:
    tags:
      - 'v*'

jobs:
  build:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      
      - uses: oven-sh/setup-bun@v1
        with:
          bun-version: latest
      
      - name: Install all platform deps
        run: |
          bun install
          bun install --os=darwin --cpu=arm64 @opentui/core
          bun install --os=darwin --cpu=x64 @opentui/core
          bun install --os=linux --cpu=x64 @opentui/core
          bun install --os=linux --cpu=arm64 @opentui/core
      
      - name: Build all platforms
        run: cd apps/coding-agent && bun run build:all
      
      - name: Create Release
        uses: softprops/action-gh-release@v1
        with:
          files: apps/coding-agent/dist/*.tar.gz
          generate_release_notes: true
```

#### 4. Create install script

**File**: `install.sh` (new, in repo root)

**Add**:
```bash
#!/usr/bin/env bash
set -euo pipefail

REPO="Yeshwanthyk/marvin"
INSTALL_DIR="${MARVIN_INSTALL_DIR:-$HOME/.local/bin}"

# Detect platform
OS="$(uname -s | tr '[:upper:]' '[:lower:]')"
ARCH="$(uname -m)"

case "$OS" in
  darwin) OS="darwin" ;;
  linux) OS="linux" ;;
  *) echo "Unsupported OS: $OS"; exit 1 ;;
esac

case "$ARCH" in
  x86_64|amd64) ARCH="x64" ;;
  arm64|aarch64) ARCH="arm64" ;;
  *) echo "Unsupported architecture: $ARCH"; exit 1 ;;
esac

ASSET="marvin-${OS}-${ARCH}.tar.gz"

echo "Installing marvin for ${OS}-${ARCH}..."

# Get latest release URL
RELEASE_URL=$(curl -sL "https://api.github.com/repos/${REPO}/releases/latest" \
  | grep "browser_download_url.*${ASSET}" \
  | cut -d '"' -f 4)

if [ -z "$RELEASE_URL" ]; then
  echo "Error: Could not find release for ${ASSET}"
  exit 1
fi

# Download and install
mkdir -p "$INSTALL_DIR"
curl -sL "$RELEASE_URL" | tar -xz -C "$INSTALL_DIR"
chmod +x "$INSTALL_DIR/marvin"

echo "✅ Installed marvin to $INSTALL_DIR/marvin"
echo ""
echo "Add to PATH if needed:"
echo "  export PATH=\"$INSTALL_DIR:\$PATH\""
```

### Success Criteria

```bash
# Local build test
cd apps/coding-agent && bun run build:all
ls dist/*.tar.gz

# Release process:
# 1. npm run version:patch
# 2. git add -A && git commit -m "chore: release $(node -p \"require('./packages/ai/package.json').version\")"
# 3. git tag v$(node -p "require('./packages/ai/package.json').version")
# 4. git push origin main --tags
# 5. GitHub Actions builds and creates release
```

---

## Phase 9: Auto-Update on Startup (Optional)

### Overview

Prompt user to update on startup if new version available.

### Prerequisites

- [ ] Phase 8 complete

### Changes

#### 1. Add auto-update config option

**File**: `apps/coding-agent/src/config.ts`

**Add** to config schema:
```typescript
autoUpdate?: 'prompt' | 'auto' | 'off';  // default: 'prompt'
```

#### 2. Update startup check behavior

**File**: `apps/coding-agent/src/updater.ts`

**Modify** `checkUpdateOnStart`:
```typescript
export async function checkUpdateOnStart(config: { autoUpdate?: string }): Promise<void> {
  const mode = config.autoUpdate ?? 'prompt';
  if (mode === 'off') return;
  
  // Check once per day
  const lastCheckFile = `${process.env.HOME}/.config/marvin/.last-update-check`;
  const now = Date.now();
  
  try {
    if (existsSync(lastCheckFile)) {
      const lastCheck = parseInt(await Bun.file(lastCheckFile).text(), 10);
      if (now - lastCheck < 24 * 60 * 60 * 1000) return;
    }
  } catch {}
  
  await Bun.write(lastCheckFile, String(now));
  
  const { available, current, latest } = await checkForUpdate();
  if (!available) return;
  
  if (mode === 'auto') {
    console.log(`\n🔄 Auto-updating marvin: ${current} → ${latest}...`);
    const success = await performUpdate(true);
    if (success) {
      console.log('✅ Updated! Restart marvin to use new version.\n');
    }
  } else {
    console.log(`\n💡 New version available: ${latest} (current: ${current})`);
    console.log(`   Run \`marvin update\` to upgrade`);
    console.log(`   Set autoUpdate: "auto" in config to auto-update\n`);
  }
}
```

### Success Criteria

```bash
# With config autoUpdate: "prompt" (default)
marvin  # Shows update notice if available

# With config autoUpdate: "auto"  
marvin  # Auto-downloads and updates

# With config autoUpdate: "off"
marvin  # No update check
```

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

### Releasing (Library + CLI)

```bash
# 1. Bump version (all packages together)
npm run version:patch  # or minor/major

# 2. Commit
git add -A
git commit -m "chore: release $(node -p "require('./packages/ai/package.json').version")"

# 3. Publish library packages to npm
npm run publish:packages

# 4. Tag and push (triggers binary build)
VERSION=$(node -p "require('./packages/ai/package.json').version")
git tag -a "v${VERSION}" -m "Release v${VERSION}"
git push origin main --tags

# 5. GitHub Actions builds binaries and creates release
```

### User Installation

```bash
# Install CLI (one-liner)
curl -fsSL https://raw.githubusercontent.com/Yeshwanthyk/marvin/main/install.sh | bash

# Update CLI
marvin update

# Install library packages (for hooks/custom tools)
npm install @marvin-agents/ai @marvin-agents/base-tools
```

---

## References

- Pi-mono publish pattern: `/Users/yesh/Documents/personal/reference/pi-mono/package.json`
- Pi-mono tsconfig paths: `/Users/yesh/Documents/personal/reference/pi-mono/tsconfig.json`
- Pi-mono sync-versions: `/Users/yesh/Documents/personal/reference/pi-mono/scripts/sync-versions.js`
- Opencode distribution: `github.com/sst/opencode` (optionalDeps + platform packages)
