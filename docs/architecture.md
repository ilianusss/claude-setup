# Architecture

How this setup is built, and why each instruction lives where it does. For using it, read [workflow.md](workflow.md); for changing it, [editing.md](editing.md); for why things are the way they are, [decisions.md](decisions.md).

## Principles

1. **One mechanism, one job.** CLAUDE.md for always-on intent, rules for file-type guidance, skills for knowledge on demand, an agent for a fresh context, mods for logic and state, permissions and the sandbox for hard limits.
2. **Code for what is deterministic, prose for what needs judgment.** Routing, state, locks, gates and status are code in a mod. Phase instructions, guides and knowledge are markdown.
3. **Prose states intent, configuration enforces it.** Anything that must hold has a mod guard, a permission or the sandbox behind it.
4. **Documents on disk are the handoff.** Every phase and every slice can start in a fresh session, which is also what keeps the token cost down on a Pro plan.
5. **Global stays generic.** Commands, test globs, invariants and conventions of a project live in that project.
6. **Reuse what Anthropic maintains**: `/code-review`, `/security-review`, `skill-creator`, the Explore and Plan agents.
7. **Keep a rule only if it changes behaviour**: "would Claude do this unprompted", not "does Claude know this".
8. **The setup learns**: corrections that repeat become rules through the retro phase.

## The mechanisms

| Mechanism | Loaded | Context cost | Used for |
| --- | --- | --- | --- |
| `CLAUDE.md` | Every session | Always (about 45 lines) | Intent and rules that apply everywhere |
| `rules/*.md` with `paths` | When Claude reads or edits a matching file | Only when relevant | Guidance for one kind of file |
| `skills/*` | Description always, body when relevant | About 400 characters each | Knowledge and procedures |
| `agents/reviewer.md` | When spawned | A cold start each time | The fresh-context review, once per feature |
| `mods/warden`, `mods/workflow` | At session start, through `CLAUDE_CODE_PLUGIN_DIRS` | Zero, except what they choose to send | Commands with logic, state, guards that need state, status display |
| Permissions and sandbox (`settings.json`) | Never in context | Zero | Hard limits that hold even if a mod fails |

## File map

```text
~/.claude/
├── CLAUDE.md              global instructions
├── settings.json          permissions, sandbox, the rtk hook, the mods to load
├── rules/                 code, tests, typescript, frontend, infra, claude-setup
├── skills/                9 knowledge skills
├── agents/reviewer.md
├── mods/warden/            every session: em dashes, safety asks, test integrity
├── mods/workflow/         /workflow: phases, the test lock, gates
└── docs/
```

Everything else in `~/.claude` is Claude Code's runtime data, kept out of git by the whitelist `.gitignore`.

## Enforcement layers

| What must hold | Prose | Enforced by |
| --- | --- | --- |
| No secret is read | CLAUDE.md, Safety | `Read` deny rules, which the sandbox also applies to shell reads |
| Nothing is pushed, deployed or discarded without asking | CLAUDE.md, Safety | `warden` asks for the risky commands and for anything run outside the sandbox. No settings rule backs it: `settings.json` holds no `ask` or `allow` rules, so the rest is on the prose |
| No em dash | CLAUDE.md, Writing | `warden`: refuses edits, notebook cells, commit messages and GitHub text that add one; rewrites replies |
| No weakened test | `rules/tests.md`, `writing-tests-first` | `warden`: a note on each test edit, a follow-up at the end of a turn for shell changes |
| Tests stay apart from the implementation | `writing-tests-first`, the build phase | `workflow`: the test lock |
| A phase stays in its lane | Phase instructions | `workflow`: each phase's write scope |
| Gates and unlocks are the user's | Phase instructions | `workflow`: `$.ui.ask` dialogs only a person can answer |
| The workflow state is not tampered with | | `Edit` deny on `.git/claude-workflow/**` (sandbox included), lock fingerprints in the mod's store |

## Facts measured on this machine

Run in M0 with a probe mod and headless sessions; they shaped the design.

- **Permission rules match the command after `rtk` rewrites it.** A deny on `Bash(git push:*)` let `git push` through, because `rtk` had turned it into `rtk git push`. Every Bash rule and sandbox exclusion is written twice.
- **Ask rules prompt the user in auto mode.**
- **A mod's `tool.call` hook sees the command before `rtk`, and `tool.check` after it.** A failing rewritten command still comes back as an error with its exit code.
- **A tool a mod answers itself skips the permission step.** Approvals go through `$.ui.ask`.
- **The sandbox blocks shell writes into `.git/claude-workflow/`** through the merged `Edit` deny, while the mod's own writes go through.
- **A mod cannot run a command from inside its own command hook**: it answers first, then runs it from a timer.
- **Rewritten replies are stored and shown rewritten**, with no flash while streaming.

## The mods

Both are TypeScript modules for the Claude Code mod API (early access: it may change between releases), loaded from their folders through `CLAUDE_CODE_PLUGIN_DIRS`, and reloaded when their files change.

**warden** applies to every session:

- typography: refuses a Write, Edit or notebook cell that adds an em dash, and a commit message or GitHub body that holds one; rewrites em dashes in Claude's replies to a spaced hyphen before they are stored;
- safety asks: a person-only ask for a built-in list of risky commands (push, discards, infra changes, publishes), matched with or without `rtk`, in any segment of a compound command, in forms prefix rules miss (`git -C dir push`), and for any command Claude wants to run outside the sandbox;
- test integrity: a note when an edit adds `.only` or a skip, removes or changes an assertion, or rewrites a snapshot; at the end of a turn, the same check on the git diff catches shell changes and queues one follow-up.

**workflow** runs project workflows:

- the `/workflow` command, whose bookkeeping (status, lists, closing) costs no model turn;
- the state in `<git common dir>/claude-workflow/`, uncommitted, shared by every worktree, written only by the mod;
- five tools for Claude (`handoff`, `advance`, `lock`, `verify`, `unlock`), registered only in repos with a workflow;
- the test lock: a slice's tests are locked once the mod saw the exact test command fail on the current code, and the slice closes once it saw every check pass on the current code. The mod never runs project code: it watches the commands Claude runs in the sandbox;
- guards: locked tests refused to Edit and restored after a shell change, each phase limited to the files it may write;
- prompts composed per step: the phase file, the state, and for a build the slice with the design sections it names.

The phase files, guides and templates are markdown inside the mod. If the API breaks after an update, they still work by hand (see [editing.md](editing.md)).

## Token budget

What costs on a subscription: every turn resends the whole context; every agent is a cold start; verbose command output (reduced by `rtk`); high effort. Hence:

- no agents inside the slice cycle, one reviewer per feature;
- one slice per session, with `/workflow next` clearing the context;
- the mod's bookkeeping and status line cost nothing;
- nothing workflow-related is loaded in a repo without a workflow;
- spec, design, slice and inspect are reasoning-heavy (Opus, high effort); the build is well specified by then (Sonnet, or Opus at medium effort).
