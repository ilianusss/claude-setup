---
writes: ["**"]
---
# The build phase

Goal: every slice, built test-first, with its tests locked between red and green. One slice per agent run. The work runs in `workflow:build` agents, on the build model and effort of this workflow's plan; you stay with the user.

When this workflow commits, its slices build in parallel, at most 3 at a time, each in its own git worktree and branch (a lane) made from the workflow branch; the mod merges each lane into the workflow branch once its slice is verified and its agent's run has ended. When it does not commit, one slice builds at a time in the workflow's worktree.

## With the user

The mod follows this phase's steps itself and shows them on the workflow band: do not call `mcp__workflow__progress` in it.

1. **Spawn.** Spawn `workflow:build` exactly as the build agent section below says, with the exact prompts it lists: one slice in the foreground when this workflow does not commit; every ready slice it lists, all in one message, in the background, when it commits. Do not write the tests or the code yourself. After spawning lanes, end your turn telling the user that the slices build in parallel and that the mod reports each as it ends: nothing is needed from them unless a question comes up.
2. **Relay.** Give the user each report as it comes: what the agent built, each check and its result, whether `mcp__workflow__verify` closed the slice, and its open questions.
3. **Questions.** When an agent stopped on a test it believes wrong, put its evidence to the user and call `mcp__workflow__unlock` with the reason: the user decides, and a test a lane locked is unlocked from here too. When it stopped on another question, ask the user, then spawn it again with the same prompt and the answer: a lane's agent goes back into its lane.
4. **Close.** Once verify passed in the workflow's worktree, check that the agent ticked the slice in `slices.md` (and committed, if this workflow commits). A lane's slice is ticked and committed by the mod when it merges the lane: nothing to check.
5. **Next.** Once an agent's run ends after a verified slice, the mod sends you the next step in a message of its own, once you are idle: the merge (or why it did not happen), the checks to run in the workflow's worktree after a merge and the integration fix when one fails, then the slices to spawn, the merge to resolve, the lanes still building, the handoff to write and stop, or the inspect phase it carries. It asks the user first whether to go on when this workflow does not chain slices. End your turn after each relay and wait for that message.

## Agent

**In a lane.** When your prompt has a "Your lane" section, you work in a lane: run the setup command it names first, in your folder, when it names one; write only in your folder, never in the workflow's worktree or another lane (the mod refuses it); and when the lane exists from an earlier run, read what is there first and go on from where it stopped. When it has a "Resolving the merge" section, do that instead of steps 1 to 7, then step 8.

Follow the steps in order. The mod enforces steps 4, 5 and 8.

1. **Load.** Read the slice and its design sections in your prompt, then the code the slice touches. Nothing else. Check each acceptance criterion against the design and the code: if one contradicts them (a wrong value, a case the design rules out), stop and report it before writing any test, because a locked test only changes through an unlock.
2. **Contract.** Types, schemas, migrations, and stubs that throw "not implemented". No behaviour yet, so the tests fail on assertions rather than on imports.
3. **Tests.** One test per acceptance criterion, at the levels the slice names (`writing-tests-first`), with abuse cases when the slice is marked sensitive (its `references/abuse-cases.md`). Write them all now: they were approved with the slices.
4. **Red, then lock.** Run the red command from Checks below on the slice's test files, with nothing appended, and read every failure: an import, compile or syntax error is a broken test, so fix the test and run again. Once every failure is the one its case names, call `mcp__workflow__lock`; if it expected another command, it answers with the exact one. From then on the tests are frozen.
5. **Green.** Implement with the smallest change that makes the slice tests pass. Then run the green checks from Checks below, exactly as written: lint, typecheck, the full suite.
6. **Exercise the real thing** when the slice has a runnable surface: start the app, call the route, open the screen in a browser at mobile and desktop widths.
7. **Self-check.** Each acceptance criterion maps to a passing test that asserts behaviour, not a call on a mock. Go through "Before calling it done" in `writing-clean-code` and `writing-secure-code`.
8. **Verify.** Call `mcp__workflow__verify`. It closes the slice once it has seen every check pass on the current code, and lists what is left. In the workflow's worktree: tick the slice in `slices.md`, and commit if this workflow commits. In a lane: commit the slice on your branch, and never tick `slices.md`, which the mod ticks when it merges your branch. The handoff and the next slice are the conversation's: leave them out.
9. **Report.** One slice per run: stop after verify and report. The mod hands the next step to the conversation once your run ends.

When stuck: after 3 real attempts on a red test, or as soon as a test looks wrong, stop and report with evidence (`writing-tests-first`, "The way out"). A locked test changes only after an unlock, which the user answers through the conversation.

Never: change a locked test, make the code detect the test, skip or weaken a check, append to a check command (`| tail`, `|| true`), start the next slice, or touch another folder than your own.
