# Subagent Tool

Delegate tasks to specialized agents with isolated context windows.

## Structure

```
subagent/
├── index.ts          # The tool
├── agents/           # Agent definitions
│   ├── scout.md      # Fast recon (haiku)
│   ├── planner.md    # Implementation plans (sonnet)
│   ├── worker.md     # General purpose (sonnet)
│   ├── reviewer.md   # Code review (sonnet)
│   ├── debugger.md   # Root cause analysis (sonnet)
│   ├── tester.md     # Test writing (sonnet)
│   ├── documenter.md # Documentation (haiku)
│   ├── security.md   # Security audit (sonnet)
│   └── explainer.md  # Code explanation (haiku)
└── README.md
```

## Installation

```bash
# Install tool
cp examples/tools/subagent/index.ts ~/.config/marvin/tools/subagent.ts

# Install agents
mkdir -p ~/.config/marvin/agents
cp examples/tools/subagent/agents/*.md ~/.config/marvin/agents/
```

## Modes

| Mode | Parameters | Description |
|------|------------|-------------|
| Single | `{ agent, task }` | One agent, one task |
| Parallel | `{ tasks: [...] }` | Multiple agents concurrently (max 8) |
| Chain | `{ chain: [...] }` | Sequential, `{previous}` passes output |

## Usage Examples

**Single agent:**
```
Use scout to find all authentication code
```

**Parallel execution:**
```
Run scouts in parallel: one for models, one for providers
```

**Chained workflow:**
```
Chain: scout finds the code, planner creates implementation plan, worker implements
```

## Agent Scope

- `user` (default): `~/.config/marvin/agents/`
- `project`: `.marvin/agents/` in repo
- `both`: project overrides user

## Workflows

| Flow | Agents | Use Case |
|------|--------|----------|
| Scout → Planner | scout, planner | Planning without implementation |
| Scout → Planner → Worker | scout, planner, worker | Full implementation |
| Worker → Reviewer | worker, reviewer | Implement + review |
| Debugger | debugger | Isolated debugging session |

## Creating Custom Agents

```markdown
---
name: my-agent
description: One-line description
tools: read, grep, find, ls, bash
model: claude-sonnet-4-5
---

System prompt explaining the agent's role.
Define output format for consistency.
```

Model recommendations:
- **haiku** — fast, cheap: recon, docs, explanation
- **sonnet** — balanced: planning, implementation, review
