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
| `/workflow new <title>` | Asks the size, whether to commit after each slice and whether to start the next slice without asking (`auto_next`), then creates a worktree next to the repo on `feat/<slug>` and has Claude move the session into it (the `EnterWorktree` tool) and start the intake. If Claude cannot enter it, start a session there and run `/workflow continue <slug>`. In a linked worktree that runs no workflow yet, it asks for the branch instead and starts the intake there. Without a title, it puts `/workflow new ` in the prompt box for you to name it |
| `/workflow continue [slug]` | Resumes the workflow of the current branch, or the one named, with the prompt of the phase it stopped in (after a "Stop here", for one), which names the saved sub-step to resume at; offers to switch branch; after 14 days away or when the branch is behind, starts with a drift check |
| `/workflow next` | Clears the context, then continues: only needed to resume by hand in a fresh context, since gates and slices go on by themselves |
| `/workflow pause` | Claude writes the handoff, then stops |
| `/workflow models` | Opens the Models panel for the workflow on this branch, its current plan preselected, to change each step's model and effort at any time |
| `/workflow unlock <file> <reason>` | You unlock a locked test yourself |
| `/workflow done <slug>` | Closes it; a project is offered its retro first. Then offers to remove the worktree and the local branch once they are clean and pushed (see The ending) |
| `/workflow abandon <slug> <reason>` | Closes it with the reason |
| `/workflow adopt` | Sets up a project without `workflow.json`, and rebuilds workflows from spec folders whose state was lost (a fresh clone). The phase follows the documents there; a folder without `spec.md`, `design.md` or `slices.md` starts again at the intake |

## Following along

While a workflow runs on the current branch, a band above the prompt shows where it stands, on two lines:

```text
intake  design  slice  build 2/5  inspect
build 2/5: tests locked · opus medium · waiting for you
```

- The first line lists the steps of this workflow in order: intake, setup while the project has no `.claude/workflow.json` (it leaves the line once written), spec and retro for a project. The current step is bold and coloured, the others dim, with no done markers. Build carries the slice count.
- The second line is the current sub-step, the model and effort of whoever does it (the step's agent from the plan, or "conversation" for the intake and the retro), and "working" or "waiting for you". In a narrow terminal the band drops the steps before the current one, then shortens the sub-step, then the model: "waiting for you" always shows.
- The sub-steps are the numbered bold steps of the phase file's "With the user" section (`1. **Read**` gives "read"). Claude calls `mcp__workflow__progress { step }` as it starts each one; the mod saves it as `step` in the state, so a resumed workflow shows it and its prompt says to resume at that step, and clears it when the phase changes. It is refused out of range, from a step agent, and in build and inspect, whose sub-step the mod names itself: "writing tests", "tests locked", then "slice N verified" until the build agent's run ends; "review" in inspect, then "review round N/3" once a review round has ended.
- "Working" runs from a submitted prompt to the end of the conversation's turn; "waiting for you" after it, and while one of the mod's dialogs or the Models panel is open. A step agent's turns do not change it.

The status line carries the same data: `workflow login: build 2/5, opus medium, waiting for you`. A dim transcript line marks the start of each phase with what it produces.

Every phase prompt also carries the "Leading the user" rules: Claude opens a phase by saying where you are (step k of n), what it produces and what you will be asked; asks every decision that is yours in a dialog, its recommended option first; and ends every turn with a "Next:" line saying what happens next and whether you have to act.

## The phases

| Phase | Claude writes | You approve |
| --- | --- | --- |
| intake | No file: it asks the problem, the result you want, how success will show, the limits and what is out of scope, restates it, and saves the goal you confirm in the state | The restated goal |
| setup | `.claude/workflow.json`, the project CLAUDE.md and settings, after running each command once | The three files |
| spec | `docs/specs/<slug>/spec.md`: problem, users, scope, acceptance criteria in EARS, abuse cases | The spec, with no open question left |
| design | `design.md`: for a feature, a Context section first when you accept the project map; drivers, two or three options and the decision, components, data, contracts, security, tests, rollout, risks; ADRs | The option and the design |
| slice | `slices.md`: a walking skeleton first, then one behaviour per slice | The slices and their criteria |
| build | Code and tests, one `workflow:build` agent run per slice | Nothing: each slice closes when the mod has seen it green |
| inspect | Review rounds until no blocker or major is left, the minor fixes you pick, a pull request draft | What to do when 3 rounds were not enough, the minors to fix, the push and the pull request |
| retro | Small changes to CLAUDE.md and skills, from what repeated | Each change |

A phase can only write its own files: during the spec, a write to source code is refused, and during the intake, which lists none, every write in the repo is. The goal is set through `mcp__workflow__handoff` during the intake only. Claude moves a phase on with a dialog you answer; auto mode cannot answer it. "Continue" moves the phase, makes the workflow active again if it was paused, and the next phase starts in the same conversation: Claude ends its turn and the mod sends the next phase's prompt in a message of its own, because the step agents it registers again at the gate can only be spawned from the next turn on; "Stop here" moves it, pauses the workflow (`/workflow` lists it as paused) and Claude writes the handoff and stops, for `/workflow continue <slug>` later; "Not yet", or closing the dialog, keeps the phase. Only the conversation can call `mcp__workflow__advance`, `mcp__workflow__handoff` and `mcp__workflow__unlock`: the mod refuses them from a step agent.

## Who does what

Your conversation talks to you; agents do the work. Each phase file has a "With the user" section, which is the conversation's prompt: the questions it asks you in dialogs, which agent to spawn with its model and effort, relaying the agent's report, and the gate. Its "Agent" section is the worker's prompt. The mod registers one agent per step of the workflow's size, each on its plan model and effort, at session start, at `/workflow new`, after a gate, after a plan change, after `/workflow continue` and after a verified slice. An agent registered in a turn is spawned as registered only from the next turn on, so whatever registers them again hands the next phase or slice to a turn of its own: the gate's and verify's answers tell Claude to end its turn, and the mod submits the next prompt itself. Starting the next slice, from the dialog or by chaining, makes a paused workflow active again:

| Agent | Does | Phase |
| --- | --- | --- |
| `workflow:map` | Maps the project into a Context section of `design.md` (features only) | design |
| `workflow:setup` | Reads the project, proves its commands, writes the three files (only without `.claude/workflow.json`) | setup |
| `workflow:spec` | Writes `spec.md` from your answers (projects only) | spec |
| `workflow:design` | Researches, proposes the options, writes `design.md` and the ADRs | design |
| `workflow:slice` | Writes `slices.md` | slice |
| `workflow:build` | Builds one slice; in inspect, fixes review findings | build, inspect |
| `workflow:review` | Reviews the branch, read-only (`Read`, `Grep`, `Glob`, `Bash`), with the prompt of `agents/reviewer.md` | inspect |

An agent gets only its "Agent" section and the shared worker rules, which end with its report format: what it did, the files, the checks, and its open questions. It cannot call `mcp__workflow__advance`, `mcp__workflow__handoff`, `mcp__workflow__unlock` or `AskUserQuestion`, and the mod refuses `mcp__workflow__progress` and `mcp__workflow__finish` from it: in the spec and design phases the conversation asks you the questions and the agents research, draft and return what they could not settle. The intake and the retro have no agent and run in the conversation.

## A slice, step by step

The conversation spawns the `workflow:build` agent for the slice and relays its report; the agent does steps 1 to 6. The conversation's prompt names the slice and the agent; the agent's holds the slice, its design sections and the checks. It reports what needs you, a test it believes wrong included, and the conversation asks. The test lock and the write scope hold for its tool calls as they do for the conversation's.

1. Contract: types, schemas, stubs that throw.
2. Tests for every acceptance criterion.
3. Red: Claude asks the mod to lock; the mod answers with the exact command to run, and locks only after it saw that command fail on the current code.
4. Green: the tests are frozen. Claude implements, then runs the slice tests, lint, typecheck and the full suite exactly as the mod listed them.
5. The real thing: the app, the route, the screen.
6. Verify: the mod closes the slice only if it saw every check pass on the current code. The agent ticks the slice, commits if you said so, and finishes its report.
7. When the agent's run ends, the mod hands over: it asks you whether to go on (unless `auto_next` is on), then sends the conversation the next step in a message of its own: spawn `workflow:build` for the next slice, or write the handoff and stop, or, after the last slice, the inspect phase.

**When a test is wrong**, Claude stops and explains with evidence, then asks to unlock it; you answer in a dialog. You can also unlock it yourself with `/workflow unlock <file> <reason>`. Every unlock is logged and reviewed in the retro.

**`auto_next`**: with `auto_next: yes` in the state file, the mod tells the conversation to spawn `workflow:build` for the next slice without asking. With `no`, the mod asks you in a dialog after each verified slice whether to start the next one now or stop here; stopping pauses the workflow. `/workflow new` asks for it. Claude cannot change it; you can, by editing `.git/claude-workflow/<slug>.md` by hand.

## The project map

A feature has no spec, so its design phase opens by offering to map the project first, Yes recommended. On yes, the conversation spawns `workflow:map`, which reads only and writes the `## Context` section at the top of `design.md`: the structure, the conventions, the code the change touches and what it may affect, with file paths. `workflow:design` starts its research from it. A project starts from its spec and is not offered the map.

## The review loop

The inspect phase reviews the branch in rounds:

1. The conversation spawns `workflow:review` on the whole branch; the first round also runs the `code-review` skill, and `/security-review` when the change calls for it. It merges the findings by severity.
2. While a blocker or a major is left and fewer than 3 rounds have ended, it spawns `workflow:build` to fix them, then reviews again.
3. After 3 rounds with a blocker or a major left, it stops and asks you how to go on: fix them by hand, accept them as known issues, or go back to the design.
4. Once none is left, it asks you in one multi-select dialog which minor findings to fix; the others go in the pull request body as known issues.

The mod counts the rounds: each time a `workflow:review` run ends with its report in inspect (an interrupted run does not count), it saves `review_round` in the state, logs "review round N" and writes a dim transcript line, and the band shows "inspect: review round N/3". The inspect prompt tells the conversation how many rounds have ended, so the count survives a pause. The count resets when the workflow leaves inspect.

**Fixes in inspect run without the test lock.** `mcp__workflow__lock` and `mcp__workflow__verify` belong to the build phase and stay refused in inspect. In this phase the `workflow:build` agent's prompt replaces the slice with "Fixing review findings": for each finding, a failing test first (a bug found in review gets its failing test before its fix), seen to fail for the reason the finding names, then the smallest fix; then lint, typecheck and the full suite exactly as written, each result in its report. The next review round checks the fixes, tests included.

## The ending

When the workflow closes (a feature's inspect gate, a project's retro gate, or `/workflow done <slug>`), the mod checks the worktree it created:

- no uncommitted change, untracked files included (`git status --porcelain`);
- the branch has an upstream and nothing left to push (`git rev-list @{u}..HEAD` is empty).

When both hold, it asks whether to remove the worktree and the local branch. The dialog names both, and the ignored files the removal deletes with the worktree, such as `.env` or `node_modules/` (the top-level entries of `git status --ignored`, five at most, then a count). When a check fails, it keeps both, says which check failed, and `/workflow done <slug>` asks again once that is fixed. A workflow that ran in the main checkout is offered nothing, and a default branch is never deleted.

On "Remove them":

- From a session in the main checkout (`/workflow done <slug>` there), the mod removes them directly.
- Inside the worktree the session entered with `EnterWorktree`, Claude leaves it with `ExitWorktree` (`action: "keep"`), then calls `mcp__workflow__finish`. The tool is refused while the session is still inside the worktree, from a step agent, and without your yes in this session.
- In a session that started inside the worktree, which `ExitWorktree` cannot leave, you are told to run `/workflow done <slug>` from a session in the main checkout.

The removal runs the checks again first and removes nothing if a change appeared since the dialog. It runs `git worktree remove <path>` from the main checkout, without `--force`, then `git branch -D <branch>` only when the branch points at its upstream's commit; otherwise the branch stays and the answer says why. The state logs "worktree removed" and stays in the shared `.git`, so `/workflow` still lists the workflow as done.

## Several workflows at once

- One workflow, one branch, one worktree. `/workflow new` never works in the main checkout, which may hold your own changes; Claude moves the session into the worktree it creates.
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

The models are `haiku`, `sonnet` and `opus`, the efforts `low`, `medium`, `high` and `xhigh`. An entry naming anything else (Fable, `max`, a typo) reads as that step's default. Each step's agent runs on its plan model and effort, named in the conversation's prompt; the intake and the retro run in the conversation, on its model.

Only you set the plan. Before the intake's gate, Claude follows `choosing-model-and-effort` and passes its recommendations to `mcp__workflow__advance` as `recommendations`: `{ step, model, effort, reason }` for each step of this workflow where it would differ from the default. The mod refuses the whole list, naming the entry, and nothing moves, for a step this workflow does not run, Fable, `max`, an unknown value, `xhigh` without a reason, or any recommendation outside the intake's gate. After "Continue" or "Stop here" it asks "Which models should the steps use?" (on "Stop here" the workflow pauses once the plan is chosen):

- "Use the defaults" saves the default plan.
- "Use Claude's recommendations" saves the defaults with the recommendations over them (offered only when Claude gave some).
- "Choose per step" opens the Models panel, a focused dialog with one row per step of this workflow in pipeline order: a model and an effort picker on Claude's recommendations (the defaults where it gave none), the recommended values marked "(recommended)", "changed from <default>" on a row that differs from the default, and Claude's recommendation with its reason in a dim line beneath. Picking `xhigh` adds a one-line warning. Tab moves between the pickers and buttons, Enter picks, `u` or "Use these" saves, `r` or "Reset to recommended" puts the recommended values back, Esc or "Cancel" keeps the plan as it was. Fable and `max` are never offered. The conversation waits while the panel is open; the mod sends it the next phase's prompt once you confirm or cancel.
- Where the panel cannot be shown (opened from a tool on a terminal under 144 columns, say), the same choice runs as one dialog per step: the recommended value marked "(Recommended)", the default when different, one cheaper and one stronger option, and "Other" for a typed `model effort` such as `sonnet high`, asked again until it names an allowed pair. Closing a dialog keeps the plan.
- Closing the question keeps the plan.

A confirmed plan that changes something is saved in the state, logged as `models changed: <step> <model> <effort>, ...`, and the step agents are registered again on it. `/workflow models` opens the same panel later, with the recommendations Claude gave earlier in the same session.
