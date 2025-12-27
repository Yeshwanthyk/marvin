#!/usr/bin/env bun
/**
 * Build script for marvin CLI
 *
 * Single-step compile with Solid plugin - assets are embedded automatically.
 */
import solidPlugin from "@opentui/solid/bun-plugin";
import { readdirSync, realpathSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const projectRoot = join(__dirname, ".."); // apps/coding-agent
const workspaceRoot = join(__dirname, "../../.."); // monorepo root where bun.lock lives

const outfile = process.argv[2] || join(process.env.HOME!, "commands", "marvin");
const require = createRequire(import.meta.url);

// Resolve the dylib path for the current platform
const getPlatformDylibPath = (): string => {
  const platform = process.platform;
  const arch = process.arch;
  const packageName = `@opentui/core-${platform}-${arch}`;

  try {
    const packageJsonPath = require.resolve(`${packageName}/package.json`);
    const packageDir = dirname(packageJsonPath);
    // Find the dylib file (libopentui.dylib on macOS, libopentui.so on Linux, opentui.dll on Windows)
    const files = readdirSync(packageDir);
    const dylibFile = files.find(
      (f) => f.endsWith(".dylib") || f.endsWith(".so") || f.endsWith(".dll")
    );
    if (!dylibFile) {
      throw new Error(`No dylib found in ${packageDir}`);
    }
    return join(packageDir, dylibFile);
  } catch (error) {
    throw new Error(
      `Failed to resolve platform-specific package ${packageName}: ${error}`
    );
  }
};

const dylibPath = getPlatformDylibPath();
console.log(`Using dylib: ${dylibPath}`);

// Resolve tree-sitter parser worker path for markdown rendering
const opentuiCorePath = dirname(require.resolve("@opentui/core/package.json"));
const parserWorkerPath = realpathSync(join(opentuiCorePath, "parser.worker.js"));
console.log(`Using parser worker: ${parserWorkerPath}`);

// Use bunfs root path for embedded assets (Unix: /$bunfs/root/, Windows: B:/~BUN/root/)
// Path must be relative to projectRoot (where build runs from), as Bun uses the build CWD for entrypoint paths
const bunfsRoot = process.platform === "win32" ? "B:/~BUN/root/" : "/$bunfs/root/";
const workerRelativePath = relative(projectRoot, parserWorkerPath).replaceAll("\\", "/");
console.log(`Worker path in bunfs: ${bunfsRoot}${workerRelativePath}`);

// Single-step compile with solid plugin
const result = await Bun.build({
  entrypoints: ["./src/index.ts", parserWorkerPath],
  target: "bun",
  minify: false,
  plugins: [
    solidPlugin,
    {
      name: "patch-dynamic-platform-import",
      setup(build) {
        // Intercept the dynamic platform import and replace with static path
        build.onLoad({ filter: /index-.*\.js$/ }, async (args) => {
          let contents = await Bun.file(args.path).text();

          // Replace dynamic platform import with static dylib import
          const dynamicImportPattern =
            /import\(`@opentui\/core-\$\{process\.platform\}-\$\{process\.arch\}\/index\.ts`\)/g;
          const staticImport = `import("${dylibPath}", { with: { type: "file" } }).then(m => ({ default: m.default }))`;
          contents = contents.replace(dynamicImportPattern, staticImport);

          return { contents, loader: "js" };
        });
      },
    },
  ],
  naming: {
    // Use hash to avoid conflicts between assets with same name in different directories
    // (e.g., markdown/highlights.scm vs javascript/highlights.scm)
    asset: "[name]-[hash].[ext]",
  },
  define: {
    // Critical: Define tree-sitter worker path at compile time for markdown rendering
    // Must be a quoted string literal for JS replacement
    OTUI_TREE_SITTER_WORKER_PATH: JSON.stringify(bunfsRoot + workerRelativePath),
  },
  compile: {
    outfile,
  },
});

if (!result.success) {
  console.error("Build failed:");
  for (const log of result.logs) {
    console.error(log);
  }
  process.exit(1);
}

console.log(`Built: ${outfile}`);
