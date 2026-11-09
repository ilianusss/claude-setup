# The workflow

How to run a piece of work from idea to pull request with `/workflow`. The design behind it is in [architecture.md](architecture.md).

## When to use it

| Size | Example | Path |
| --- | --- | --- |
| Tiny | Typo, config value, dependency bump | Just ask |
| Small | Bug fix, one-slice feature | A plain session: CLAUDE.md triggers `writing-tests-first`, plan mode if there is a design choice |
| Feature | Several slices in an existing project | `/workflow new`, size Feature: design, slice, build, inspect |
| Project | A new product, a large feature | `/workflow new`, size Project: spec, design, slice, build, inspect, retro |

A project without `.claude/workflow.json` starts with the setup phase, which writes it.

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
| setup | `.claude/workflow.json`, the project CLAUDE.md and settings, after running each command once | The three files |
| spec | `docs/specs/<slug>/spec.md`: problem, users, scope, acceptance criteria in EARS, abuse cases | The spec, with no open question left |
| design | `design.md`: drivers, two or three options and the decision, components, data, contracts, security, tests, rollout, risks; ADRs | The option and the design |
| slice | `slices.md`: a walking skeleton first, then one behaviour per slice | The slices and their criteria |
| build | Code and tests, one slice per session | Nothing: each slice closes when the mod has seen it green |
| inspect | Review findings, the fixes you pick, a pull request draft | The push and the pull request |
| retro | Small changes to CLAUDE.md and skills, from what repeated | Each change |

A phase can only write its own files: during the spec, a write to source code is refused. Claude moves a phase on with a dialog you answer (Approve or Not yet); auto mode cannot answer it.

## A slice, step by step

1. Contract: types, schemas, stubs that throw.
2. Tests for every acceptance criterion.
3. Red: Claude asks the mod to lock; the mod answers with the exact command to run, and locks only after it saw that command fail on the current code.
4. Green: the tests are frozen. Claude implements, then runs the slice tests, lint, typecheck and the full suite exactly as the mod listed them.
5. The real thing: the app, the route, the screen.
6. Verify: the mod closes the slice only if it saw every check pass on the current code. Claude ticks the slice, commits if you said so, and writes the handoff.
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
| The state of a workflow | `.git/claude-workflow/<slug>.md`, readable, never committed |
| The test lock | `.git/claude-workflow/locks/<slug>.json` |
| The documents | `docs/specs/<slug>/` and `docs/adr/`, committed |
| The project config | `.claude/workflow.json`, committed |

## Model and effort

Spec, design, slice and inspect are short and reasoning-heavy: Opus at high effort, xhigh only for a hard design call. The build is well specified by then: Sonnet, or Opus at medium effort. Switch with `/model` before `/workflow next`.
