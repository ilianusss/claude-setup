# The workflow

How to run a piece of work from idea to pull request with `/workflow`. The design behind it is in [architecture.md](architecture.md).

## When to use it

| Size | Example | Path |
| --- | --- | --- |
| Tiny | Typo, config value, dependency bump | Just ask |
| Small | Bug fix, one-slice feature | A plain session: CLAUDE.md triggers `writing-tests-first`, plan mode if there is a design choice |
| Feature | Several slices in an existing project | `/workflow new`, size Feature: intake, design, slice, build, inspect |
| Project | A new product, a large feature | `/workflow new`, size Project: intake, spec, design, slice, build, inspect, retro |

Every workflow starts with the intake, where Claude asks what you want. In a project without `.claude/workflow.json`, the setup phase, which writes it, comes right after the intake.

## Commands

| Command | Does |
| --- | --- |
| `/workflow` | The workflows of this repo: phase, slice, status, age, which one is on the current branch |
| `/workflow all` | Open workflows in every repo on this machine |
| `/workflow new <title>` | Asks the size and whether to commit after each slice, then creates a worktree next to the repo on `feat/<slug>`, where you start a session and run `/workflow continue`. In a linked worktree that runs no workflow yet, it asks for the branch instead and starts the first phase there |
| `/workflow continue [slug]` | Resumes the workflow of the current branch, or the one named; offers to switch branch; after 14 days away or when the branch is behind, starts with a drift check |
| `/workflow next` | Clears the context, then continues: the one command between slices |
| `/workflow pause` | Claude writes the handoff, then stops |
| `/workflow unlock <file> <reason>` | You unlock a locked test yourself |
| `/workflow done <slug>` | Closes it; a project is offered its retro first |
| `/workflow abandon <slug> <reason>` | Closes it with the reason |
| `/workflow adopt` | Sets up a project without `workflow.json`, and rebuilds workflows from spec folders whose state was lost (a fresh clone) |

The status line shows the workflow on the current branch: `workflow login: build 2/5, tests locked`.

## The phases

| Phase | Claude writes | You approve |
| --- | --- | --- |
| intake | No file: it asks the problem, the result you want, how success will show, the limits and what is out of scope, restates it, and saves the goal you confirm in the state | The restated goal |
| setup | `.claude/workflow.json`, the project CLAUDE.md and settings, after running each command once | The three files |
| spec | `docs/specs/<slug>/spec.md`: problem, users, scope, acceptance criteria in EARS, abuse cases | The spec, with no open question left |
| design | `design.md`: drivers, two or three options and the decision, components, data, contracts, security, tests, rollout, risks; ADRs | The option and the design |
| slice | `slices.md`: a walking skeleton first, then one behaviour per slice | The slices and their criteria |
| build | Code and tests, one slice per session, in the `workflow:build` agent | Nothing: each slice closes when the mod has seen it green |
| inspect | Review findings, the fixes you pick, a pull request draft | The push and the pull request |
| retro | Small changes to CLAUDE.md and skills, from what repeated | Each change |

A phase can only write its own files: during the spec, a write to source code is refused, and during the intake, which lists none, every write in the repo is. The goal is set through `mcp__workflow__handoff` during the intake only. Claude moves a phase on with a dialog you answer (Approve or Not yet); auto mode cannot answer it.

## A slice, step by step

The conversation spawns the `workflow:build` agent for the slice and relays its report; the agent does steps 1 to 6. The mod registers that agent whenever the workflow on the current branch is in its build phase (at session start, after a phase is approved, after `/workflow continue` and after a verified slice), with the slice, its design sections and the checks in its prompt. It cannot call `mcp__workflow__advance`, `mcp__workflow__handoff` or `AskUserQuestion`: it reports what needs you, and the conversation asks. The test lock and the write scope hold for its tool calls as they do for the conversation's.

1. Contract: types, schemas, stubs that throw.
2. Tests for every acceptance criterion.
3. Red: Claude asks the mod to lock; the mod answers with the exact command to run, and locks only after it saw that command fail on the current code.
4. Green: the tests are frozen. Claude implements, then runs the slice tests, lint, typecheck and the full suite exactly as the mod listed them.
5. The real thing: the app, the route, the screen.
6. Verify: the mod closes the slice only if it saw every check pass on the current code. The agent ticks the slice and commits if you said so; the conversation writes the handoff.
7. Claude stops. You type `/workflow next` for the next slice, in a fresh context.

**When a test is wrong**, Claude stops and explains with evidence, then asks to unlock it; you answer in a dialog. You can also unlock it yourself with `/workflow unlock <file> <reason>`. Every unlock is logged and reviewed in the retro.

**`auto_next`**: with `auto_next: yes` in the state file, the next slice starts by itself after a verified one. It is off by default. Claude cannot change it; you can, by editing `.git/claude-workflow/<slug>.md` by hand.

## Several workflows at once

- One workflow, one branch, one worktree. `/workflow new` never works in the main checkout, which may hold your own changes; start a session in the worktree it creates.
- The state lives in the repo's `.git`, shared by every worktree, so `/workflow` lists everything from anywhere.
- ADRs are named by date, so two branches never collide on a number.

## Resuming after a long time

`/workflow continue` hands Claude the facts: how long it has been, how far the branch is behind, the commits on the default branch in the folders the design touches, and lockfile changes. Claude runs the checks once and summarizes in ten lines what it means for the next step, and offers a rebase.

A fresh clone has no state, but the committed documents survive: `/workflow adopt` rebuilds the state from them.

## Where things are

| What | Where |
| --- | --- |
| The state of a workflow, its model plan included | `.git/claude-workflow/<slug>.md`, readable, never committed |
| The test lock | `.git/claude-workflow/locks/<slug>.json` |
| The documents | `docs/specs/<slug>/` and `docs/adr/`, committed |
| The project config | `.claude/workflow.json`, committed |

## Model and effort

Each workflow has a model plan, the `models` line of its state file: one model and effort per step. A state file without it gets the default plan:

| Step | Model | Effort |
| --- | --- | --- |
| map | sonnet | medium |
| setup | sonnet | medium |
| spec | opus | high |
| design | opus | high |
| slice | opus | high |
| build | opus | medium |
| review | opus | high |

The models are `haiku`, `sonnet` and `opus`, the efforts `low`, `medium`, `high` and `xhigh`. An entry naming anything else (Fable, `max`, a typo) reads as that step's default. Today only the build runs in an agent, `workflow:build`, on the plan's build model and effort; the other phases run in the conversation, on its model: Opus at high effort for spec, design, slice and inspect, xhigh only for a hard design call.
