# Drift check

Read when a workflow resumes after more than 14 days, or when its branch is behind the default branch. The mod already put the facts at the top of your prompt: the age, how far behind the branch is, the commits on the default branch in the folders this workflow touches, and lockfile changes.

1. **Run the project checks once** (the commands in `.claude/workflow.json`), on this branch as it is. A failure that was not there when the workflow paused is the first thing to report.
2. **Read the listed commits** that touch this workflow's folders: renamed or moved code, changed contracts, new conventions, a dependency the design relied on that changed.
3. **Read the lockfile changes**: a major version bump of a library this workflow uses means checking its API again (context7) before the next slice.
4. **Summarize in at most 10 lines**: what changed, what it means for the next step (a slice to adjust, a design section now wrong, nothing), and what you recommend.
5. **Rebase only with the user's go.** When the branch is behind, offer a rebase on the default branch; switching, rebasing and resolving conflicts are the user's call (CLAUDE.md, Safety). After a rebase, run the checks again.
6. **Record it.** Call `mcp__workflow__handoff` with the summary in "stopped" and the adjusted next action.

When a design section or a slice is now wrong, say so and propose the change; do not rewrite approved documents without the user's agreement.
