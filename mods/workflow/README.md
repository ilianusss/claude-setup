# workflow

A Claude Code mod that runs a project from idea to pull request with one command, `/workflow`, and keeps a slice's tests locked between writing them and making them pass.

## Role in the system

It is one of the two mods of the `~/.claude` setup, next to `warden`, loaded through `CLAUDE_CODE_PLUGIN_DIRS` in its `settings.json`. The knowledge it relies on (`writing-tests-first`, `writing-clean-code`, `writing-secure-code`, `following-git-conventions`) and the `reviewer` agent live in that setup; without them the phases still run, with less guidance.

## Prerequisites

- Claude Code 2.1.308 or later. Mods use an early-access API that may change between releases.
- A git repository: the state lives in its `.git`.

## Getting started

In a repo, type `/workflow new <title>`. Every workflow starts with an intake, where Claude asks what you want; a project without `.claude/workflow.json` then goes through the setup phase, which writes it.

## Commands

| Command | Does |
| --- | --- |
| `/workflow` | The workflows of this repo |
| `/workflow all` | Open workflows in every repo |
| `/workflow new <title>` | Start one: size, commits, slice chaining and branch are asked in a dialog, then Claude moves into the new worktree and starts the intake. Without a title, the prompt box gets `/workflow new ` |
| `/workflow continue [slug]` | Resume one where it stopped, with a drift check after a long break |
| `/workflow next` | Clear the context and continue, when resuming by hand: gates and slices go on by themselves |
| `/workflow pause` | Write the handoff and stop |
| `/workflow models` | Choose each step's model and effort in the Models panel (one dialog per step where the panel cannot be shown) |
| `/workflow unlock <file> <reason>` | Unlock a locked test yourself |
| `/workflow done <slug>`, `/workflow abandon <slug> <reason>` | Close one |
| `/workflow adopt` | Set up a project, or rebuild workflows from their committed specs (a folder without documents starts at the intake) |

Your conversation talks to you and an agent the mod registers does each step's work (`workflow:map`, `setup`, `spec`, `design`, `slice`, `build`, the read-only `review`); the intake and the retro stay in the conversation. After the intake you choose the model and effort the agents run on: the defaults below, Claude's recommendations for this workflow, or a choice per step in the Models panel, which opens on Claude's recommendations; `/workflow models` changes them later, from the current plan. At each gate you answer Continue (Claude goes straight on), Stop here (Claude hands off, pauses the workflow and stops) or Not yet. When a `workflow:build` agent ends after a verified slice, the mod asks you whether to go on, unless slice chaining is on, and hands the conversation the next step. A feature's design opens by offering to map the project into a Context section of `design.md`. The inspect phase reviews and fixes in rounds until no blocker or major finding is left, at most 3 before it asks you, then lets you pick the minor fixes; `workflow:build` fixes test-first without the test lock, and the mod counts the rounds in the state and on the band. A band above the prompt follows along: the steps of this workflow with the current one in colour, then the current sub-step, the model and effort doing it, and "working" or "waiting for you"; the status line says the same in one line (`workflow login: build 2/5, opus medium, waiting for you`). The phases, the band, the slice cycle, the review loop and the test lock are described in [docs/workflow.md](https://github.com/ilianusss/.claude/blob/main/docs/workflow.md) of the setup repo.

Default plan:

| Step | Model | Effort |
| --- | --- | --- |
| map, setup | sonnet | medium |
| spec, design, slice, review | opus | high |
| build | opus | medium |

Fable and `max` effort are never offered, and Claude's recommendation of `xhigh` needs a reason.

## Project structure

```text
hooks/        the module Claude Code loads
src/          commands, tools, guards, state, the test lock, the review rounds, the Models panel, the band
phases/       each phase: what the conversation does with you, what its agent does, the files it may write
guides/       question banks, the decision guide, EARS, the drift check
templates/    spec, design, slices, ADR, project CLAUDE.md, workflow.json
tests/        claude plugin test suites, against a fake git and file system
```

## Documentation

- [docs/architecture.md](https://github.com/ilianusss/.claude/blob/main/docs/architecture.md) of the setup repo: how the mod enforces the lock and the gates, and the facts measured that shaped it.
- [docs/decisions.md](https://github.com/ilianusss/.claude/blob/main/docs/decisions.md): why it is built this way.

## Development

```sh
claude --plugin-dir .      # a session with the mod loaded, reloaded on save
claude plugin validate .   # what the engine would refuse
claude plugin test .       # the test suites
```

The engine writes the API types into `.claude-plugin/types/` each time it loads the mod; grep them rather than trusting memory, since the API moves between releases. A hook must be a function literal, at most one hook per event without a matcher, and `$` is never put in an object or handed to a callback: the engine refuses to load the module otherwise.
