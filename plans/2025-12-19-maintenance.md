# 2025-12-19 maintenance

Track:

- [x] Config/token path unify under `~/.config/marvin` + atomic writes + `0600` perms
  - [x] `apps/coding-agent` headless/tui Codex token path
  - [x] `packages/agent` codex-auth-cli token path + hygiene
- [ ] Split `apps/coding-agent/src/tui-app.ts` modules
  - [ ] session UI
  - [ ] footer
  - [ ] message rendering
  - [ ] keybinding controller
- [ ] Fix naming/typos
  - [ ] rename `transorm-messages.ts` -> `transform-messages.ts` + update imports
  - [ ] fix user-facing typos ("unknown error occurred", etc)
- [ ] Docs/env var standardize on `GEMINI_API_KEY`
- [ ] Remove `MU_*` env var usage/docs
- [ ] Remove unused `vitest.config.ts` (or wire up)
