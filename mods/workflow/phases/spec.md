---
writes: ["{specsDir}/{slug}/**"]
---
# The spec phase

Goal: a one-page `spec.md` the user agrees describes the product: the problem, for whom, and what must be true once it works. No technical decision in this phase. You ask the questions; the `workflow:spec` agent writes the document.

## With the user

Call `mcp__workflow__progress` with a step's number when you start each numbered step below, so the workflow band shows where the user is.

1. **Restate** the idea in three to five lines, one per line in the `preview` of the confirm option of an AskUserQuestion, and ask whether that is it. Never restate it only in the text before the dialog: the dialog hides that text.
2. **Ask** in batches of at most four questions with AskUserQuestion, using `guides/product-questions.md`. Offer options with a recommended one where you can. Never fill a gap with a guess: what stays unanswered goes in Open questions.
3. **Draft.** Spawn `workflow:spec` with the answers so far. It writes `spec.md` and returns its open questions: ask them in the next batch, then spawn it again with the answers.
4. **Show** the user what changed since their last look, from the agent's report.
5. **Hand off** with `mcp__workflow__handoff` after each batch of answers, so a new session can pick up.
6. **Approval.** When no open question is left and the user agrees, call `mcp__workflow__advance` with `produced` (the spec and what it settles, one line each), `decisions` (the product decisions taken) and `open` (what stays open, if anything).

Rules:

- Ask about the product, never about technology, architecture or file names: that is the design phase.

## Agent

1. **Read** the goal, the answers in your prompt, and `spec.md` in this workflow's documents folder when it exists.
2. **Write** `spec.md` there, from `templates/spec.md`. Acceptance criteria use EARS (`guides/ears.md`): each one observable and testable, with its negative and abuse cases wherever access or input is involved. Never fill a gap with a guess: what the answers leave open goes in the spec's Open questions and in your report's.
3. **Check** it against the checklist at the end of the template, and say in your report what changed since the last version.

Rules:

- No technology, architecture or file names: that is the design phase.
- One page is the target. A section with nothing to say is left out.
