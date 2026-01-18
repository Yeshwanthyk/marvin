import { Context, Effect, Exit, Layer, Scope } from "effect";
import {
  RuntimeLayer,
  RuntimeServicesTag,
  type AdapterKind,
  type RuntimeLayerOptions,
  type RuntimeServices,
} from "@marvin-agents/runtime-effect/runtime.js";
import type { LoadConfigOptions } from "@marvin-agents/runtime-effect/config.js";

export type RuntimeInitArgs = LoadConfigOptions;

export type RuntimeContext = RuntimeServices & {
  /**
   * Explicitly shuts down the runtime scope, allowing services like the LSP
   * manager to flush state before the process exits.
   */
  close: () => Promise<void>;
};

const toLayerOptions = (args: RuntimeInitArgs | undefined, adapter: AdapterKind): RuntimeLayerOptions => ({
  adapter,
  configDir: args?.configDir,
  configPath: args?.configPath,
  provider: args?.provider,
  model: args?.model,
  thinking: args?.thinking,
});

export const createRuntime = async (
  args: RuntimeInitArgs = {},
  adapter: AdapterKind = "tui",
): Promise<RuntimeContext> => {
  const layer = RuntimeLayer(toLayerOptions(args, adapter)) as Layer.Layer<RuntimeServices, never, never>;

  const setupEffect = Effect.gen(function* () {
    const scope = yield* Scope.make();
    const context = yield* Layer.buildWithScope(layer, scope);
    const services = Context.get(context, RuntimeServicesTag);
    return { services, scope };
  });

  const { services, scope } = await Effect.runPromise(setupEffect);

  let closed = false;
  const close = async () => {
    if (closed) return;
    closed = true;
    process.removeListener("exit", exitHandler);
    await Effect.runPromise(Scope.close(scope, Exit.void));
  };

  const exitHandler = () => {
    void close();
  };

  process.once("exit", exitHandler);

  return {
    ...services,
    close,
  };
};
