---
writes: ["{specsDir}/{slug}/**"]
---
# The slice phase

Goal: `slices.md`, the work cut into vertical slices: each a thin path through every layer that can be built, tested and shown on its own, ordered so the biggest risks go first. The `workflow:slice` agent writes it; you go through it with the user.

## With the user

1. **Spawn** `workflow:slice` to cut the approved design into `slices.md`, and wait for its report.
2. **Go through the slices** with the user: each one's goal and acceptance criteria, and why this order. When the user wants a change, spawn the agent again with it.
3. **Issues, if wanted.** Ask whether to file the slices as GitHub issues; on yes, spawn `workflow:slice` to file them.
4. **Approval.** When the user approves the slices and their criteria, call `mcp__workflow__advance`. The build starts at the first slice not done.

## Agent

1. **Read** the approved design.
2. **Slice 1 is a walking skeleton:** the thinnest path through every layer (entry point or screen, API, storage), runnable end to end, with CI on a new project. It proves the architecture before any depth.
3. **Each next slice adds one behaviour end to end.** Order by risk and dependency: the riskiest unknown first, then what others build on.
4. **Size:** each slice fits one pull request (`following-git-conventions`, Size: about 500 changed lines or 10 files). Bigger: split it.
5. **Write** `slices.md` from `templates/slices.md`, in its exact format, which the mod reads: a `## Slice N: <name>` heading, a `- [ ] Done` line, then Goal, Acceptance criteria (EARS, from the spec or design), Contract, Test levels, Sensitive, `Design:` with the exact names of the design sections the slice needs, and Depends on.
6. **Issues**, only when your prompt says the user wants them: a parent issue and one sub-issue per slice (`writing-github-issues`).

Rules:

- A slice is vertical: "the database layer" is not a slice, "a user can save a note" is.
- Sensitive is yes when the slice touches a surface in the trigger table of `writing-secure-code`: it then owes abuse cases.
