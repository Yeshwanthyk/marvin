import { describe, expect, it } from "bun:test";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  COCKPIT_HOOK_MARKER,
  runCockpitInstallerAction,
  type CockpitInstallerPaths,
} from "../src/cockpit/installers.js";

const pathsFor = (dir: string): CockpitInstallerPaths => ({
  claudeSettingsPath: path.join(dir, "claude", "settings.json"),
  codexHooksPath: path.join(dir, "codex", "hooks.json"),
  piExtensionPath: path.join(dir, "pi", "agent", "extensions", "marvin-cockpit", "index.ts"),
  hookBinaryPath: path.join(dir, "config", "marvin", "integrations", "marvin-cockpit-hook"),
});

const readJson = async (file: string): Promise<Record<string, unknown>> =>
  JSON.parse(await readFile(file, "utf8")) as Record<string, unknown>;

const markerCount = (value: unknown): number => {
  if (typeof value === "string") return value.includes(COCKPIT_HOOK_MARKER) ? 1 : 0;
  if (Array.isArray(value)) return value.reduce((count, item) => count + markerCount(item), 0);
  if (typeof value !== "object" || value === null) return 0;
  return Object.values(value).reduce((count, item) => count + markerCount(item), 0);
};

describe("cockpit installers", () => {
  it("installs idempotently, reports status, and uninstalls JSON hooks without removing foreign hooks", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "cockpit installers-"));
    try {
      const paths = pathsFor(dir);
      await mkdir(path.dirname(paths.codexHooksPath), { recursive: true });
      await writeFile(
        paths.codexHooksPath,
        JSON.stringify({
          hooks: {
            Stop: [{ hooks: [{ type: "command", command: "foreign-command" }] }],
          },
        }),
        "utf8",
      );

      const install = await runCockpitInstallerAction("install", {
        paths,
        agents: ["codex"],
        hookBinarySource: `#!/bin/sh\n# marvin-cockpit-hook\n`,
      });
      expect(install).toEqual([{ agent: "codex", status: "installed", changed: true, path: paths.codexHooksPath }]);

      const afterInstall = await readJson(paths.codexHooksPath);
      expect(markerCount(afterInstall)).toBe(4);
      expect(JSON.stringify(afterInstall)).toContain("foreign-command");
      expect(JSON.stringify(afterInstall)).toContain(`'${paths.hookBinaryPath}'`);

      const mode = (await stat(paths.hookBinaryPath)).mode & 0o777;
      expect(mode).toBe(0o755);

      const secondInstall = await runCockpitInstallerAction("install", {
        paths,
        agents: ["codex"],
        hookBinarySource: `#!/bin/sh\n# marvin-cockpit-hook\n`,
      });
      expect(secondInstall).toEqual([{ agent: "codex", status: "installed", changed: false, path: paths.codexHooksPath }]);

      const status = await runCockpitInstallerAction("status", { paths, agents: ["codex"] });
      expect(status).toEqual([{ agent: "codex", status: "installed", changed: false, path: paths.codexHooksPath }]);

      const uninstall = await runCockpitInstallerAction("uninstall", { paths, agents: ["codex"] });
      expect(uninstall).toEqual([{ agent: "codex", status: "not-installed", changed: true, path: paths.codexHooksPath }]);

      const afterUninstall = await readJson(paths.codexHooksPath);
      expect(markerCount(afterUninstall)).toBe(0);
      expect(JSON.stringify(afterUninstall)).toContain("foreign-command");
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("reports outdated marked hooks", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "cockpit-outdated-"));
    try {
      const paths = pathsFor(dir);
      await mkdir(path.dirname(paths.claudeSettingsPath), { recursive: true });
      await writeFile(
        paths.claudeSettingsPath,
        JSON.stringify({ hooks: { Stop: [{ hooks: [{ type: "command", command: `old ${COCKPIT_HOOK_MARKER}` }] }] } }),
        "utf8",
      );

      const status = await runCockpitInstallerAction("status", { paths, agents: ["claude"] });
      expect(status).toEqual([{ agent: "claude", status: "outdated", changed: false, path: paths.claudeSettingsPath }]);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("refuses unowned pi extension and rolls back earlier installs", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "cockpit-rollback-"));
    try {
      const paths = pathsFor(dir);
      await mkdir(path.dirname(paths.piExtensionPath), { recursive: true });
      await writeFile(paths.piExtensionPath, "export default {}\n", "utf8");

      const results = await runCockpitInstallerAction("install", {
        paths,
        agents: ["claude", "codex", "pi"],
        hookBinarySource: `#!/bin/sh\n# marvin-cockpit-hook\n`,
      });

      expect(results).toEqual([
        { agent: "claude", status: "installed", changed: true, path: paths.claudeSettingsPath },
        { agent: "codex", status: "installed", changed: true, path: paths.codexHooksPath },
        {
          agent: "pi",
          status: "not-installed",
          changed: false,
          path: paths.piExtensionPath,
          message: "refusing to overwrite unowned pi extension",
        },
      ]);
      expect(existsSync(paths.claudeSettingsPath)).toBe(false);
      expect(existsSync(paths.codexHooksPath)).toBe(false);
      expect(existsSync(paths.hookBinaryPath)).toBe(false);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("restores a previous owned install when a reinstall rolls back", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "cockpit-rollback-existing-"));
    try {
      const paths = pathsFor(dir);
      await runCockpitInstallerAction("install", {
        paths,
        agents: ["claude"],
        hookBinarySource: `#!/bin/sh\n# marvin-cockpit-hook\nold\n`,
      });
      const previousClaude = await readFile(paths.claudeSettingsPath, "utf8");
      const previousBinary = await readFile(paths.hookBinaryPath, "utf8");
      await mkdir(path.dirname(paths.piExtensionPath), { recursive: true });
      await writeFile(paths.piExtensionPath, "export default {}\n", "utf8");

      const results = await runCockpitInstallerAction("install", {
        paths,
        agents: ["claude", "pi"],
        hookBinarySource: `#!/bin/sh\n# marvin-cockpit-hook\nnew\n`,
      });

      expect(results.at(-1)).toEqual({
        agent: "pi",
        status: "not-installed",
        changed: false,
        path: paths.piExtensionPath,
        message: "refusing to overwrite unowned pi extension",
      });
      expect(await readFile(paths.claudeSettingsPath, "utf8")).toBe(previousClaude);
      expect(await readFile(paths.hookBinaryPath, "utf8")).toBe(previousBinary);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("installs and removes owned pi extension", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "cockpit-pi-"));
    try {
      const paths = pathsFor(dir);
      const install = await runCockpitInstallerAction("install", { paths, agents: ["pi"] });
      expect(install).toEqual([{ agent: "pi", status: "installed", changed: true, path: paths.piExtensionPath }]);
      expect(await readFile(paths.piExtensionPath, "utf8")).toContain(COCKPIT_HOOK_MARKER);

      const secondInstall = await runCockpitInstallerAction("install", { paths, agents: ["pi"] });
      expect(secondInstall).toEqual([{ agent: "pi", status: "installed", changed: false, path: paths.piExtensionPath }]);

      const uninstall = await runCockpitInstallerAction("uninstall", { paths, agents: ["pi"] });
      expect(uninstall).toEqual([{ agent: "pi", status: "not-installed", changed: true, path: paths.piExtensionPath }]);
      expect(existsSync(paths.piExtensionPath)).toBe(false);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
