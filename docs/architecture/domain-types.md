# Domain types + schema helpers

The `packages/types` workspace provides the canonical TypeBox schemas for our agent
data model. These schemas mirror `packages/ai/src/types.ts` and
`utils/typebox-helpers.ts` from **pi-mono**, but are rewritten so that TypeBox schemas
are the source of truth instead of TypeScript interfaces. Each schema exports the
compiled TypeBox object alongside a `Static<typeof Schema>` alias so downstream
packages can choose between runtime validation and type inference.

## Layout

- `packages/types/src/helpers/typebox-helpers.ts` — strict object helpers,
  `StringEnum`, `Nullable`, and runtime validators. The helper API is a direct
  translation of the utilities in `pi-mono/utils/typebox-helpers.ts` with the
  same ergonomics but the TypeBox schema remains the primary artifact.
- `packages/types/src/schemas/messages.ts` — roles, content block variants, and the
  top-level `AgentConversation` schema. These correspond to the message helpers in
  `pi-mono/packages/ai/src/types.ts` so the serialized form is identical.
- `packages/types/src/schemas/usage.ts` — token accounting, provider billing
  metadata, and latency reporting. Matches the `Usage` shapes referenced in the
  pi runtime when emitting telemetry.
- `packages/types/src/schemas/tools.ts` — tool/function definitions, invocation
  payloads, and tool results. Tools embed JSON Schema fragments the same way they
  do in `pi-mono/packages/ai/src/types.ts` so the runtime can forward them to
  providers without translation.
- `packages/types/src/schemas/providers.ts` — provider metadata + response shells
  that wrap usage data and raw payloads for debugging.
- `packages/types/src/schemas/config.ts` — provider/model configuration + runtime
  overrides. Mirrors the `AgentRuntimeConfig` helpers in pi-mono.

Every schema ships with a `createValidator`-powered runtime predicate (e.g.
`isAgentMessage`) so API layers can eagerly validate inputs before handing them to
providers. When a schema fails validation we throw a `TypeBoxValidationError`
with the exact issues returned by `Value.Errors` which keeps parity with
pi-mono's debugging story.

## Authoring guidelines

1. Define new primitives in `packages/types/src/schemas` and always export both the
   schema constant and its `Static<>` TypeScript alias.
2. Keep object schemas closed (`additionalProperties: false`) via `StrictObject` to
   avoid silent shape drift between mu and pi.
3. Prefer referencing shared helpers (message content blocks, tool invocations,
   etc.) instead of redefining inline structures so we maintain compatibility with
   `pi-mono/packages/ai/src/types.ts`.
4. Tests and type checking should flow through `npm run check` which runs `tsc`
   against the TypeBox-first sources.
