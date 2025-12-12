import { spawn } from "node:child_process";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";

type Workspace = { name: string; dir: string; hasTestScript: boolean };

const repoRoot = process.cwd();

const readJson = async <T>(filePath: string): Promise<T> => {
  const raw = await readFile(filePath, "utf8");
  return JSON.parse(raw) as T;
};

const listWorkspaces = async (): Promise<Workspace[]> => {
  const roots = ["packages", "apps"];
  const workspaces: Workspace[] = [];

  for (const root of roots) {
    const absRoot = path.join(repoRoot, root);
    let entries: Array<{ name: string; isDirectory: () => boolean }>;
    try {
      entries = await readdir(absRoot, { withFileTypes: true });
    } catch {
      continue;
    }

    for (const ent of entries) {
      if (!ent.isDirectory()) continue;
      const dir = path.join(absRoot, ent.name);
      const pkgPath = path.join(dir, "package.json");
      try {
        const pkg = await readJson<{ name?: string; scripts?: Record<string, string> }>(
          pkgPath
        );
        const name = pkg.name ?? `${root}/${ent.name}`;
        workspaces.push({
          name,
          dir,
          hasTestScript: Boolean(pkg.scripts?.test),
        });
      } catch {
        // no package.json
      }
    }
  }

  workspaces.sort((a, b) => a.name.localeCompare(b.name));
  return workspaces;
};

const run = (command: string, args: string[], cwd: string) =>
  new Promise<void>((resolve, reject) => {
    const child = spawn(command, args, {
      cwd,
      stdio: "inherit",
      env: process.env,
    });
    child.once("error", reject);
    child.once("exit", (code) => {
      if (code === 0) resolve();
      else reject(new Error(`${command} ${args.join(" ")} exited with code ${code}`));
    });
  });

const main = async () => {
  const workspaces = await listWorkspaces();
  if (workspaces.length === 0) {
    console.log("No workspaces found.");
    return;
  }

  const failures: string[] = [];

  for (const ws of workspaces) {
    if (!ws.hasTestScript) {
      // Still run bun test directly if no script exists.
      // (Prefer adding scripts, but keep runner tolerant.)
      console.log(`\n==> ${ws.name} (bun test tests)`);
      try {
        await run("bun", ["test", "tests"], ws.dir);
      } catch (err) {
        failures.push(`${ws.name}: ${(err as Error).message}`);
      }
      continue;
    }

    console.log(`\n==> ${ws.name} (bun run test)`);
    try {
      await run("bun", ["run", "test"], ws.dir);
    } catch (err) {
      failures.push(`${ws.name}: ${(err as Error).message}`);
    }
  }

  if (failures.length) {
    console.error("\nTest failures:");
    for (const f of failures) console.error(`- ${f}`);
    process.exitCode = 1;
  }
};

await main();

