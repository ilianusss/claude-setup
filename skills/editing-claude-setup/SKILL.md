---
name: editing-claude-setup
description: Changing this Claude Code setup in ~/.claude - where a new instruction belongs (CLAUDE.md, rule, skill, agent, mod, permission), the house style, skill description budgets, testing a change, and what to update after it. Use when asked to add, change or remove an instruction, rule, skill, agent, hook, mod, permission or setting, or when a retro proposes a change to the setup.
---

# Editing the Claude Code setup

`~/.claude` is a git repo (`ilianusss/.claude`) holding both mods, `mods/warden` and `mods/workflow`. `docs/architecture.md` explains how the pieces fit; read it before a structural change.

## Where an instruction goes

Pick the first row that fits:

| The instruction | Goes in | Why |
| --- | --- | --- |
| Must hold even if everything else fails (never read secrets, ask before push) | A permission in `settings.json`, or a `warden` guard for shell commands (permissions on Read and Edit do not bind the shell) | Enforced by Claude Code or the mod |
| Needs logic, state, or a guard that depends on state | A mod: `mods/warden` if it applies to every session, `mods/workflow` if it is about workflows | Code, zero context cost |
| Needs a fresh context (an independent review) | An agent in `agents/` | Its own context window |
| A manual command with no logic | A skill with `disable-model-invocation: true` | No context cost until typed |
| A procedure or knowledge Claude should pick up on its own | A skill in `skills/` | Description always loaded, body on demand |
| Always relevant, in every session | `CLAUDE.md` | Always loaded: keep it under ~50 lines |
| Specific to one project | That project's `CLAUDE.md` or `.claude/` | Global stays generic |

Keep an instruction only if it changes behaviour: the test is "would Claude do this unprompted", not "does Claude know this".

## House style

- Skill names are gerunds (`writing-readmes`). Agents and mods are nouns.
- A skill description starts with what it covers and the phrases that should trigger it, in under ~400 characters. Everything else goes in the body.
- Explain why a rule exists instead of writing it in capitals.
- References sit one level deep, linked from the body with when to read them.
- No em dash anywhere (the `warden` mod refuses them).
- A user instruction and a project instruction do not override each other: Claude "may follow either". A project CLAUDE.md extends, never contradicts.
- No path-scoped rules (`rules/` with `paths`): they load only when Claude's Read, Edit or Write tools touch a matching file, and in auto mode Claude mostly works through Bash. Guidance for one kind of file goes in the skill for that work.

## Gotchas measured on this machine

- **Bash permission rules match the command after `rtk` rewrites it.** Write every Bash rule twice: `Bash(gh pr merge:*)` and `Bash(rtk gh pr merge:*)`. git is the exception: it is in rtk's `exclude_commands`, because a session in a worktree refuses `rtk git ...`.
- **Setup changes are made in a worktree of `~/.claude` too, and the running setup only changes once the branch is merged into main**: mods load from `~/.claude/mods`. Test a mod by its worktree path, after copying the gitignored `.claude-plugin/types/` folders from the main checkout for `tsc`. `claude plugin eval` sandboxes run in a git repo, so a case that writes a file meets warden's worktree guard.
- **A tool a mod answers itself skips the permission step.** A mod tool that needs the user's approval asks with `$.ui.ask`, never through `tool.check` or a settings rule.
- **A mod command cannot run another command from its own hook.** Answer first, then run it from `$.clock.after`.
- **`tool.call` sees a Bash command before `rtk`, `tool.check` after it.** Match both forms.
- **The engine refuses to load a mod** whose hook is not a function literal (or a function's name), that registers two hooks on one event without a matcher, that puts `$` in an object, or that passes `$` to anything but a top-level function, declared or imported. `claude plugin test` reports "hooks module did not load" with the line.
- **A mod's generated MCP types list the tools of the session that last saved the mod.** The workflow mod's own tools are declared in `mods/workflow/types/index.d.ts` so the type-check does not depend on where the mod was saved; if `tsc` ever reports "Subsequent property declarations must have the same type" for an `mcp__workflow__*` tool, align that declaration with the tool's `inputSchema`.
- **A skill with `paths` in its frontmatter is offered only when Claude's tools touch a matching file**, like a rule: leave `paths` out.
- **`warden` refuses a literal em dash in a Write**, mod sources included: build it with `String.fromCharCode(0x2014)`.

## Mods

- The API is early access and changes between releases. The types are written beside each loaded mod in `.claude-plugin/types/claude-code/index.d.ts`: grep them for the event or method at hand rather than trusting memory.
- Every guard has a `.catch` that refuses, so an error blocks the action instead of letting it through.
- A mod never runs project code: tests run through Bash, the mod only watches their results.
- Write the test first (`writing-tests-first`): `mods/<name>/tests/*.test.ts`, run with `claude plugin test mods/<name>`.

## Testing a change

| Changed | Check |
| --- | --- |
| A mod | `claude plugin validate mods/<name>`, `claude plugin test mods/<name>`, and a type-check: `npx -y -p typescript@5.6.3 tsc -p mods/<name>` once the mod has loaded once |
| warden's behaviour | `claude plugin eval mods/warden --trust-plugin --allow-tools Bash Write Read`, which also runs each case without warden. Add a case in `mods/warden/evals/<name>/case.yaml` for each new guard |
| CLAUDE.md, a skill or the workflow's behaviour | `~/.claude/audit/harness/regress.sh`, compared with the audit baseline it prints |
| `settings.json` | `claude -p --model haiku --settings settings.json "Reply OK"` from a scratch folder: a rejected setting shows up there |
| A permission rule | A headless run in a scratch repo with only that rule, asking Claude to run the command, as in M0 (`docs/decisions.md`) |
| A skill | The `skill-creator` skill's evals: a few prompts that should and should not trigger it |

## After a change

1. Update the doc that describes it: `docs/architecture.md` for mechanisms, `docs/workflow.md` for the workflow, `docs/editing.md` for how to edit.
2. Add a dated line to `docs/decisions.md` when the change is a decision someone could later question.
3. Rules, skills, agents and CLAUDE.md are read by new sessions; mods reload when their files change; `settings.json` changes apply to the running session for most keys.
4. Commit only when asked, following `following-git-conventions`. Scopes: `claude-md`, `settings`, `skills`, `agents`, `warden`, `workflow`, `docs`.
