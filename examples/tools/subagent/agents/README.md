# Agents

Specialized agents for the subagent tool.

| Agent | Model | Purpose |
|-------|-------|---------|
| **scout** | haiku | Fast codebase recon, compressed context for handoff |
| **planner** | sonnet | Creates implementation plans from scout findings |
| **worker** | sonnet | General-purpose with full capabilities |
| **reviewer** | sonnet | Code review for quality and security |
| **debugger** | sonnet | Root cause analysis, traces bugs through code |
| **tester** | sonnet | Writes comprehensive test cases |
| **documenter** | haiku | Fast docs: README, comments, JSDoc |
| **security** | sonnet | Security audit, vulnerability scanning |
| **explainer** | haiku | Explains code for onboarding |

## Installation

```bash
mkdir -p ~/.config/marvin/agents
cp *.md ~/.config/marvin/agents/
```

## Format

```markdown
---
name: agent-name
description: One-line description
tools: read, grep, find, ls, bash
model: claude-sonnet-4-5
---

System prompt with role and output format.
```
