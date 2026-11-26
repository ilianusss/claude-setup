---
writes: ["{specsDir}/{slug}/**"]
---
# The slice phase

Goal: `slices.md`, the work cut into vertical slices: each a thin path through every layer that can be built, tested and shown on its own, ordered so the biggest risks go first. The `workflow:slice` agent writes it; you go through it with the user.

## With the user

Call `mcp__workflow__progress` with a step's number when you start each numbered step below, so the workflow band shows where the user is.

1. **Spawn** `workflow:slice` to cut the approved design into `slices.md`, and wait for its report.
2. **Go through the slices** with the user: each one's goal and acceptance criteria, and why this order, then the waves (wave 1: slices ...; wave 2: ...) the dependencies give, so the user sees what can be built at the same time. When the user wants a change, spawn the agent again with it.
3. **Issues, if wanted.** Ask whether to file the slices as GitHub issues; on yes, spawn `workflow:slice` to file them.
4. **Approval.** When the user approves the slices and their criteria, call `mcp__workflow__advance` with `produced` (each slice, one line: its number, name and goal, then one line per wave: "Wave 1: slices 1"), `decisions` (the order, the dependencies and why) and `risks` (the slices that carry the biggest risk). The mod refuses the gate when a slice has no `Depends on:` line, or one names a slice that does not exist, a slice itself, or closes a cycle. The build starts at the first slice not done.

## Agent

1. **Read** the approved design.
2. **Slice 1 is a walking skeleton:** the thinnest path through every layer (entry point or screen, API, storage), runnable end to end, with CI on a new project. It proves the architecture before any depth.
3. **Each next slice adds one behaviour end to end.** Order by risk and dependency: the riskiest unknown first, then what others build on.
4. **Cut for parallel work.** After the walking skeleton, cut for the most slices that can be built at the same time. Name only real dependencies in `Depends on:` (`Slice 1, Slice 3`, or `none`): a slice needs code, a schema or a migration another slice adds; two slices that would change the same files are dependent, since parallel lanes would conflict on merge; migrations numbered in sequence make their slices dependent. No false chains: order alone is not a dependency.
5. **Size:** each slice fits one pull request (`following-git-conventions`, Size: about 500 changed lines or 10 files). Bigger: split it.
6. **Write** `slices.md` from `templates/slices.md`, in its exact format, which the mod reads: a `## Slice N: <name>` heading, a `- [ ] Done` line, then Goal, Acceptance criteria (EARS, from the spec or design), Contract, Test levels, Sensitive, `Design:` with the exact names of the design sections the slice needs, and Depends on (slice numbers: `Depends on: Slice 1`, or `Depends on: none`).
7. **Issues**, only when your prompt says the user wants them: a parent issue and one sub-issue per slice (`writing-github-issues`).

Rules:

- Your report shows the waves: slices with no dependency in wave 1, then each next wave holds the slices whose dependencies are all in earlier waves (wave 1: slices ...; wave 2: ...).
- A slice is vertical: "the database layer" is not a slice, "a user can save a note" is.
- Sensitive is yes when the slice touches a surface in the trigger table of `writing-secure-code`: it then owes abuse cases.
