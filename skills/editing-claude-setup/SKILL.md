---
name: editing-claude-setup
description: Changing this Claude Code setup in ~/.claude - where a new instruction belongs (CLAUDE.md, rule, skill, agent, mod, permission), the house style, skill description budgets, testing a change, and what to update after it. Use when asked to add, change or remove an instruction, rule, skill, agent, hook, mod, permission or setting, or when a retro proposes a change to the setup.
---

# Editing the Claude Code setup

`~/.claude` is a git repo (`ilianusss/.claude`); the workflow mod is its own repo (`ilianusss/claude-workflow`), a submodule at `mods/workflow`. `docs/architecture.md` explains how the pieces fit; read it before a structural change.

## Where an instruction goes

Pick the first row that fits:

| The instruction | Goes in | Why |
| --- | --- | --- |
| Must hold even if everything else fails (never read secrets, ask before push) | A permission or sandbox entry in `settings.json` | Enforced by Claude Code itself |
| Needs logic, state, or a guard that depends on state | A mod: `mods/warden` if it applies to every session, `mods/workflow` if it is about workflows | Code, zero context cost |
| Needs a fresh context (an independent review) | An agent in `agents/` | Its own context window |
| A manual command with no logic | A skill with `disable-model-invocation: true` | No context cost until typed |
| A procedure or knowledge Claude should pick up on its own | A skill in `skills/` | Description always loaded, body on demand |
| Tied to a file type | A rule in `rules/` with `paths` | Loaded only when a matching file is touched |
| Always relevant, in every session | `CLAUDE.md` | Always loaded: keep it under ~50 lines |
| Specific to one project | That project's `CLAUDE.md` or `.claude/` | Global stays generic |

Keep an instruction only if it changes behaviour: the test is "would Claude do this unprompted", not "does Claude know this".

## House style

- Skill names are gerunds (`writing-readmes`). Agents and mods are nouns.
- A skill description starts with what it covers and the phrases that should trigger it, in under ~400 characters. Everything else goes in the body.
- Explain why a rule exists instead of writing it in capitals.
- References sit one level deep, linked from the body with when to read them.
- No em dash anywhere (the `warden` mod refuses them).
- A user rule and a project rule do not override each other: Claude "may follow either". A project rule extends, never contradicts.

## Gotchas measured on this machine

- **Bash permission rules match the command after `rtk` rewrites it.** Write every Bash rule twice: `Bash(git push:*)` and `Bash(rtk git push:*)`. The same holds for `sandbox.excludedCommands`.
- **A tool a mod answers itself skips the permission step.** A mod tool that needs the user's approval asks with `$.ui.ask`, never through `tool.check` or a settings rule.
- **A mod command cannot run another command from its own hook.** Answer first, then run it from `$.clock.after`.
- **`tool.call` sees a Bash command before `rtk`, `tool.check` after it.** Match both forms.
- **The engine refuses to load a mod** whose hook is not a function literal (or a function's name), that registers two hooks on one event without a matcher, that puts `$` in an object, or that passes `$` to anything but a top-level function, declared or imported. `claude plugin test` reports "hooks module did not load" with the line.
- **`warden` refuses a literal em dash in a Write**, mod sources included: build it with `String.fromCharCode(0x2014)`.

## Mods

- The API is early access and changes between releases. The types are written beside each loaded mod in `.claude-plugin/types/claude-code/index.d.ts`: grep them for the event or method at hand rather than trusting memory.
- Every guard has a `.catch` that refuses, so an error blocks the action instead of letting it through.
- A mod never runs project code: tests run in the sandbox through Bash, the mod only watches their results.
- Write the test first (`writing-tests-first`): `mods/<name>/tests/*.test.ts`, run with `claude plugin test mods/<name>`.

## Testing a change

| Changed | Check |
| --- | --- |
| A mod | `claude plugin validate mods/<name>`, `claude plugin test mods/<name>`, and a type-check: `npx -y -p typescript@5.6.3 tsc -p mods/<name>` once the mod has loaded once |
| `settings.json` | `claude -p --model haiku --settings settings.json "Reply OK"` from a scratch folder: a rejected setting shows up there |
| A permission rule | A headless run in a scratch repo with only that rule, asking Claude to run the command, as in M0 (`docs/decisions.md`) |
| A skill | The `skill-creator` skill's evals: a few prompts that should and should not trigger it |
| A rule | Open a matching file in a session and check the rule appears in context |

## After a change

1. Update the doc that describes it: `docs/architecture.md` for mechanisms, `docs/workflow.md` for the workflow, `docs/editing.md` for how to edit.
2. Add a dated line to `docs/decisions.md` when the change is a decision someone could later question.
3. Rules, skills, agents and CLAUDE.md are read by new sessions; mods reload when their files change; `settings.json` changes apply to the running session for most keys.
4. A change to the workflow mod is committed in its repo, then the submodule pointer is committed in `~/.claude`.
5. Commit only when asked, following `following-git-conventions`. Scopes: `claude-md`, `settings`, `rules`, `skills`, `agents`, `warden`, `workflow`, `docs`.
