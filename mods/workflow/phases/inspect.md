---
writes: ["**"]
---
# The inspect phase

Goal: an independent review of the whole branch, the fixes the user picks, and a pull request draft. A separate context matters here: the author agrees with its own code, and security degrades across rounds of changes.

## With the user

1. **Review in fresh contexts:**
   - Spawn `workflow:review` with the base branch and the lenses: spec and quality always, security when the change touches a surface in the trigger table of `writing-secure-code`. It reads this workflow's documents, returns findings and never edits.
   - Run the `code-review` skill on the branch for correctness bugs, at the low or medium level.
   - Run `/security-review` only for authentication, payments or a public release.
2. **Merge the findings:** remove duplicates, sort by severity (blocker, major, minor), and keep for each one the `file:line`, the rule broken, the evidence and the direction of the fix.
3. **Let the user choose** what gets fixed (AskUserQuestion, multiSelect). Everything not chosen goes in the pull request body as known issues.
4. **Fix test-first:** a bug found here gets its failing test before its fix (`writing-tests-first`). An existing test changes only with a reason the user agrees with, listed in your report.
5. **Run every check** of the project.
6. **Draft the pull request** with `following-git-conventions` (title, What, Test). Do not push: show the draft and ask.
7. **Approval.** When the user approves the push and the pull request, call `mcp__workflow__advance`. A feature is then done; a project goes on to the retro.

## Agent

Review this workflow's branch against the base branch your prompt names, with the lenses it names. Before the spec lens, read `spec.md` (if any), `design.md` and `slices.md` in this workflow's documents folder. Report the findings in the output format above, most severe first. Never edit a file.
