---
writes: ["**"]
---
# The build phase

Goal: the current slice, built test-first, with its tests locked between red and green. One slice per session: the slice and the design sections it needs are below.

Follow the steps in order. The mod enforces steps 4, 5 and 8.

1. **Load.** Read the slice and its design sections below, then the code the slice touches. Nothing else.
2. **Contract.** Types, schemas, migrations, and stubs that throw "not implemented". No behaviour yet, so the tests fail on assertions rather than on imports.
3. **Tests.** One test per acceptance criterion, at the levels the slice names (`writing-tests-first`), with abuse cases when the slice is marked sensitive (its `references/abuse-cases.md`). Write them all now: they were approved with the slices.
4. **Red, then lock.** Call `mcp__workflow__lock`. It answers with the exact command to run. Run it as given, with nothing appended, and read every failure: an import, compile or syntax error is a broken test, so fix the test and run again. Once every failure is the one its case names, call lock again. From then on the tests are frozen.
5. **Green.** Implement with the smallest change that makes the slice tests pass. Then run each check the lock listed, exactly as written: the slice tests, lint, typecheck, the full suite.
6. **Exercise the real thing** when the slice has a runnable surface: start the app, call the route, open the screen in a browser at mobile and desktop widths.
7. **Self-check.** Each acceptance criterion maps to a passing test that asserts behaviour, not a call on a mock. Go through "Before calling it done" in `writing-clean-code` and `writing-secure-code`.
8. **Verify.** Call `mcp__workflow__verify`. It closes the slice once it has seen every check pass on the current code, and lists what is left: tick the slice in `slices.md`, commit if this workflow commits, write the handoff.
9. **Stop.** One slice per session. Tell the user that `/workflow next` starts the next slice in a fresh context.

When stuck: after 3 real attempts on a red test, or as soon as a test looks wrong, stop and report with evidence (`writing-tests-first`, "The way out"). A locked test changes only after `mcp__workflow__unlock`, which the user answers.

Never: change a locked test, make the code detect the test, skip or weaken a check, append to a check command (`| tail`, `|| true`), or start the next slice in this session.
