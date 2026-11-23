---
writes: ["**"]
---
# The inspect phase

Goal: an independent review of the whole branch, its blockers and majors fixed until none is left, the minor fixes the user picks, and, for a feature, the closing: the pull request and the documents the user chose to drop. A separate context matters here: the author agrees with its own code, and security degrades across rounds of changes.

## With the user

The mod follows this phase's steps itself and shows them on the workflow band: do not call `mcp__workflow__progress` in it. It counts a review round each time a `workflow:review` run ends; the review rounds section below says how many have ended.

1. **Review in fresh contexts:**
   - Spawn `workflow:review` in the foreground with the base branch and the lenses: spec and quality always, security when the change touches a surface in the trigger table of `writing-secure-code`. It reads this workflow's documents, returns findings and never edits.
   - In the first round only, also run the `code-review` skill on the branch for correctness bugs, at the low or medium level, and `/security-review` only for authentication, payments or a public release.
   - Merge the findings: remove duplicates, sort by severity (blocker, major, minor), and keep for each one the `file:line`, the rule broken, the evidence and the direction of the fix. Tell the user what the round found.
2. **Fix blockers and majors.** While the findings hold a blocker or a major and fewer than 3 review rounds have ended, spawn `workflow:build` in the foreground with those findings. It fixes each one test-first (a bug found in review gets its failing test before its fix) without the slice lock, and runs every check. Relay its report, then go back to step 1 for the next round, on the whole branch again.
3. **Out of rounds.** If a blocker or a major is left after 3 rounds, stop and ask the user how to go on (AskUserQuestion), with the findings left and the evidence: fix them by hand (wait for the user, then review once more), accept them as known issues (written under `## Known issues` in `design.md` for the pull request body), or go back to the design (call `mcp__workflow__handoff` with the findings and stop: the design needs the user's decision before more code). Recommend the option the findings point to.
4. **Choose the minors.** Once no blocker or major is left, ask which minor findings to fix in one AskUserQuestion with `multiSelect`, one option per finding (group related ones when there are more than four). Spawn `workflow:build` to fix the picked ones the same way. Write the others, and any blocker or major the user accepted in step 3, under `## Known issues` in `design.md`, one line each with its `file:line`: the pull request body takes them from there. Skip this step when there is no minor finding. With technical decisions off, the review rounds section below says what to do instead of asking.
5. **Run every check** of the project, exactly as written.
6. **Close.** When this prompt has a "Closing the workflow" section (a feature), follow it: it drafts the pull request, removes the documents the user chose to drop, and asks whether to commit, push and open the pull request. Without one (a project), push nothing: the retro comes next and closes the workflow.
7. **Approve.** Call `mcp__workflow__advance`. A feature is then done, and the mod offers to remove the worktree once it is clean and pushed; a project goes on to the retro.

An existing test changes only with a reason the user agrees with, listed in your report.

## Agent

Review this workflow's branch against the base branch your prompt names, with the lenses it names, the fixes of earlier rounds included. Before the spec lens, read `spec.md` (if any), `design.md` and `slices.md` in this workflow's documents folder. Report the findings in the output format above, most severe first. Never edit a file.
