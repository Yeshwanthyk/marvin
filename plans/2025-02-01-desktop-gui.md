# Desktop GUI (Tauri) Plan for marvin

## Goals

- Ship a desktop GUI (Option 1) with a Tauri shell + local server sidecar.
- Move marvin to a server-first architecture so UI clients share the same API.
- Preserve correctness and session safety while introducing multi-client access.

## Non-Goals

- No redesign of model/tool behavior beyond what is required for server mode.
- No mobile client or remote-hosted service in this phase.

## Current State (marvin)

- Single binary CLI/TUI with in-process agent loop.
- Session persistence is JSONL per cwd (`~/.config/marvin/sessions/...`).
- No HTTP server, SDK, or web UI.

## Target Architecture (OpenCode-style)

- Local server process owns sessions, tools, agent loop, and configuration.
- Web UI connects to server via injected port (desktop) or known URL (web).
- Desktop Tauri app spawns the server binary as a sidecar and manages lifecycle.
- Shared SDK is the only client surface, used by desktop UI and later TUI.

## Phased Plan

### Phase 0: Architecture Decisions and Specs

- Decide server placement: new `packages/server` vs `apps/coding-agent` subcommand.
- Define the API contract (OpenAPI or schema-first) for sessions, messages, tools, config, and status.
- Decide on streaming semantics: SSE for events, websocket for PTY-like streams, HTTP streaming for prompt responses.
- Security model: per-launch auth token injected into webview; loopback-only binding; optional filesystem token.
- Session ownership: server-only writes; define migration path for existing JSONL sessions.

Deliverables: architecture doc, API spec draft, streaming model choice, auth plan.

### Phase 1: Server Runtime and State Ownership

- Implement `marvin serve` headless mode to host the agent loop and session manager.
- Extract or wrap current in-process session logic behind server APIs.
- Add directory scoping (query param or header) to support multi-project isolation.
- Add global events channel (SSE) to broadcast session updates and status changes.

Deliverables: working server process with minimal endpoints and session persistence.

### Phase 2: SDK and Client Contracts

- Generate a typed JS SDK from the API spec.
- Provide a client API for sessions, messages, tools, and global events.
- Include streaming helpers for prompt output and tool updates.

Deliverables: `packages/sdk` with v1 client and event streaming.

### Phase 3: Web UI for Desktop

- Create a new web UI package that consumes the SDK and targets desktop use.
- Implement essential flows: create session, send prompt, streaming messages, tool output rendering, config edits.
- Add platform abstraction layer for dialogs, storage, and updates (Tauri-only features).

Deliverables: a minimal web UI that can drive the local server.

### Phase 4: Tauri Desktop Shell

- Create `packages/desktop` with Tauri configuration and Rust sidecar management.
- Spawn the server binary as a sidecar with a random port and auth token.
- Inject runtime config into the webview (`window.__MARVIN__`)
- Capture logs and provide a copy-to-clipboard path for crash support.

Deliverables: dev desktop app that boots server and loads the UI.

### Phase 5: Build and Release Pipeline

- Add a multi-target build for the server binary (darwin/linux/windows).
- Add scripts to copy or download sidecar binaries into `src-tauri/sidecars`.
- Produce packaged artifacts (dmg, nsis, deb/rpm/appimage) and updater metadata.

Deliverables: CI pipeline that outputs desktop installers with sidecar embedded.

### Phase 6: Optional Alignment of TUI to Server

- Decide whether to keep the TUI in-process or move it to SDK-based client.
- If migrating, rewire the TUI to consume streamed events from the server.

Deliverables: unified client model (optional, but reduces long-term drift).

## API Scope (Initial)

- Health/version: `/health`
- Sessions: list/create/get/update/delete
- Messages: list/create (streamed), get
- Tools: list, invoke results (if needed for UI display)
- Config: get/update
- Status: model/provider metadata, agent status, errors
- Events: SSE `/events` for global updates

## Risks / Constraints

- Concurrency safety for session writes once multiple clients exist.
- Streaming protocol complexity (tool streaming vs message streaming).
- Local API security (loopback is not enough for shared/multi-user machines).
- Build pipeline complexity for multi-target sidecar binaries.

## Review Checklist

- Does the API spec cover all current TUI features required for desktop?
- Is the auth model sufficient for local threat model?
- Are session migration and compatibility addressed?
- Is streaming behavior consistent with agent event semantics?
- Are packaging targets aligned with release expectations?
