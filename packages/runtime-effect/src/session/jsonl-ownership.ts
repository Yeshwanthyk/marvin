export type LaneId = string;

export type JsonlAcquireResult =
  | "acquired"
  | "already-owned-by-self"
  | { readonly conflictLaneId: LaneId };

export interface JsonlOwnershipIndex {
  acquire(path: string, laneId: LaneId): JsonlAcquireResult;
  owns(path: string, laneId: LaneId): boolean;
  owner(path: string): LaneId | null;
  release(path: string, laneId: LaneId): void;
}

export class InMemoryJsonlOwnershipIndex implements JsonlOwnershipIndex {
  private readonly owners = new Map<string, LaneId>();

  acquire(path: string, laneId: LaneId): JsonlAcquireResult {
    const owner = this.owners.get(path);
    if (owner === undefined) {
      this.owners.set(path, laneId);
      return "acquired";
    }
    if (owner === laneId) return "already-owned-by-self";
    return { conflictLaneId: owner };
  }

  owns(path: string, laneId: LaneId): boolean {
    return this.owners.get(path) === laneId;
  }

  owner(path: string): LaneId | null {
    return this.owners.get(path) ?? null;
  }

  release(path: string, laneId: LaneId): void {
    if (this.owners.get(path) === laneId) {
      this.owners.delete(path);
    }
  }
}

export const createJsonlOwnershipIndex = (): JsonlOwnershipIndex =>
  new InMemoryJsonlOwnershipIndex();

export class JsonlOwnershipConflictError extends Error {
  readonly conflictLaneId: LaneId;

  constructor(path: string, conflictLaneId: LaneId) {
    super(`Session JSONL is already owned by lane ${conflictLaneId}: ${path}`);
    this.name = "JsonlOwnershipConflictError";
    this.conflictLaneId = conflictLaneId;
  }
}
