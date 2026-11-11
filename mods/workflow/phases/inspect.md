---
writes: ["**"]
---
# The inspect phase

Goal: an independent review of the whole branch, its blockers and majors fixed until none is left, the minor fixes the user picks, and a pull request draft. A separate context matters here: the author agrees with its own code, and security degrades across rounds of changes.

## With the user

The mod follows this phase's steps itself and shows them above the prompt: do not call `mcp__workflow__progress` in it. It counts a review round each time a `workflow:review` run ends; the review rounds section below says how many have ended.

1. **Review in fresh contexts:**
   - Spawn `workflow:review` in the foreground with the base branch and the lenses: spec and quality always, security when the change touches a surface in the trigger table of `writing-secure-code`. It reads this workflow's documents, returns findings and never edits.
   - In the first round only, also run the `code-review` skill on the branch for correctness bugs, at the low or medium level, and `/security-review` only for authentication, payments or a public release.
   - Merge the findings: remove duplicates, sort by severity (blocker, major, minor), and keep for each one the `file:line`, the rule broken, the evidence and the direction of the fix. Tell the user what the round found.
2. **Fix blockers and majors.** While the findings hold a blocker or a major and fewer than 3 review rounds have ended, spawn `workflow:build` in the foreground with those findings. It fixes each one test-first (a bug found in review gets its failing test before its fix) without the slice lock, and runs every check. Relay its report, then go back to step 1 for the next round, on the whole branch again.
3. **Out of rounds.** If a blocker or a major is left after 3 rounds, stop and ask the user how to go on (AskUserQuestion), with the findings left and the evidence: fix them by hand (wait for the user, then review once more), accept them as known issues for the pull request body, or go back to the design (call `mcp__workflow__handoff` with the findings and stop: the design needs the user's decision before more code). Recommend the option the findings point to.
4. **Choose the minors.** Once no blocker or major is left, ask which minor findings to fix in one AskUserQuestion with `multiSelect`, one option per finding (group related ones when there are more than four). Spawn `workflow:build` to fix the picked ones the same way. The others go in the pull request body as known issues. Skip this step when there is no minor finding.
5. **Run every check** of the project, exactly as written.
6. **Draft the pull request** with `following-git-conventions` (title, What, Test, and Known issues when any). Do not push: show the draft and ask.
7. **Approval.** When the user approves the push and the pull request, call `mcp__workflow__advance`. A feature is then done; a project goes on to the retro.

An existing test changes only with a reason the user agrees with, listed in your report.

## Agent

Review this workflow's branch against the base branch your prompt names, with the lenses it names, the fixes of earlier rounds included. Before the spec lens, read `spec.md` (if any), `design.md` and `slices.md` in this workflow's documents folder. Report the findings in the output format above, most severe first. Never edit a file.
