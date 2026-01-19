import { Channel, Context, Deferred, Effect, Either, Exit, Queue } from "effect"
import { pipe } from "effect/Function"
import type { AgentRunConfig } from "@yeshwanthyk/agent-core"
import type { Message, ImageContent } from "@yeshwanthyk/ai"
import type { HookRunner } from "./runner.js"
import type {
	BeforeAgentStartResult,
	ChatMessageEvent,
	HookEvent,
	ToolExecuteAfterEvent,
	ToolExecuteAfterResult,
	ToolExecuteBeforeEvent,
	ToolExecuteBeforeResult,
} from "./types.js"

interface HookTask {
	readonly run: () => Promise<unknown>
	readonly deferred: Deferred.Deferred<unknown, unknown>
}

class HookTaskFailure extends Error {
	readonly _tag = "HookTaskFailure"
	constructor(message: string) {
		super(message)
	}
}

type HookQueueItem = Either.Either<HookTask, Exit.Exit<void, never>>

export interface HookEffects {
	emit(event: HookEvent): Effect.Effect<void, unknown>
	emitBeforeAgentStart(prompt: string, images?: ImageContent[]): Effect.Effect<BeforeAgentStartResult | undefined, unknown>
	emitChatMessage(input: ChatMessageEvent["input"], output: ChatMessageEvent["output"]): Effect.Effect<void, unknown>
	emitToolExecuteBefore(event: ToolExecuteBeforeEvent): Effect.Effect<ToolExecuteBeforeResult | undefined, unknown>
	emitToolExecuteAfter(event: ToolExecuteAfterEvent): Effect.Effect<ToolExecuteAfterResult | undefined, unknown>
	emitContext(messages: Message[]): Effect.Effect<Message[], unknown>
	applyRunConfig(cfg: AgentRunConfig, sessionId: string | null): Effect.Effect<AgentRunConfig, unknown>
}

export const HookEffectsTag = Context.GenericTag<HookEffects>("runtime-effect/HookEffects")

const createQueue = () => Queue.unbounded<HookQueueItem>()

const processTask = (task: HookTask) =>
	Effect.matchEffect(
		Effect.tryPromise({
			try: task.run,
			catch: (error) => new HookTaskFailure(error instanceof Error ? error.message : String(error)),
		}),
		{
			onFailure: (error) => Deferred.fail(task.deferred, error),
			onSuccess: (value) => Deferred.succeed(task.deferred, value),
		},
	).pipe((effect) => Effect.as(effect, undefined))

const finishQueue = (queue: Queue.Queue<HookQueueItem>) =>
	pipe(queue.offer(Either.left(Exit.succeed(undefined))), (effect) => Effect.zipRight(effect, queue.shutdown))

const enqueue: <A>(queue: Queue.Queue<HookQueueItem>, run: () => Promise<A>) => Effect.Effect<A, unknown> = Effect.fn(
	function* <A>(queue: Queue.Queue<HookQueueItem>, run: () => Promise<A>) {
		const deferred = yield* Deferred.make<A, unknown>()
		const task: HookTask = {
			run: run as () => Promise<unknown>,
			deferred: deferred as Deferred.Deferred<unknown, unknown>,
		}
		yield* queue.offer(Either.right(task))
		return yield* Deferred.await(deferred)
	},
)

export const createHookEffects = Effect.fn(function* (hookRunner: HookRunner) {
		const queue = yield* createQueue()
		const worker = Channel.fromQueue(queue).pipe(Channel.mapOutEffect(processTask), Channel.drain)
		yield* Effect.addFinalizer(() => finishQueue(queue))
		yield* Effect.forkScoped(Channel.runDrain(worker))

		const submit = <A>(run: () => Promise<A>) => enqueue(queue, run)
		const submitUnit = (run: () => Promise<unknown>) => submit(run).pipe((effect) => Effect.as(effect, undefined))

		return {
			emit: (event: HookEvent) => submitUnit(() => hookRunner.emit(event)),
			emitBeforeAgentStart: (prompt: string, images?: ImageContent[]) =>
				submit(() => hookRunner.emitBeforeAgentStart(prompt, images)),
			emitChatMessage: (input: ChatMessageEvent["input"], output: ChatMessageEvent["output"]) =>
				submitUnit(() => hookRunner.emitChatMessage(input, output)),
			emitToolExecuteBefore: (event: ToolExecuteBeforeEvent) => submit(() =>
				hookRunner.emitToolExecuteBefore(event)
			),
			emitToolExecuteAfter: (event: ToolExecuteAfterEvent) => submit(() =>
				hookRunner.emitToolExecuteAfter(event)
			),
			emitContext: (messages: Message[]) => submit(() => hookRunner.emitContext(messages)),
			applyRunConfig: (cfg: AgentRunConfig, sessionId: string | null) =>
				submit(() => hookRunner.applyRunConfig(cfg, sessionId)),
		} satisfies HookEffects
	})
