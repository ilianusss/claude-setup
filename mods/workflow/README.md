# workflow

A Claude Code mod that runs a project from idea to pull request with one command, `/workflow`, and keeps a slice's tests locked between writing them and making them pass.

## Role in the system

It is one of the two mods of the `~/.claude` setup, next to `warden`, loaded through `CLAUDE_CODE_PLUGIN_DIRS` in its `settings.json`. The knowledge it relies on (`writing-tests-first`, `writing-clean-code`, `writing-secure-code`, `following-git-conventions`) and the `reviewer` agent live in that setup; without them the phases still run, with less guidance.

## Prerequisites

- Claude Code 2.1.308 or later. Mods use an early-access API that may change between releases.
- A git repository: the state lives in its `.git`.

## Getting started

In a repo, type `/workflow new <title>`. Every workflow starts with an intake, where you describe what you want in your own words and Claude asks only about what your description leaves out; a project without `.claude/workflow.json` then goes through the setup phase, which writes it.

## Commands

| Command | Does |
| --- | --- |
| `/workflow` | The workflows of this repo |
| `/workflow all` | Open workflows in every repo |
| `/workflow new <title>` | Start one: size, prompting level (every decision or only the major ones), technical decisions (asked or not), commits, the documents to keep at the end, slice chaining (not asked when technical decisions are off: the slices chain) and branch are asked one dialog each, then Claude moves into the new worktree and starts the intake. Without a title, the prompt box gets `/workflow new ` |
| `/workflow continue [slug]` | Resume one where it stopped, lanes left building included, with a drift check after a long break |
| `/workflow next` | Clear the context and continue, when resuming by hand: slices go on by themselves once a build agent ends, gates do not (a gate puts `/workflow continue` in your prompt box) |
| `/workflow pause` | Write the handoff and stop |
| `/workflow models` | Choose each step's model and effort in the Models panel (one dialog per step where the panel cannot be shown) |
| `/workflow unlock <file> <reason>` | Unlock a locked test yourself |
| `/workflow delete [slug]` | Delete one, done or not: removes its lanes that are clean and merged, offers to remove its worktree and local branch when they still exist, then deletes its state, test locks and run logs |
| `/workflow adopt` | Set up a project, or rebuild workflows from their committed specs (a folder without documents starts at the intake) |

Your conversation talks to you and an agent the mod registers does each step's work (`workflow:map`, `setup`, `spec`, `design`, `slice`, `build`, the read-only `review`); the intake and the retro stay in the conversation. After the intake you choose the model and effort the agents run on: the defaults below, Claude's recommendations for this workflow, or a choice per step in the Models panel, which opens on Claude's recommendations. The question lists the defaults for the steps this workflow runs and what Claude's recommendations change, and the panel shows each step's choice beside its default, with the steps that differ in colour; `/workflow models` changes them later, from the current plan. Two settings of the workflow decide what you are asked: the prompting level (every decision, or only the major ones, as `guides/decision-guide.md` defines them) and technical decisions (asked or not); a decision not asked is taken with Claude's recommended option and recorded in the spec or the design. With technical decisions off, the gates of the technical phases (setup, design, slice, inspect), the model choice, the next-slice question, the minor fixes and the map offer go on without asking; the unlock of a test, the documents to keep, the commit, push and pull request, the worktree removal, the branch and the delete confirmation are always asked. Each gate is a dialog the mod builds from the lists Claude passes to `mcp__workflow__advance` (`produced`, `decisions`, `risks`, `open`), so you read short lines instead of a paragraph; at the intake the gate shows the five points of your description (`problem`, `result`, `success`, `limits`, `outOfScope`), which you confirm or correct there, and they become the workflow's goal. You answer Continue (the mod puts `/workflow continue` in your prompt box and Claude ends its turn telling you to press Enter: the next phase never starts by itself), Stop here (Claude hands off, pauses the workflow and stops) or Not yet; at the intake's gate both Continue and Stop here are followed by the model choice, and after the Models panel the mod puts `/workflow continue` in your prompt box the same way. When a `workflow:build` agent ends after a verified slice, the mod asks you whether to go on, unless slice chaining is on, and hands the conversation the next step once it is idle. When the workflow commits, the build runs up to 3 slices in parallel, each ready slice (its `Depends on:` slices done) in its own git worktree and branch: the mod sends each agent into its lane, merges the lane into the workflow branch once the slice is verified and its agent's run has ended, ticks the slice, and has the conversation run the checks on the merged code; a conflict aborts the merge and an agent spawned to resolve it goes back into the lane. An optional `worktreeSetup` command in `.claude/workflow.json` installs a lane's dependencies first. A feature's design opens by offering to map the project into a Context section of `design.md`. The inspect phase reviews and fixes in rounds until no blocker or major finding is left, at most 3 before it asks you, then lets you pick the minor fixes; `workflow:build` fixes test-first without the test lock, and the mod counts the rounds in the state and on the band. The last phase (inspect for a feature, the retro for a project) ends with the closing: Claude drafts the pull request, removes the documents you chose not to keep, and asks whether to commit, push and open the pull request. When the workflow closes with its worktree clean and its branch pushed, the mod offers to remove both, naming the ignored files that go with the worktree; Claude leaves the worktree with `ExitWorktree` first, and the removal never forces and deletes the branch only when it matches its upstream. A one-line band in a rounded border follows along, under the prompt on the terminal, keeping what other mods draw there, and above it on the desktop: on the left the current phase and sub-step, the model and effort doing it, and "working" or "waiting for you"; on the right, after a divider, the steps of this workflow, the finished ones with a check in the theme's success colour and the current one with a dot, bold in its suggestion colour; the status line says the same in one line (`workflow login: build 2/5, opus medium, waiting for you`). The phases, the band, the slice cycle, the review loop, the closing, the ending and the test lock are described in [docs/workflow.md](https://github.com/ilianusss/.claude/blob/main/docs/workflow.md) of the setup repo.

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
src/          commands, tools, guards, state, the test lock, the review rounds, the Models panel, the band, the ending
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
