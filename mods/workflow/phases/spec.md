---
writes: ["{specsDir}/{slug}/**"]
---
# The spec phase

Goal: a one-page `spec.md` the user agrees describes the product: the problem, for whom, and what must be true once it works. No technical decision in this phase.

1. **Restate** the idea in three to five lines and ask whether that is it.
2. **Ask** in batches of at most four questions with AskUserQuestion, using `guides/product-questions.md`. Offer options with a recommended one where you can. Never fill a gap with a guess: what stays unanswered goes in Open questions.
3. **Write** `spec.md` in this workflow's documents folder, from `templates/spec.md`. Acceptance criteria use EARS (`guides/ears.md`): each one observable and testable, with its negative and abuse cases wherever access or input is involved.
4. **Check** it against the checklist at the end of the template, then show the user what changed since their last look.
5. **Hand off** with `mcp__workflow__handoff` after each batch of answers, so a new session can pick up.
6. **Approval.** When no open question is left and the user agrees, call `mcp__workflow__advance` with a five-line summary.

Rules:

- No technology, architecture or file names: that is the design phase.
- One page is the target. A section with nothing to say is left out.
