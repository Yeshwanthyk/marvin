import { homedir } from "node:os";
import { join } from "node:path";
import { createScratchpadStore, type ScratchpadItem } from "@yeshwanthyk/runtime-effect/scratchpads.js";

export interface ScratchpadCommandArgs {
  action?: "add" | "list" | "read" | "archive";
  title?: string;
  body?: string;
  cwd?: string;
  tags?: string[];
  json?: boolean;
  includeArchived?: boolean;
  configDir?: string;
  stdout?: (text: string) => void;
  stderr?: (text: string) => void;
  stdin?: () => Promise<string>;
}

const defaultConfigDir = () => join(homedir(), ".config", "marvin");

const usage = [
  "Usage:",
  '  marvin scratchpad add --title "fix auth flow" [body...]',
  "  marvin scratchpad list [--cwd <dir>] [--all] [--json]",
  "  marvin scratchpad read <id> [--json]",
  "  marvin scratchpad archive <id>",
].join("\n");

const defaultStdin = async (): Promise<string> => {
  if (process.stdin.isTTY) return "";
  return Bun.stdin.text();
};

const writeJson = (stdout: (text: string) => void, value: unknown): void => {
  stdout(`${JSON.stringify(value, null, 2)}\n`);
};

const formatItem = (item: ScratchpadItem): string => {
  const tags = item.tags.length > 0 ? ` #${item.tags.join(" #")}` : "";
  const preview = item.bodyPreview ? `\n    ${item.bodyPreview}` : "";
  return `${item.id.slice(0, 8)}  ${item.status.padEnd(9)}  ${item.title}${tags}\n    ${item.cwd}${preview}`;
};

export const runScratchpadCommand = async (args: ScratchpadCommandArgs): Promise<void> => {
  const stdout = args.stdout ?? ((text: string) => process.stdout.write(text));
  const stderr = args.stderr ?? ((text: string) => process.stderr.write(text));
  const store = createScratchpadStore(args.configDir ?? defaultConfigDir());

  try {
    switch (args.action) {
      case "add": {
        const body = (args.body?.trim() || (await (args.stdin ?? defaultStdin)()).trim());
        const item = store.add({
          cwd: args.cwd ?? process.cwd(),
          title: args.title ?? "",
          body,
          tags: args.tags,
          source: { kind: "cli" },
        });
        if (args.json) {
          writeJson(stdout, item);
        } else {
          stdout(`Saved scratchpad: ${item.title} (${item.id.slice(0, 8)})\n`);
        }
        return;
      }
      case "list": {
        const items = store.list({ cwd: args.cwd, includeArchived: args.includeArchived });
        if (args.json) {
          writeJson(stdout, items);
          return;
        }
        if (items.length === 0) {
          stdout("No scratchpads\n");
          return;
        }
        stdout(`${items.map(formatItem).join("\n\n")}\n`);
        return;
      }
      case "read": {
        const id = args.body?.trim();
        if (!id) throw new Error("Scratchpad id is required");
        const entry = store.read(id);
        if (args.json) {
          writeJson(stdout, entry);
        } else {
          stdout(`# ${entry.item.title}\n\n${entry.body}\n`);
        }
        return;
      }
      case "archive": {
        const id = args.body?.trim();
        if (!id) throw new Error("Scratchpad id is required");
        const item = store.archive(id);
        if (args.json) {
          writeJson(stdout, item);
        } else {
          stdout(`Archived scratchpad: ${item.title} (${item.id.slice(0, 8)})\n`);
        }
        return;
      }
      default:
        stderr(`${usage}\n`);
        process.exitCode = 1;
    }
  } catch (error) {
    stderr(`${error instanceof Error ? error.message : String(error)}\n\n${usage}\n`);
    process.exitCode = 1;
  }
};
