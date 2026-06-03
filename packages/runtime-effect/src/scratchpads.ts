import { randomUUID } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { expandWorkspacePath } from "./workspace-projects.js";

export type ScratchpadStatus = "open" | "triggered" | "archived";

export interface ScratchpadSource {
  kind: "cli" | "tui" | "agent";
  sessionId?: string;
}

export interface ScratchpadItem {
  id: string;
  cwd: string;
  title: string;
  bodyPath: string;
  bodyPreview: string;
  tags: string[];
  status: ScratchpadStatus;
  createdAt: string;
  updatedAt: string;
  triggeredAt?: string;
  triggeredSessionId?: string;
  source?: ScratchpadSource;
}

export interface ScratchpadListFilter {
  cwd?: string;
  includeArchived?: boolean;
}

export interface AddScratchpadInput {
  cwd: string;
  title: string;
  body: string;
  tags?: string[];
  source?: ScratchpadSource;
}

export interface ScratchpadStore {
  list(filter?: ScratchpadListFilter): ScratchpadItem[];
  add(input: AddScratchpadInput): ScratchpadItem;
  read(id: string): { item: ScratchpadItem; body: string };
  archive(id: string): ScratchpadItem;
  markTriggered(id: string, sessionId: string): ScratchpadItem;
}

interface ScratchpadIndex {
  version: 1;
  items: ScratchpadItem[];
}

const SCRATCHPAD_INDEX_VERSION = 1 as const;
const PREVIEW_LENGTH = 160;
const MAX_TITLE_LENGTH = 80;
const MAX_TAG_LENGTH = 32;

export const scratchpadRootPath = (configDir: string): string => join(expandWorkspacePath(configDir), "scratchpad");
export const scratchpadIndexPath = (configDir: string): string => join(scratchpadRootPath(configDir), "index.json");

const nowIso = (): string => new Date().toISOString();

const cwdPathSegment = (cwd: string): string => cwd.replace(/^\/+/, "") || "__root__";

const bodyPathFor = (configDir: string, cwd: string, id: string): string =>
  join(scratchpadRootPath(configDir), cwdPathSegment(cwd), `${id}.md`);

const normalizeTitle = (raw: string): string => {
  const title = raw.replace(/[\u0000-\u001f\u007f]+/g, " ").replace(/\s+/g, " ").trim();
  if (!title) throw new Error("Scratchpad title is required");
  if (title.length > MAX_TITLE_LENGTH) throw new Error(`Scratchpad title must be ${MAX_TITLE_LENGTH} characters or fewer`);
  return title;
};

const normalizeBody = (raw: string): string => {
  const body = raw.replace(/\u0000/g, "").trim();
  if (!body) throw new Error("Scratchpad body is required");
  return body;
};

const normalizeTags = (raw: string[] | undefined): string[] => {
  const tags = new Set<string>();
  for (const tag of raw ?? []) {
    const normalized = tag.replace(/[\u0000-\u001f\u007f]+/g, " ").trim().replace(/\s+/g, "-").toLowerCase();
    if (!normalized) continue;
    tags.add(normalized.slice(0, MAX_TAG_LENGTH));
  }
  return [...tags];
};

const previewFor = (body: string): string => {
  const compact = body.replace(/\s+/g, " ").trim();
  return compact.length > PREVIEW_LENGTH ? `${compact.slice(0, PREVIEW_LENGTH - 1)}...` : compact;
};

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null;

const readIndex = (configDir: string): ScratchpadIndex => {
  const path = scratchpadIndexPath(configDir);
  if (!existsSync(path)) return { version: SCRATCHPAD_INDEX_VERSION, items: [] };
  const raw = JSON.parse(readFileSync(path, "utf8")) as unknown;
  if (!isRecord(raw) || raw.version !== SCRATCHPAD_INDEX_VERSION || !Array.isArray(raw.items)) {
    return { version: SCRATCHPAD_INDEX_VERSION, items: [] };
  }
  return {
    version: SCRATCHPAD_INDEX_VERSION,
    items: raw.items.filter((item): item is ScratchpadItem => isRecord(item) && typeof item.id === "string" && typeof item.title === "string"),
  };
};

const writeIndex = (configDir: string, index: ScratchpadIndex): void => {
  const root = scratchpadRootPath(configDir);
  mkdirSync(root, { recursive: true });
  const target = scratchpadIndexPath(configDir);
  const temp = `${target}.${process.pid}.${Date.now()}.tmp`;
  writeFileSync(temp, `${JSON.stringify(index, null, 2)}\n`, "utf8");
  renameSync(temp, target);
};

const writeBody = (bodyPath: string, body: string): void => {
  mkdirSync(dirname(bodyPath), { recursive: true });
  const temp = `${bodyPath}.${process.pid}.${Date.now()}.tmp`;
  writeFileSync(temp, `${body}\n`, "utf8");
  renameSync(temp, bodyPath);
};

const findItem = (index: ScratchpadIndex, id: string): ScratchpadItem => {
  const item = index.items.find((entry) => entry.id === id);
  if (item) return item;
  const matches = index.items.filter((entry) => entry.id.startsWith(id));
  if (matches.length > 1) throw new Error(`Scratchpad id is ambiguous: ${id}`);
  if (matches.length === 0 || !matches[0]) throw new Error(`Scratchpad not found: ${id}`);
  return matches[0];
};

const sortItems = (items: ScratchpadItem[]): ScratchpadItem[] =>
  [...items].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt) || b.createdAt.localeCompare(a.createdAt) || a.title.localeCompare(b.title));

export const createScratchpadStore = (configDir: string): ScratchpadStore => ({
  list: (filter = {}) => {
    const cwd = filter.cwd ? expandWorkspacePath(filter.cwd) : undefined;
    const includeArchived = filter.includeArchived === true;
    return sortItems(
      readIndex(configDir).items.filter((item) => {
        if (!includeArchived && item.status === "archived") return false;
        if (cwd && item.cwd !== cwd) return false;
        return true;
      }),
    );
  },

  add: (input) => {
    const cwd = expandWorkspacePath(input.cwd);
    const title = normalizeTitle(input.title);
    const body = normalizeBody(input.body);
    const id = randomUUID();
    const timestamp = nowIso();
    const bodyPath = bodyPathFor(configDir, cwd, id);
    const item: ScratchpadItem = {
      id,
      cwd,
      title,
      bodyPath,
      bodyPreview: previewFor(body),
      tags: normalizeTags(input.tags),
      status: "open",
      createdAt: timestamp,
      updatedAt: timestamp,
    };
    if (input.source) item.source = input.source;

    const index = readIndex(configDir);
    writeBody(bodyPath, body);
    writeIndex(configDir, { version: SCRATCHPAD_INDEX_VERSION, items: [item, ...index.items] });
    return item;
  },

  read: (id) => {
    const index = readIndex(configDir);
    const item = findItem(index, id);
    return { item, body: readFileSync(item.bodyPath, "utf8").trimEnd() };
  },

  archive: (id) => {
    const index = readIndex(configDir);
    const timestamp = nowIso();
    const item = findItem(index, id);
    const nextItem: ScratchpadItem = { ...item, status: "archived", updatedAt: timestamp };
    writeIndex(configDir, {
      version: SCRATCHPAD_INDEX_VERSION,
      items: index.items.map((entry) => (entry.id === item.id ? nextItem : entry)),
    });
    return nextItem;
  },

  markTriggered: (id, sessionId) => {
    const index = readIndex(configDir);
    const timestamp = nowIso();
    const item = findItem(index, id);
    const nextItem: ScratchpadItem = {
      ...item,
      status: "triggered",
      triggeredAt: timestamp,
      triggeredSessionId: sessionId,
      updatedAt: timestamp,
    };
    writeIndex(configDir, {
      version: SCRATCHPAD_INDEX_VERSION,
      items: index.items.map((entry) => (entry.id === item.id ? nextItem : entry)),
    });
    return nextItem;
  },
});
