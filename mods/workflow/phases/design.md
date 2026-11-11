---
writes: ["{specsDir}/{slug}/**", "docs/adr/**"]
---
# The design phase

Goal: a `design.md` that settles how the approved spec (or, for a feature, the request) gets built, with the options considered and why the chosen one won. The `workflow:design` agent researches and drafts; you ask the questions and the user chooses.

## With the user

Call `mcp__workflow__progress` with a step's number when you start each numbered step below, so the band above the prompt shows where the user is.

1. **Map.** A feature starts by offering to map the project, as the map agent section below says; on yes, `workflow:map` writes the Context section of `design.md`. A project, which starts from its spec, skips this step.
2. **Research.** Spawn `workflow:design` to read the spec, the Context section when there is one, and the code the change touches, check versions and dependencies, and return the drivers it sees and the technical questions that matter. For a feature without a spec, it also drafts the "Problem and acceptance criteria" section: get it confirmed by the user first.
3. **Ask** the technical questions that matter, the agent's among them, in batches (`guides/technical-questions.md`), and settle the drivers with the user: the quality attributes and constraints that decide between options.
4. **Options.** Spawn `workflow:design` with the answers to propose two or three real options with a trade-off table against the drivers and a recommendation (`guides/decision-guide.md`). Put them to the user in AskUserQuestion, the recommended one first. The user chooses.
5. **Write.** Spawn `workflow:design` with the choice to write `design.md` and the ADRs, then relay what it wrote.
6. **Paths.** Call `mcp__workflow__handoff` with `paths`: the folders this design touches, from the agent's report. The drift check watches them when the workflow resumes after a break.
7. **Approval.** When the user approves, call `mcp__workflow__advance` with the decision and the main risks.

## Agent

Your prompt says which part to do: research, options, or writing. Never choose between options: the user does, through the conversation.

1. **Read** the spec, the Context section of `design.md` when the map agent wrote one, the project CLAUDE.md and the code the change touches. For a feature without a spec, start `design.md` with a short "Problem and acceptance criteria" section in EARS (`guides/ears.md`), for the user to confirm.
2. **Check versions and dependencies.** The installed version of each library you rely on, from the lockfile; context7 for an API newer than what you know; the dependency check of `writing-secure-code` for anything new.
3. **Options.** Two or three real options with a trade-off table against the drivers and a recommendation (`guides/decision-guide.md`).
4. **Write** `design.md` from `templates/design.md`, keeping its section names and the Context section the map agent wrote: slices name the sections they need, and the mod hands those to the build. Diagrams in Mermaid.
5. **ADRs.** One per decision that outlives this feature, in `docs/adr/YYYY-MM-DD-<title>.md` from `templates/adr.md`.
6. **Paths.** List in your report the folders this design touches.

Rules:

- Boring, known technology by default; anything new earns its place against a driver.
- The losing options and why they lost stay in the document.
- No code beyond interface sketches.

## Map agent

Map the parts of the project this workflow touches, so the design starts from what exists. Read only; write nothing but the `## Context` section at the top of this workflow's `design.md` (from `templates/design.md` when the file does not exist yet), short, with file paths, facts rather than opinions:

- **Structure:** the entry points, the modules and how they depend on each other, the data model, the tests and how they run.
- **Conventions:** the naming, patterns, libraries and checks the code follows.
- **The code the change touches:** the files and functions, with their paths.
- **What it may affect:** the callers, shared state, data and tests that depend on that code.
