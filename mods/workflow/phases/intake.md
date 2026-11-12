---
writes: []
---
# The intake phase

Goal: what the user wants from this workflow, in their words and agreed by them. Every later phase starts from this goal, so it is asked of the user, not guessed. The phase writes no file: the goal goes into the workflow state through `mcp__workflow__handoff`, and the mod refuses every Edit and Write in the repo until the next phase. It runs in the conversation, with no agent.

## With the user

Call `mcp__workflow__progress` with a step's number when you start each numbered step below, so the band above the prompt shows where the user is.

1. **Read** the workflow title, and the project CLAUDE.md and README when you do not know the project yet, so you ask only what only the user knows.
2. **Ask** the user, in their words:
   - The problem: what is wrong or missing today, and for whom.
   - The result wanted: what exists once this workflow is done.
   - How success will show: what the user will see, run or measure to know it worked.
   - The limits: time, technology, compatibility, and what must not change.
   - Out of scope: what this workflow will not do.
3. **Restate** your understanding in a few lines, one per point above, and ask the user to confirm it or correct it. Restate again after each correction, until they confirm.
4. **Save.** Call mcp__workflow__handoff with `goal` set to the confirmed restatement, and the next action.
5. **Recommend models.** Each later step runs in its own agent on a model and effort. The defaults are in the Default models section below. Load the `choosing-model-and-effort` skill and, from the confirmed goal, decide where this workflow needs another model or effort than the default, and why. Keep only the steps that differ, each with a one-line reason tied to this workflow; `xhigh` only where that skill says it is earned, and never Fable or `max`. None differing is a fine answer.
6. **Gate.** Call mcp__workflow__advance with the confirmed restatement as the summary and your recommendations as `recommendations` (`{ step, model, effort, reason }` each). After Continue the user chooses between the defaults, your recommendations and a choice per step: you never set the models yourself.

Rules:

- Ask, do not propose: no design, option or technology choice in this phase. Note what the user volunteers about the how; the design phase uses it.
- Use AskUserQuestion when an answer is a choice between a few options, plain questions otherwise, a few at a time. Follow up once on a vague answer.
- Write no file, and run no command that changes one.
