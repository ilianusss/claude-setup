---
writes: ["{specsDir}/{slug}/**", "CLAUDE.md", ".claude/**", "docs/**"]
---
# The retro phase

Goal: what this workflow taught, turned into small changes to the setup so the next one goes better.

1. **Gather the evidence:** the review findings, the corrections the user made during the workflow, the unlock entries in the state log (each says a test or a requirement was wrong), slices that took several sessions or got stuck, and where the build departed from `design.md`.
2. **One proposal per pattern that happened more than once**, smallest first:
   - a line in a rule (`~/.claude/rules/`) or in the project CLAUDE.md;
   - an edit to a global skill (`~/.claude/skills/`);
   - a project skill (`.claude/skills/`) for what only this stack needs;
   - nothing, for a one-off.
3. **Show the proposals** with the evidence for each, and let the user pick (AskUserQuestion, multiSelect).
4. **Apply the picked ones** following `editing-claude-setup`. Changes in `~/.claude` are files outside this repo: apply them, and leave committing them to the user unless they ask.
5. **Close the loop on the design:** fill "What changed from the design" in `design.md`.
6. **Approval.** Call `mcp__workflow__advance` to close the workflow.

A proposal names the behaviour it should change. "Be more careful with X" changes nothing; "before Y, check Z" does.
