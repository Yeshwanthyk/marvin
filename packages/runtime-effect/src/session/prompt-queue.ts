import { Context, Effect, Layer } from "effect";
import * as Chunk from "effect/Chunk";
import * as Queue from "effect/Queue";
import * as Stream from "effect/Stream";
import * as SubscriptionRef from "effect/SubscriptionRef";
import type { Attachment } from "@marvin-agents/agent-core";

export type PromptDeliveryMode = "steer" | "followUp";

export interface PromptQueueItem {
  text: string;
  mode: PromptDeliveryMode;
  attachments?: Attachment[];
  completionId?: string;
}

export interface QueueCounts {
  steer: number;
  followUp: number;
}

export interface PromptQueueSnapshot {
  readonly pending: ReadonlyArray<PromptQueueItem>;
  readonly counts: QueueCounts;
}

const emptyCounts: QueueCounts = { steer: 0, followUp: 0 };
const emptySnapshot: PromptQueueSnapshot = { pending: [], counts: emptyCounts };

const computeCounts = (items: ReadonlyArray<PromptQueueItem>): QueueCounts => {
  let steer = 0;
  let followUp = 0;
  for (const item of items) {
    if (item.mode === "steer") steer += 1;
    else followUp += 1;
  }
  return { steer, followUp };
};

const appendItem = (state: PromptQueueSnapshot, item: PromptQueueItem): PromptQueueSnapshot => {
  const pending = state.pending.length === 0 ? [item] : [...state.pending, item];
  return { pending, counts: computeCounts(pending) };
};

const appendMany = (state: PromptQueueSnapshot, items: ReadonlyArray<PromptQueueItem>): PromptQueueSnapshot => {
  if (items.length === 0) return state;
  const pending = state.pending.length === 0 ? [...items] : [...state.pending, ...items];
  return { pending, counts: computeCounts(pending) };
};

const dropFromState = (state: PromptQueueSnapshot, count: number): PromptQueueSnapshot => {
  if (count <= 0 || state.pending.length === 0) return state;
  if (count >= state.pending.length) return emptySnapshot;
  const pending = state.pending.slice(count);
  return { pending, counts: computeCounts(pending) };
};

const normalizeItems = (items: Iterable<PromptQueueItem>): ReadonlyArray<PromptQueueItem> => {
  return Array.isArray(items) ? items.slice() : Array.from(items);
};

const commandForMode = (mode: PromptDeliveryMode): string => (mode === "steer" ? "/steer" : "/followup");

const toScriptLine = (item: PromptQueueItem): string => {
  const command = commandForMode(item.mode);
  const trimmed = item.text.trimEnd();
  return trimmed.length > 0 ? `${command} ${trimmed}` : command;
};

const parseScriptLine = (line: string): PromptQueueItem | null => {
  const trimmed = line.trim();
  if (!trimmed || !trimmed.startsWith("/")) return null;
  const spaceIdx = trimmed.indexOf(" ");
  const command = (spaceIdx === -1 ? trimmed.slice(1) : trimmed.slice(1, spaceIdx)).toLowerCase();
  let mode: PromptDeliveryMode | null = null;
  if (command === "steer") mode = "steer";
  else if (command === "followup" || command === "follow-up") mode = "followUp";
  if (!mode) return null;
  const text = spaceIdx === -1 ? "" : trimmed.slice(spaceIdx + 1);
  return { mode, text };
};

export const promptQueueToScript = (items: ReadonlyArray<PromptQueueItem>): string | null => {
  if (items.length === 0) return null;
  return items.map((item) => toScriptLine(item)).join("\n");
};

export const scriptToPromptQueueItems = (script: string | null | undefined): PromptQueueItem[] => {
  if (!script) return [];
  const lines = script.split(/\r?\n/);
  const result: PromptQueueItem[] = [];
  for (const line of lines) {
    const parsed = parseScriptLine(line);
    if (parsed) result.push(parsed);
  }
  return result;
};

export interface PromptQueue {
  push: (item: PromptQueueItem) => void;
  shift: () => PromptQueueItem | undefined;
  drainToScript: () => string | null;
  clear: () => void;
  size: () => number;
  peekAll: () => PromptQueueItem[];
  peek: () => PromptQueueItem | undefined;
  counts: () => QueueCounts;
}

export function createPromptQueue(updateCounts: (counts: QueueCounts) => void): PromptQueue {
  const queue: PromptQueueItem[] = [];

  const syncCounts = () => updateCounts(computeCounts(queue));

  return {
    push: (item: PromptQueueItem) => {
      queue.push(item);
      syncCounts();
    },
    shift: () => {
      const value = queue.shift();
      if (value !== undefined) {
        syncCounts();
      }
      return value;
    },
    drainToScript: () => {
      if (queue.length === 0) return null;
      const script = promptQueueToScript(queue);
      queue.length = 0;
      syncCounts();
      return script;
    },
    clear: () => {
      if (queue.length === 0) return;
      queue.length = 0;
      syncCounts();
    },
    size: () => queue.length,
    peekAll: () => [...queue],
    peek: () => queue[0],
    counts: () => computeCounts(queue),
  };
}

export interface PromptQueueService {
  readonly enqueue: (item: PromptQueueItem) => Effect.Effect<void>;
  readonly enqueueMany: (items: Iterable<PromptQueueItem>) => Effect.Effect<void>;
  readonly take: Effect.Effect<PromptQueueItem>;
  readonly takeAll: Effect.Effect<ReadonlyArray<PromptQueueItem>>;
  readonly drainToScript: Effect.Effect<string | null>;
  readonly clear: Effect.Effect<void>;
  readonly pendingSnapshot: Effect.Effect<ReadonlyArray<PromptQueueItem>>;
  readonly countsSnapshot: Effect.Effect<QueueCounts>;
  readonly snapshot: Effect.Effect<PromptQueueSnapshot>;
  readonly stateStream: Stream.Stream<PromptQueueSnapshot>;
  readonly restore: (items: Iterable<PromptQueueItem>) => Effect.Effect<void>;
  readonly restoreFromScript: (script: string | null | undefined) => Effect.Effect<void>;
}

export const PromptQueueTag = Context.GenericTag<PromptQueueService>("runtime-effect/PromptQueueService");

export const PromptQueueLayer = Layer.scoped(
  PromptQueueTag,
  Effect.gen(function* () {
    const queue = yield* Effect.acquireRelease(
      Queue.unbounded<PromptQueueItem>(),
      (resource) => Queue.shutdown(resource),
    );
    const stateRef = yield* SubscriptionRef.make<PromptQueueSnapshot>(emptySnapshot);

    const takeAllEffect: Effect.Effect<ReadonlyArray<PromptQueueItem>> = Effect.flatMap(
      Queue.takeAll(queue),
      (chunk) => {
        const entries = Chunk.toReadonlyArray(chunk);
        if (entries.length === 0) return Effect.succeed(entries);
        return Effect.as(SubscriptionRef.update(stateRef, (state) => dropFromState(state, entries.length)), entries);
      },
    );

    const restore = (items: Iterable<PromptQueueItem>) => {
      const entries = normalizeItems(items);
      if (entries.length === 0) return Effect.succeed(undefined);
      return Effect.zipRight(
        SubscriptionRef.set(stateRef, { pending: entries, counts: computeCounts(entries) }),
        Queue.offerAll(queue, entries),
      );
    };

    const restoreFromScript = (script: string | null | undefined) => {
      const entries = scriptToPromptQueueItems(script);
      return entries.length === 0 ? Effect.succeed(undefined) : restore(entries);
    };

    const service: PromptQueueService = {
      enqueue: (item) =>
        Effect.zipRight(
          SubscriptionRef.update(stateRef, (state) => appendItem(state, item)),
          Queue.offer(queue, item),
        ),
      enqueueMany: (items) => {
        const entries = normalizeItems(items);
        if (entries.length === 0) return Effect.succeed(undefined);
        return Effect.zipRight(
          SubscriptionRef.update(stateRef, (state) => appendMany(state, entries)),
          Queue.offerAll(queue, entries),
        );
      },
      take: Effect.flatMap(Queue.take(queue), (item) =>
        Effect.as(SubscriptionRef.update(stateRef, (state) => dropFromState(state, 1)), item),
      ),
      takeAll: takeAllEffect,
      drainToScript: Effect.flatMap(takeAllEffect, (items) => Effect.succeed(promptQueueToScript(items))),
      clear: Effect.zipRight(Queue.takeAll(queue), SubscriptionRef.set(stateRef, emptySnapshot)),
      pendingSnapshot: Effect.map(SubscriptionRef.get(stateRef), (state) => state.pending),
      countsSnapshot: Effect.map(SubscriptionRef.get(stateRef), (state) => state.counts),
      snapshot: SubscriptionRef.get(stateRef),
      stateStream: stateRef.changes,
      restore,
      restoreFromScript,
    };

    return service;
  }),
);
