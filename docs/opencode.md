# OpenCode Desktop Reference

This document is a focused map of OpenCode's desktop implementation and core system design. It is intended as a reference for enabling a desktop GUI in marvin.

## System Design Summary

OpenCode is a client/server architecture.

- The core runtime is the `opencode` server started via a CLI command.
- Clients (TUI, web, desktop) talk to the same HTTP API.
- Desktop is a Tauri shell that spawns the CLI as a local sidecar and renders a web UI that connects over localhost.

## Runtime Flow (Desktop)

1. Tauri starts the desktop process and selects a port.
2. It spawns the `opencode` CLI sidecar in server mode, and injects the port into the webview runtime.
3. The web app resolves its backend URL from the injected port and uses the JS SDK to talk to the server.
4. The UI subscribes to server-sent events for global updates and pulls per-project data on demand.

## Repository Map and Crucial Files

### Desktop Shell (Tauri)

- `packages/desktop/src/index.tsx` Tauri entrypoint that mounts the web app and wires platform capabilities (dialogs, storage, updater, fetch).
- `packages/desktop/src/menu.ts` macOS application menu wiring.
- `packages/desktop/src/updater.ts` user-facing update flow and relaunch.
- `packages/desktop/src-tauri/src/lib.rs` sidecar spawn, log capture, port selection, and webview initialization.
- `packages/desktop/src-tauri/src/main.rs` platform startup logic, including Linux display backend selection.
- `packages/desktop/src-tauri/src/window_customizer.rs` disables pinch-to-zoom on Linux.
- `packages/desktop/src-tauri/tauri.conf.json` dev bundle config and sidecar declaration.
- `packages/desktop/src-tauri/tauri.prod.conf.json` release config with updater settings.
- `packages/desktop/scripts/predev.ts` builds a local CLI binary and copies it into the sidecar folder for dev.
- `packages/desktop/scripts/prepare.ts` downloads CI artifacts for sidecar packaging.
- `packages/desktop/scripts/utils.ts` maps Rust targets to CLI binaries and copies them into `src-tauri/sidecars`.

### Web App (Shared UI)

- `packages/app/src/app.tsx` root UI composition, provider stack, and backend URL resolution logic.
- `packages/app/src/context/platform.tsx` cross-platform abstraction used by web and desktop (dialogs, storage, updates, fetch override).
- `packages/app/src/context/global-sdk.tsx` SDK client setup plus SSE subscription for global events.
- `packages/app/src/context/global-sync.tsx` orchestrates initial data load and state sync via SDK calls.
- `packages/app/src/entry.tsx` web runtime entrypoint (non-desktop).

### Server and Core Runtime

- `packages/opencode/src/cli/cmd/serve.ts` headless server command used by desktop and SDK.
- `packages/opencode/src/server/server.ts` Hono HTTP API, SSE events, websocket PTY, and request scoping.
- `packages/opencode/src/server/project.ts` project scoped routes.
- `packages/opencode/src/project` project discovery and instance bootstrapping.
- `packages/opencode/src/session` session persistence, messages, and lifecycle.
- `packages/opencode/src/tool` tool registry and tool execution.

### SDK and API Contracts

- `packages/sdk/openapi.json` canonical API spec.
- `packages/sdk/js/src/v2/client.ts` typed JS client used by the UI.
- `packages/sdk/js/src/server.ts` helper that can spawn a local server.

### UI System

- `packages/ui/src` design system, theming, components, and shared UI utilities used by the app.

## Build and Packaging Flow

- `packages/opencode/script/build.ts` multi-target Bun compilation that produces platform-specific CLI binaries.
- `packages/desktop/scripts/predev.ts` and `packages/desktop/scripts/prepare.ts` ensure a correct CLI sidecar lands in `src-tauri/sidecars`.
- `packages/desktop/src-tauri/tauri.conf.json` declares `externalBin` for sidecar packaging.
- `packages/desktop/src-tauri/tauri.prod.conf.json` configures the updater endpoint and signing.

## Integration Notes

- Desktop uses a single injected field, `window.__OPENCODE__.port`, to route all API calls.
- The server scopes requests to a directory using a query param or the `x-opencode-directory` header.
- Global events are delivered over SSE at `/global/event`, with a heartbeat to keep WebKit alive.
- The desktop app uses a Tauri-backed storage adapter in place of `localStorage`.

## Marvin vs OpenCode (Key Deltas)

### Architecture Differences

- Marvin today is an in-process CLI/TUI with no HTTP server or SDK; OpenCode is a client/server system.
- Marvin session persistence is local JSONL files per cwd; OpenCode stores sessions behind the server and exposes them via API.
- Marvin streams events directly from the agent to the TUI; OpenCode streams via SSE and websocket over HTTP.
- Marvin has no web UI package; OpenCode has a shared web app (`packages/app`) and UI system (`packages/ui`).
- Marvin build outputs a single CLI binary; OpenCode builds multi-target sidecar binaries and bundles them with Tauri.
- Marvin has no desktop packaging, update flow, or sidecar management; OpenCode uses Tauri with updater and sidecar supervision.

### What Marvin Must Add or Change

- Add a headless server mode that hosts the agent loop, tools, sessions, and configuration over HTTP.
- Define an API contract (OpenAPI or schema-based) for sessions, messages, tool results, config, and status.
- Add an SDK package to keep the web UI and any future clients in sync with the API surface.
- Implement a web UI package for desktop that can connect to the local server via injected port.
- Introduce a desktop Tauri shell that spawns the server binary as a sidecar and manages lifecycle/logs.
- Decide on a single-writer model for sessions or add a concurrency strategy if multiple clients connect.
- Add auth or random per-launch tokens to protect the local API (loopback is not enough on shared machines).
- Align session storage and event semantics with the new server API to avoid drift between TUI and desktop.

### Target End-State (Alignment With OpenCode)

- Server-first architecture: all UI surfaces (TUI, web, desktop) are clients of the same local API.
- A Tauri app that bootstraps the server and injects runtime config into the webview.
- A shared SDK that encodes request routing (directory scoping) and streaming semantics.
- A reproducible build chain that produces both the server binary and desktop bundles.
