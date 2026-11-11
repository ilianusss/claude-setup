# Slices: accompagny

Keep this format: the workflow mod reads the `## Slice N:` headings, the `- [ ] Done` lines and the `Design:` lines.

Numbers in parentheses point to the acceptance criteria of `design.md`. Each slice updates `docs/workflow.md` (and `docs/architecture.md` when a mechanism changes) for what it adds.

## Slice 1: Walking skeleton: the build runs in a registered agent
- [x] Done

Goal: the riskiest part first. A workflow has a model plan, the mod registers `workflow:build` with the plan's model and effort, the build phase prompt tells the conversation to spawn it for the slice, and a spawned agent's tool calls still go through the test lock and the write scope.
Acceptance criteria:
- AC1: WHEN a state file has no `models` key THE SYSTEM SHALL read the default plan (design: Data model). (AC10)
- AC2: WHEN a plan is rendered and read back THE SYSTEM SHALL return the same steps, models and efforts.
- AC3: IF a plan entry names Fable, `max` or an unknown model or effort THEN THE SYSTEM SHALL use that step's default instead. (AC9, AC11)
- AC4: WHEN a workflow on the current branch is in its build phase THE SYSTEM SHALL register `workflow:build` with the plan's build model and effort, its prompt from the "Agent" section of `phases/build.md`, and `mcp__workflow__advance`, `mcp__workflow__handoff` and `AskUserQuestion` withheld. (AC10)
- AC5: WHEN the build phase prompt is built THE SYSTEM SHALL tell the conversation to spawn `workflow:build` for the current slice and to relay its report.
- AC6: WHEN a spawned `workflow:build` agent writes a locked test file THE SYSTEM SHALL refuse the write, as it does in the conversation (checked on a real headless run in the scratchpad).
- AC7: WHEN a spawned `workflow:build` agent runs the red command and calls `mcp__workflow__lock` THE SYSTEM SHALL lock the slice (checked on the same real run).
Contract: `src/plan.ts` (`Step`, `ModelChoice`, `ModelPlan`, `DEFAULT_PLAN`, `parsePlan`, `renderPlan`), `models` in `Workflow` and the state file, `src/agents.ts` (`buildAgentSpec`, `registerAgents`), `phases/build.md` split into `## With the user` and `## Agent`.
Test levels: unit (engine kit) for the plan, state and agent spec; a real headless run with the worktree's mod in a scratch repo for AC6 and AC7, deleted afterwards.
Sensitive: yes: the lock and the write scope must hold inside a subagent.
Design: Problem and acceptance criteria, Decision, Components, Data model, Security model, Risks
Depends on: none

## Slice 2: The intake phase
- [x] Done

Goal: every workflow starts by asking the user what they want and saving it as the goal.
Acceptance criteria:
- AC1: WHEN a workflow is created THE SYSTEM SHALL put it in the `intake` phase, for both sizes. (AC4)
- AC2: WHEN the intake is approved in a project without `.claude/workflow.json` THE SYSTEM SHALL move to `setup`, and otherwise to the size's first phase (`design` or `spec`).
- AC3: WHEN `mcp__workflow__handoff` is called with a `goal` in the intake phase THE SYSTEM SHALL save it as the Goal section. (AC5)
- AC4: IF `mcp__workflow__handoff` is called with a `goal` outside the intake phase THEN THE SYSTEM SHALL refuse it and save nothing.
- AC5: WHILE a workflow is in a phase whose file lists no `writes` THE SYSTEM SHALL refuse every Edit and Write in the repo.
- AC6: WHEN the intake phase prompt is built THE SYSTEM SHALL ask for the problem, the result wanted, how success will show, the limits and what is out of scope, then a restatement to confirm. (AC4)
Contract: `intake` in `PHASES` and both sequences, `phaseAfter(size, phase, needsSetup)`, `goal` in the handoff schema, `phases/intake.md`, the empty-scope rule in `src/guards.ts`.
Test levels: unit (engine kit).
Sensitive: no.
Design: Problem and acceptance criteria, Components, Data model, API contracts
Depends on: Slice 1

## Slice 3: `/workflow new` runs by itself
- [x] Done

Goal: one `/workflow new` and the user is in the intake, in the worktree, with nothing else to type.
Acceptance criteria:
- AC1: WHEN the user runs `/workflow new <title>` THE SYSTEM SHALL ask the size, then the commits, then whether to start the next slice without asking, and save the last answer as `auto_next`. (AC1)
- AC2: WHEN `/workflow new` created a worktree THE SYSTEM SHALL submit a prompt that asks Claude to call `EnterWorktree` with the worktree's path and then start the intake. (AC2)
- AC3: WHEN `/workflow new` runs in a linked worktree that runs no workflow THE SYSTEM SHALL start the intake there, as today's "here" case does.
- AC4: WHEN the user runs `/workflow new` with no title THE SYSTEM SHALL fill the prompt box with `/workflow new ` and answer with a line asking for a name. (AC3)
- AC5: IF a dialog of `/workflow new` is dismissed THEN THE SYSTEM SHALL create nothing.
Contract: the chaining question in `src/labels.ts`, `start` in `src/commands.ts`, the entry prompt in `src/prompts.ts`.
Test levels: unit (engine kit).
Sensitive: no.
Design: Problem and acceptance criteria, Components, Key flows
Depends on: Slice 2

## Slice 4: Gates continue, slices chain
- [ ] Done

Goal: approving a phase or verifying a slice moves on in the same conversation, unless the user says stop.
Acceptance criteria:
- AC1: WHEN `mcp__workflow__advance` runs THE SYSTEM SHALL offer "Continue", "Stop here" and "Not yet". (AC12)
- AC2: WHEN the user answers "Continue" THE SYSTEM SHALL move the phase and return the next phase's prompt as the tool result. (AC12)
- AC3: WHEN the user answers "Stop here" THE SYSTEM SHALL move the phase and return an instruction to hand off and stop, naming `/workflow continue`.
- AC4: WHEN the user answers "Not yet" or dismisses the dialog THE SYSTEM SHALL keep the phase.
- AC5: WHERE `auto_next` is yes WHEN a slice is verified and another is left THE SYSTEM SHALL tell the conversation to spawn `workflow:build` for the next slice. (AC13)
- AC6: WHERE `auto_next` is no WHEN a slice is verified and another is left THE SYSTEM SHALL ask in a dialog whether to start it, and act on the answer. (AC14)
- AC7: WHEN `/workflow continue` resumes a stopped workflow THE SYSTEM SHALL submit the prompt of its current phase and sub-step. (AC15)
- AC8: IF Claude calls `mcp__workflow__advance` from a step agent THEN THE SYSTEM SHALL refuse it.
Contract: the gate labels in `src/labels.ts`, `advance` and `verifySlice` results, the removal of the `/workflow next` instruction from `src/tools.ts` and `phases/build.md`.
Test levels: unit (engine kit).
Sensitive: yes: the approval gate.
Design: Problem and acceptance criteria, API contracts, Key flows, Security model
Depends on: Slice 1

## Slice 5: Every step runs in its agent
- [ ] Done

Goal: the conversation talks, the agents work, in every phase.
Acceptance criteria:
- AC1: WHEN a workflow runs on the current branch THE SYSTEM SHALL register one agent per step of its size (`workflow:map`, `setup`, `spec`, `design`, `slice`, `build`, `review`), each with its plan model and effort. (AC10)
- AC2: WHEN `workflow:review` is registered THE SYSTEM SHALL limit it to `Read`, `Grep`, `Glob` and `Bash`, with the prompt of `agents/reviewer.md`.
- AC3: WHEN a phase prompt is built THE SYSTEM SHALL hold only the phase's "With the user" section and name the agent to spawn, its model and its effort.
- AC4: WHEN an agent is spawned THE SYSTEM SHALL give it only the phase's "Agent" section and the shared worker rules, ending with the report format.
- AC5: IF a phase file has no "Agent" section THEN THE SYSTEM SHALL keep that phase in the conversation (intake, retro).
Contract: every `phases/*.md` split into `## With the user` and `## Agent`, the shared worker rules in `src/agents.ts`.
Test levels: unit (engine kit).
Sensitive: no.
Design: Components, Data model, API contracts
Depends on: Slice 1, Slice 2

## Slice 6: The model choice and the picker
- [ ] Done

Goal: after the intake, the user keeps the default models, takes Claude's recommendations, or picks per step in a panel.
Acceptance criteria:
- AC1: WHEN the intake's gate is answered "Continue" THE SYSTEM SHALL ask "Use the defaults", "Use Claude's recommendations" or "Choose per step". (AC6)
- AC2: WHEN the user chooses "Choose per step" THE SYSTEM SHALL open a focused panel with one row per step: a model picker, an effort picker, the default, and Claude's recommendation with its reason. (AC7)
- AC3: IF the panel is not placed THEN THE SYSTEM SHALL ask one dialog per step instead. (AC8)
- AC4: THE SYSTEM SHALL never offer Fable or `max`, and SHALL refuse a recommendation of `xhigh` without a reason. (AC9)
- AC5: WHEN the user confirms a plan THE SYSTEM SHALL save it, log the change, and register the agents again.
- AC6: WHEN the user runs `/workflow models` THE SYSTEM SHALL open the same choice for the workflow on this branch.
- AC7: IF `recommendations` are passed outside the intake's gate, or hold an unknown step, model or effort THEN THE SYSTEM SHALL refuse them. (AC11)
Contract: `recommendations` in the advance schema, `src/picker.tsx`, `/workflow models`.
Test levels: unit (engine kit); the panel's render as a pure function if the kit cannot mount it; the panel itself in the final manual run.
Sensitive: yes: untrusted values reach `$.agent.register`.
Design: Components, Data model, API contracts, Security model
Depends on: Slice 4, Slice 5

## Slice 7: Following along
- [ ] Done

Goal: the user always sees where the workflow stands and whether it waits for them.
Acceptance criteria:
- AC1: WHILE a workflow runs on the current branch THE SYSTEM SHALL draw a band above the prompt whose first line lists the workflow's steps in order, the current one bold and coloured, with no done markers. (AC21)
- AC2: WHILE a workflow runs THE SYSTEM SHALL show on the band's second line the sub-step, the model and effort, and "working" or "waiting for you". (AC22)
- AC3: WHEN `mcp__workflow__progress` is called with a step of the current phase THE SYSTEM SHALL show that step's name; IF the step is out of range or the phase is build or inspect THEN THE SYSTEM SHALL refuse it.
- AC4: WHILE a workflow runs THE SYSTEM SHALL show in the status line the step, the slice when building, the model, and working or waiting for you. (AC23)
- AC5: WHEN a phase starts THE SYSTEM SHALL write one dim transcript line naming it.
- AC6: WHEN any phase prompt is built THE SYSTEM SHALL include the "Leading the user" rules: orientation first, every decision through a dialog with a recommended option, a "Next:" line ending every turn. (AC17, AC24)
Contract: `src/banner.tsx`, `step` in the state, the `progress` tool, `src/status.ts`, the shared section in `src/prompts.ts`.
Test levels: unit (engine kit); the band's render as a pure function if the kit cannot mount it.
Sensitive: no.
Design: Components, Data model, API contracts, Observability
Depends on: Slice 5

## Slice 8: The review loop and the project map
- [ ] Done

Goal: the inspect phase fixes what matters on its own, and a feature can start from a map of the project.
Acceptance criteria:
- AC1: WHILE the review reports a blocker or a major finding and fewer than 3 rounds ran THE SYSTEM SHALL have it fixed test-first by `workflow:build`, then reviewed again by `workflow:review`. (AC18)
- AC2: IF a blocker or a major finding remains after 3 rounds THEN THE SYSTEM SHALL stop and ask the user how to go on. (AC19)
- AC3: WHEN no blocker or major finding remains THE SYSTEM SHALL ask which minor findings to fix, in one multiSelect dialog. (AC20)
- AC4: WHEN a review round ends THE SYSTEM SHALL save the round number and log it.
- AC5: WHEN a feature's design phase starts THE SYSTEM SHALL offer to map the project first, and on yes spawn `workflow:map`, which adds a Context section to `design.md`. (AC16)
Contract: `review_round` in the state, `phases/inspect.md` and `phases/design.md`, the map agent's section, a `Context` section in `templates/design.md`.
Test levels: unit (engine kit) for the round counter and the prompts.
Sensitive: no.
Design: Components, Data model, Key flows
Depends on: Slice 5

## Slice 9: The ending
- [ ] Done

Goal: a finished workflow leaves nothing behind but the merged work.
Acceptance criteria:
- AC1: WHEN the inspect gate is approved AND the worktree is clean AND the branch has an upstream with nothing left to push THE SYSTEM SHALL ask whether to remove the worktree and the local branch. (AC25)
- AC2: IF the worktree has an uncommitted change or the branch is not pushed THEN THE SYSTEM SHALL keep both, say which, and ask again at `/workflow done`. (AC26)
- AC3: WHEN the user agrees THE SYSTEM SHALL have the conversation call `ExitWorktree` with `keep`, then remove the worktree without forcing it and delete the branch only when it points at its upstream's commit. (AC27)
- AC4: IF `mcp__workflow__finish` is called while the session's folder is inside the worktree THEN THE SYSTEM SHALL refuse it.
- AC5: IF the checks fail at removal time (a change appeared since the dialog) THEN THE SYSTEM SHALL remove nothing.
Contract: `src/ending.ts`, the `finish` tool, `/workflow done`.
Test levels: unit (engine kit, fake git); the final manual run: the user runs one `/workflow new` in a scratch repo from start to end.
Sensitive: yes: it deletes a worktree and a branch.
Design: API contracts, Key flows, Security model
Depends on: Slice 4
