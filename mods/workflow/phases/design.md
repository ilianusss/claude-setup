---
writes: ["{specsDir}/{slug}/**", "docs/adr/**"]
---
# The design phase

Goal: a `design.md` that settles how the approved spec (or, for a feature, the request) gets built, with the options considered and why the chosen one won.

1. **Read** the spec, the project CLAUDE.md and the code the change touches. For a feature without a spec, start `design.md` with a short "Problem and acceptance criteria" section in EARS (`guides/ears.md`) and get it confirmed first.
2. **Ask** the technical questions that matter, in batches (`guides/technical-questions.md`), and list the drivers: the quality attributes and constraints that decide between options.
3. **Check versions and dependencies.** The installed version of each library you rely on, from the lockfile; context7 for an API newer than what you know; the dependency check of `writing-secure-code` for anything new.
4. **Propose two or three real options** with a trade-off table against the drivers and a recommendation (`guides/decision-guide.md`). The user chooses.
5. **Write** `design.md` from `templates/design.md`, keeping its section names: slices name the sections they need, and the mod hands those to the build. Diagrams in Mermaid.
6. **ADRs.** One per decision that outlives this feature, in `docs/adr/YYYY-MM-DD-<title>.md` from `templates/adr.md`.
7. **Paths.** Call `mcp__workflow__handoff` with `paths`: the folders this design touches. The drift check watches them when the workflow resumes after a break.
8. **Approval.** When the user approves, call `mcp__workflow__advance` with the decision and the main risks.

Rules:

- Boring, known technology by default; anything new earns its place against a driver.
- The losing options and why they lost stay in the document.
- No code beyond interface sketches.
