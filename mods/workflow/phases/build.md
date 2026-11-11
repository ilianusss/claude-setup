---
writes: ["**"]
---
# The build phase

Goal: the current slice, built test-first, with its tests locked between red and green. One slice per session. The work runs in the `workflow:build` agent, on the build model and effort of this workflow's plan; you stay with the user.

## With the user

1. **Spawn.** Spawn `workflow:build` for the current slice, as the build agent section below says, and wait for its report. Do not write the tests or the code yourself.
2. **Relay.** Give the user its report: what it built, each check and its result, the answer of `mcp__workflow__verify`, and its open questions.
3. **Questions.** When the agent stopped on a test it believes wrong, put its evidence to the user and call `mcp__workflow__unlock` with the reason: the user decides. When it stopped on another question, ask the user, then spawn it again with the answer.
4. **Close.** Once verify passed, check that the agent ticked the slice in `slices.md` (and committed, if this workflow commits), then call `mcp__workflow__handoff` with where things stand and the next action.
5. **Stop.** One slice per session. Tell the user that `/workflow next` starts the next slice in a fresh context.

## Agent

Follow the steps in order. The mod enforces steps 4, 5 and 8.

1. **Load.** Read the slice and its design sections below, then the code the slice touches. Nothing else. Check each acceptance criterion against the design and the code: if one contradicts them (a wrong value, a case the design rules out), stop and report it before writing any test, because a locked test only changes through an unlock.
2. **Contract.** Types, schemas, migrations, and stubs that throw "not implemented". No behaviour yet, so the tests fail on assertions rather than on imports.
3. **Tests.** One test per acceptance criterion, at the levels the slice names (`writing-tests-first`), with abuse cases when the slice is marked sensitive (its `references/abuse-cases.md`). Write them all now: they were approved with the slices.
4. **Red, then lock.** Run the red command from Checks below on the slice's test files, with nothing appended, and read every failure: an import, compile or syntax error is a broken test, so fix the test and run again. Once every failure is the one its case names, call `mcp__workflow__lock`; if it expected another command, it answers with the exact one. From then on the tests are frozen.
5. **Green.** Implement with the smallest change that makes the slice tests pass. Then run the green checks from Checks below, exactly as written: lint, typecheck, the full suite.
6. **Exercise the real thing** when the slice has a runnable surface: start the app, call the route, open the screen in a browser at mobile and desktop widths.
7. **Self-check.** Each acceptance criterion maps to a passing test that asserts behaviour, not a call on a mock. Go through "Before calling it done" in `writing-clean-code` and `writing-secure-code`.
8. **Verify.** Call `mcp__workflow__verify`. It closes the slice once it has seen every check pass on the current code, and lists what is left: tick the slice in `slices.md`, and commit if this workflow commits. The handoff is the conversation's: leave it out.
9. **Report.** One slice per run: stop after verify and report.

When stuck: after 3 real attempts on a red test, or as soon as a test looks wrong, stop and report with evidence (`writing-tests-first`, "The way out"). A locked test changes only after an unlock, which the user answers through the conversation.

Never: change a locked test, make the code detect the test, skip or weaken a check, append to a check command (`| tail`, `|| true`), or start the next slice.
