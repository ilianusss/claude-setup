# Architecture

How this setup is built, and why each instruction lives where it does. For using it, read [workflow.md](workflow.md); for changing it, [editing.md](editing.md); for why things are the way they are, [decisions.md](decisions.md).

## Principles

1. **One mechanism, one job.** CLAUDE.md for always-on intent, skills for knowledge on demand, an agent for a fresh context, mods for logic and state, permissions for hard limits.
2. **Code for what is deterministic, prose for what needs judgment.** Routing, state, locks, gates and status are code in a mod. Phase instructions, guides and knowledge are markdown.
3. **Prose states intent, configuration enforces it.** Anything that must hold has a mod guard or a permission behind it.
4. **Documents on disk are the handoff.** Every phase and every slice can start in a fresh session, which is also what keeps the token cost down on a Pro plan.
5. **Global stays generic.** Commands, test globs, invariants and conventions of a project live in that project.
6. **Reuse what Anthropic maintains**: `/code-review`, `/security-review`, `skill-creator`, the Explore and Plan agents.
7. **Keep a rule only if it changes behaviour**: "would Claude do this unprompted", not "does Claude know this".
8. **The setup learns**: corrections that repeat become CLAUDE.md lines or skill edits through the retro phase.

## The mechanisms

| Mechanism | Loaded | Context cost | Used for |
| --- | --- | --- | --- |
| `CLAUDE.md` | Every session | Always (about 45 lines) | Intent and rules that apply everywhere |
| `skills/*` | Description always, body when relevant | About 400 characters each | Knowledge and procedures |
| `agents/reviewer.md` | When spawned | A cold start each time | The fresh-context review, once per feature |
| `mods/warden`, `mods/workflow`, `mods/scribe`, `mods/shush` | At session start, through `CLAUDE_CODE_PLUGIN_DIRS` | Zero, except what they choose to send | Commands with logic, state, guards that need state, status display |
| Permissions (`settings.json`) | Never in context | Zero | Hard limits that hold even if a mod fails |

## File map

```text
~/.claude/
├── CLAUDE.md              global instructions
├── settings.json          permissions, the rtk hook, the mods to load
├── skills/                10 knowledge skills
├── agents/reviewer.md
├── mods/warden/           every session: em dashes, safety asks, test integrity, worktrees
├── mods/workflow/         /workflow: phases, the test lock, gates
├── mods/scribe/           every prompt: typos and grammar fixed by Haiku
├── mods/shush/            every prompt: short-answer rules for the reply
└── docs/
```

Everything else in `~/.claude` is Claude Code's runtime data, kept out of git by the whitelist `.gitignore`.

## Enforcement layers

| What must hold | Prose | Enforced by |
| --- | --- | --- |
| No secret is read | CLAUDE.md, Safety | `Read` deny rules for the Read tool; `warden` asks for any shell command that names a secret file, since the deny rules do not bind the shell |
| Nothing is pushed, deployed or discarded without asking | CLAUDE.md, Safety | `warden` asks for the risky commands, force pushes and `rm -rf`; `/safety` lifts the infra, publish and force-push asks for one session. No settings rule backs it: `settings.json` holds no `ask` or `allow` rules, so the rest is on the prose |
| No em dash | CLAUDE.md, Writing | `warden`: refuses edits, notebook cells, commit messages and GitHub text that add one; rewrites replies; flags the ones a shell command added, from the git diff at the end of the turn |
| No weakened test | CLAUDE.md, How to work; `writing-tests-first` | `warden`: a note on each test edit, a follow-up at the end of a turn for shell changes |
| Changes happen in a worktree, not in a repo's main checkout | CLAUDE.md, How to work | `warden`: a person-only dialog before an edit in a main checkout, the same dialog after a shell command that changed files there; `workflow`: `/workflow new` creates a worktree |
| Tests stay apart from the implementation | `writing-tests-first`, the build phase | `workflow`: the test lock |
| A phase stays in its lane | Phase instructions | `workflow`: each phase's write scope, refused on Edit and Write, noted when a shell command changes a file outside it |
| Gates and unlocks are the user's | Phase instructions | `workflow`: `$.ui.ask` dialogs only a person can answer |
| The workflow state is not tampered with | | `Edit` deny on `.git/claude-workflow/**` for the Edit tool, lock fingerprints in the mod's store that refuse a lock changed by anything else |

## Facts measured on this machine

Run in M0 with a probe mod and headless sessions; they shaped the design.

- **Permission rules match the command after `rtk` rewrites it.** A deny on `Bash(git push:*)` let `git push` through, because `rtk` had turned it into `rtk git push`. Every Bash rule is written twice.
- **A session moved into a worktree by `EnterWorktree` refuses `rtk git ...`**: its isolation check cannot tell where a git command run through `rtk` goes. `git` is in rtk's `exclude_commands` (`~/Library/Application Support/rtk/config.toml`), so git commands run plain everywhere.
- **Ask rules prompt the user in auto mode.**
- **A mod's `tool.call` hook sees the command before `rtk`, and `tool.check` after it.** A failing rewritten command still comes back as an error with its exit code.
- **A tool a mod answers itself skips the permission step.** Approvals go through `$.ui.ask`.
- **A mod cannot run a command from inside its own command hook**: it answers first, then runs it from a timer.
- **Rewritten replies are stored and shown rewritten**, with no flash while streaming.
- **A mod's guards see a subagent's tool calls.** Measured on 2026-11-11 with a headless run in a scratch repo: an agent the workflow mod registered (`workflow:build`) ran the red command, locked the slice through `mcp__workflow__lock`, and its Edit to the locked test and Write to the state folder were refused, exactly as in the conversation. The agent ran on the model of its spec (haiku under a sonnet session), and the tools in its `disallowedTools` were absent from its tool list.

## The mods

All four are TypeScript modules for the Claude Code mod API (early access: it may change between releases), loaded from their folders through `CLAUDE_CODE_PLUGIN_DIRS`, and reloaded when their files change.

**warden** applies to every session:

- typography: refuses a Write, Edit or notebook cell that adds an em dash, and a commit message or GitHub body that holds one; rewrites em dashes in Claude's replies to a spaced hyphen before they are stored; at the end of each turn, compares the em dashes in the git diff and the untracked files with the start of the turn, and queues one follow-up for those a shell command added;
- safety asks: a person-only ask for a built-in list of risky commands (discards, infra changes, gh merges and releases, publishes, `dropdb`), matched with or without `rtk`, in any segment of a compound command, in forms prefix rules miss (`git -C dir reset --hard`), through `env`, `bash -c` and `sh -c`, plus force pushes, `rm -rf`, and any shell command that names a secret file (`.env`, `.ssh/`, `.kube/config`, `.aws/credentials`, `.tfstate`, `.pem`, `.key`). The `/safety` command, obeyed only when typed at the prompt, lifts the asks for terraform, tofu, kubectl, helm, docker, publishes and force pushes for the rest of the session, with `warden: safety off` in the status line; typing it again restores them;
- test integrity: a note when an edit adds `.only` or a skip, removes or changes an assertion, or rewrites a snapshot; at the end of a turn, the same check on the git diff catches shell changes made since the turn started and queues one follow-up;
- worktrees: an Edit, Write or notebook edit on a file that is not ignored, in a repo's main checkout (not a linked worktree), opens a person-only dialog: move the work to a worktree (the call is refused and points to `EnterWorktree`) or allow that checkout for the rest of the session. Edits sent together share one dialog. A shell command run while the session is in a main checkout is bracketed by two snapshots (status and content hash): the files it changed bring the same dialog, and the worktree answer adds a note to the command's result. Edits the person makes between commands are never attributed to Claude. A dismissed dialog or a headless run refuses the edit; a failure of the shell check lets the command's result through unchanged. Files outside any repo, ignored files and linked worktrees are never checked.

**workflow** runs project workflows:

- the `/workflow` command, whose bookkeeping (status, lists, closing) costs no model turn;
- `/workflow new` creates a worktree `<repo>-<slug>` on `feat/<slug>` next to the repo, except in a linked worktree that runs no workflow yet, where it asks for the branch;
- the state in `<git common dir>/claude-workflow/`, uncommitted, shared by every worktree, written only by the mod;
- five tools for Claude (`handoff`, `advance`, `lock`, `verify`, `unlock`), registered only in repos with a workflow;
- the test lock: a slice's tests are locked once the mod saw the exact test command fail on the current code, and the slice closes once it saw every check pass on the current code. The mod never runs project code: it watches the commands Claude runs through Bash;
- guards: locked tests refused to Edit and restored after a shell change, each phase limited to the files it may write;
- prompts composed per step: for the conversation, the phase file without its agent sections, the agent to spawn with its model and effort, and the state; for the build agent, the slice with the design sections it names and the checks;
- the model plan: one model and effort per step in the state file, the default plan when it is missing, and the step's default for any entry naming Fable, `max` or an unknown value;
- one agent per step of the workflow's size (`workflow:map`, `setup`, `spec`, `design`, `slice`, `build`, `review`), registered with `$.agent.register` for the workflow on the current branch, each on its plan model and effort, with the `## Agent` section of its phase file (the map's is the `## Map agent` section of `phases/design.md`) and the shared worker rules as its prompt, and `advance`, `handoff`, `unlock` and `AskUserQuestion` withheld. `workflow:review` is limited to `Read`, `Grep`, `Glob` and `Bash`, and its prompt starts with `agents/reviewer.md`, found two folders above the mod, or a short built-in reviewer prompt when that file is missing. The conversation keeps the `## With the user` section: it asks the questions, spawns the agent and relays its report;
- the hand-over after a slice: `mcp__workflow__verify` called from an agent records that agent and answers it "finish your report"; when that agent's `turn.complete` arrives, the mod asks the next-slice dialog in the conversation's context (unless `auto_next`) and submits the next step to the conversation, which reads it once idle.

**scribe** fixes each prompt before Claude reads it:

- a `prompt.submit` hook sends the prompt to Haiku (low effort, 4 s timeout) with orders to fix spelling, grammar and punctuation only, in the prompt's own language, and to leave code, paths, URLs and `@mentions` as written;
- only prompts the person typed (composer or Remote Control) of 3 words or more and under 2,000 characters; slash commands, engine prompts, notifications and long pastes go as typed;
- the correction is dropped when its length moves more than 25% (an answer instead of a fix), when it changes a protected span (fenced or inline code, a URL, a path, an `@mention`), or when it adds an em dash;
- a toast lists what changed (`scribe: teh → the`). The transcript stores the corrected text, so the toast is the only trace of the typed one;
- it fails open: a timeout, an API error or a failed hook sends the prompt as typed. Each prompt costs one Haiku call and about a second.

**shush** keeps chat replies short:

- a `prompt.submit` hook attaches its rules (answer first, no preamble or recap, one idea per sentence, caveats and exact payload kept, full prose for risky or design work) as hidden context beside each prompt, so they sit next to the latest turn instead of only in CLAUDE.md;
- only prompts the person typed (composer or Remote Control); slash commands, engine prompts, notifications and headless runs go without them, and subagents never see them because their prompts come from the Agent tool;
- a prompt ending in a spaced `++` goes without the rules for that one reply, the `++` removed; `/shush off` and `/shush on`, obeyed only from the person, switch them for the session, with `shush: off` in the status line; every new session starts with them on;
- listed before `scribe` in `CLAUDE_CODE_PLUGIN_DIRS`, so its hook runs first and strips the `++` before Haiku could drop it as punctuation;
- no model call: about 300 tokens of context per typed prompt.

The phase files, guides and templates are markdown inside the workflow mod. If the API breaks after an update, they still work by hand (see [editing.md](editing.md)).

## Token budget

What costs on a subscription: every turn resends the whole context; every agent is a cold start; verbose command output (reduced by `rtk`); high effort. Hence:

- one agent run per step, and one `workflow:build` run per slice, so each slice starts from a fresh context while the conversation chains the slices without clearing; the agents' prompts name the exact documents to read, to keep each cold start short;
- the mod's bookkeeping and status line cost nothing;
- nothing workflow-related is loaded in a repo without a workflow;
- spec, design, slice and inspect are reasoning-heavy (Opus, high effort); the build is well specified by then (Sonnet, or Opus at medium effort);
- every subagent gets an explicit model and effort from the `choosing-model-and-effort` skill: Haiku for lookups, Sonnet for well-specified work, Opus for reasoning, `xhigh` only when earned, never Fable or `max`.
