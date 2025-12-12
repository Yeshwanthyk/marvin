# Tool host + truncation utilities

`packages/tools` mirrors the structure of `reference/pi-mono/packages/coding-agent`
but only implements the primitives required for this bead: `fs.read`, `fs.write`,
`fs.edit`, `fs.ls`, `fs.grep`, and `shell.bash`. Each tool exposes a TypeBox
schema that the runtime feeds directly into the `ToolRegistry`, so the provider
layer can publish accurate JSON Schema definitions to models.

## ToolRegistry
- `ToolRegistry` stores registrations keyed by tool name. Each registration contains
  the TypeBox schema, metadata, and the async handler.
- `registry.invoke(name, payload, overrides?)` validates the payload against the
  schema before dispatching the handler with a normalized execution context
  (`cwd`, `env`, `tmpDir`, truncation config).
- `createDefaultToolRegistry()` wires the default truncation config and registers
  the six minimal tools so the runtime can ask for `registry.listDefinitions()`
  when exposing tool availability to providers.

## Truncation helpers
- `truncateHead`/`truncateTail` remove bytes from the corresponding side of the
  payload while appending/prepending a standard marker. They operate on byte
  counts, so multi-byte characters remain intact.
- `truncateLines` limits text to a specific number of lines (`head` vs `tail`
  positioning). `summarizeText` composes byte and line truncation so file reads
  and ripgrep output never exceed the configured budget.
- `DEFAULT_TRUNCATION_CONFIG` exposes two knobs: `text` (32 KB + 400 lines) and
  `command` (64 KB). Callers can override either limit by passing explicit values
  through the execution context or per-tool options. Every tool returns metadata
  describing whether truncation occurred and how many bytes/lines were dropped.

## Temp-file + atomic writes
- `writeFileAtomic` persists data to `.mu-tmp-<filename>-<uuid>` inside the
  destination directory and renames it into place. Windows requires a defensive
  `rm` before rename; the helper handles that to keep behavior consistent.
- `writeTempFile` copies data into `${tmpDir}/${basename}-${timestamp}-${uuid}`
  and returns the path. `fs.edit` uses this to stash the pre-edit version so that
  plan operators can recover the original file if a replacement went sideways.
- `fs.write` relies on `writeFileAtomic` (or `appendFile` when explicitly
  requested) and will optionally ensure directories exist + enforce trailing
  newlines to keep lint noise down.

## Tool behavior
- `fs.read` — Reads UTF-8 (default) or base64 files, returning truncated previews
  with omitted byte/line accounting. Callers can raise/lower `maxBytes`/`maxLines`
  on demand.
- `fs.write` — Writes or appends UTF-8/base64 content. Defaults to atomic writes,
  directory creation, and optional newline enforcement. Returns byte counts so
  plans can confirm output size.
- `fs.edit` — Sequentially applies search/replace operations (each must match an
  existing snippet). The original file is copied to the registry `tmpDir` when
  `saveBackup` is true (default) and the backup path is returned in the payload.
- `fs.ls` — Lists entries (optionally recursive) up to a configurable entry cap.
  Entries include relative paths, types, and file sizes when available.
- `fs.grep` — Shells out to `rg --json` so each match carries file/line/submatch
  metadata. Raw stdout/stderr are truncated before returning to the runtime.
- `shell.bash` — Executes `bash -lc` commands, piping optional stdin, enforcing
  timeouts, and truncating stdout/stderr with byte budgets separate from the
  `fs` text helper.
