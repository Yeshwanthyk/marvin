// Repo-wide Bun preload to ensure `@opentui/solid` TSX compiles correctly.
//
// In a clean workspace install, `@opentui/solid/preload` should resolve normally.
// In some local setups (e.g. package-scoped installs), fall back to a known path.

const tryImport = async (specifier: string): Promise<boolean> => {
  try {
    await import(specifier)
    return true
  } catch {
    return false
  }
}

// 1) Preferred: normal module resolution
if (await tryImport("@opentui/solid/preload")) {
  // noop
} else if (
  // 2) Fallback: package-scoped install (common during local experimentation)
  await tryImport("../packages/tui-solid/node_modules/@opentui/solid/scripts/preload.ts")
) {
  // noop
} else if (
  // 3) Fallback: app-scoped install
  await tryImport("../apps/coding-agent/node_modules/@opentui/solid/scripts/preload.ts")
) {
  // noop
} else if (
  // 4) Fallback: root node_modules direct path (non-standard but harmless)
  await tryImport("../node_modules/@opentui/solid/scripts/preload.ts")
) {
  // noop
} else {
  // Keep Bun usable for non-OpenTUI flows, but make failures obvious when OpenTUI is used.
  console.warn(
    "[mu] OpenTUI preload not found; Solid TSX may fail to compile. Install @opentui/solid (and deps) at the workspace root."
  )
}

