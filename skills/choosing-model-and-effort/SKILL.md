---
name: choosing-model-and-effort
description: Choosing the model and effort for a subagent, an agent or skill definition, or the main session - the task-to-model table, when xhigh is earned, what is never used (Fable, max), and the Pro plan limits behind it. Use before calling the Agent tool, when writing model or effort in a frontmatter, or when asked which model or effort fits a task.
---

# Choosing the model and effort

The user is on a Pro plan. Its usage limits reset on a five-hour window and a weekly one, and the main session and every subagent draw on the same limits. Opus uses them faster than Sonnet and Sonnet faster than Haiku. Effort sets how much the model thinks, and thinking is billed as output tokens. A bad pick can use up a window, so choose the cheapest model and effort that do the job well, and only go higher when the task shows it needs more.

## Never

- **Fable** (`fable`, or `best`, which resolves to it): on Pro it can bill to usage credits, and the user has ruled it out.
- **`max` effort**: Anthropic warns that it gives diminishing returns and tends to overthink. The user caps effort at `xhigh`.
- **`xhigh` without a reason**: see [When xhigh is earned](#when-xhigh-is-earned).

## Pick by task

| Task | Model | Effort |
| --- | --- | --- |
| Find a file, a symbol or a usage; read logs or docs and summarise them; list or count things | `haiku` | `low` |
| A mechanical change with a clear spec: a rename, boilerplate, a known fix applied across files, running checks and reporting the result | `sonnet` | `low` |
| Implementing a well-specified feature or slice | `sonnet` | `medium` |
| Fixing a bug in existing code, or any work where edge cases and verification matter | `sonnet` | `high` |
| The same bug work across many files or modules | `opus` | `medium` |
| Design, spec, plan, review of a diff, security review, any decision that is costly to undo | `opus` | `high` |
| The rare task that earns it (next section) | `opus` | `xhigh` |

When two rows both fit, look at what happens to the result. If you will check it yourself (code with tests, a search you will read), take the lower row: redoing a weak result costs less than spending a window. If nobody checks it afterwards (a review, a plan the user approves on trust), take the higher row.

These follow Anthropic's guidance: Sonnet handles most coding and costs less than Opus; Opus is for complex architecture and multi-step reasoning; Haiku is for simple subagent tasks. `low` effort fits small changes whose result is reviewed, `medium` fits clear-scope work, and `high` fits work where verification matters.

## When xhigh is earned

`xhigh` is only for Opus, and only when one of these holds:

- `high` already ran on this same task and fell short: it missed the cause, or the review was shallow.
- A hard problem that has to be worked through alone with no review afterwards: a subtle concurrency or security flaw, or a data migration that cannot be undone.
- The user asks for it.

When you spawn an agent at `xhigh`, tell the user why in one line. Never use it for a task the table places lower.

## Setting it on a subagent

- **On the Agent tool**, pass `model` (`haiku`, `sonnet` or `opus`) and `effort` on every call. This skill is the explicit instruction the tool needs before it takes `effort`. Without `effort`, the subagent runs at the session's effort, which is often `high`, so a Haiku lookup needs `effort: low` set explicitly.
- **Without `model`**, the subagent uses the agent definition's `model`, then `CLAUDE_CODE_SUBAGENT_MODEL`, then the main session's model.
- **Built-in Explore** runs on Opus on a subscription, whatever the session's model. Pass `haiku` for a quick or medium sweep and `sonnet` for a very thorough one.
- **Built-in Plan and general-purpose** inherit the session's model, so pass a model when the session runs Opus and the task does not need it.
- **A fork** always runs on the parent's model. When the task needs a cheaper model, spawn a fresh agent with a tight prompt instead.
- `/tasks` shows the model and effort of each running subagent.

## Setting it in a definition

- **An agent** (`agents/*.md`) has `model` and `effort` fields. `inherit` follows whatever model the user picked for the session. Set a fixed model only when the agent always does the same kind of task, for example a lookup agent on `haiku`.
- **A skill** has the same fields. They apply until the end of the turn the skill runs in, or for the forked subagent's whole run with `context: fork`. They are rarely worth setting, because a skill usually runs inside the user's own task.
- The same table and the same Never list apply.

## Before spawning at all

Every subagent starts cold: it rereads context and spends from the same limits as the main session. Spawn one only when the user asks or a workflow or skill calls for it, and only when the work is self-contained, produces verbose output, and only a summary needs to come back. Keep back-and-forth work, quick targeted changes and phases that share context in the main session.

## The main session

Claude cannot change its own model. When the session clearly does not match the task in front of it (Opus at `high` doing a run of renames, or Sonnet at `low` doing a design), say so in one line and suggest `/model` or `/effort`, then carry on without waiting for an answer.

## Sources

These facts were checked on 2026-11-02 against the Claude Code docs, when the aliases resolved to Opus 5.5, Sonnet 5.5 and Haiku 5.5. Reread these pages if a model, an alias or a parameter behaves unexpectedly:

- [Model configuration](https://code.claude.com/docs/en/model-config): aliases, effort levels, defaults
- [Subagents](https://code.claude.com/docs/en/sub-agents): `model` and `effort` resolution, built-in agents
- [Costs](https://code.claude.com/docs/en/costs): choosing a model, plan usage
