---
writes: []
---
# The intake phase

Goal: what the user wants from this workflow, in their words and agreed by them. Every later phase starts from this goal, so it is asked of the user, not guessed. The phase writes no file: the gate saves the goal into the workflow state, and the mod refuses every Edit and Write in the repo until the next phase. It runs in the conversation, with no agent.

## With the user

Call `mcp__workflow__progress` with a step's number when you start each numbered step below, so the workflow band shows where the user is.

1. **Read** the workflow title, and the project CLAUDE.md and README when you do not know the project yet, so you ask only what only the user knows.
2. **Listen.** Invite the user to describe, in their own words, what they want from this workflow: one open question, with no list of points to answer. Then wait for their description.
3. **Fill the gaps.** Check the description against the five points below and ask only about the ones it leaves out or leaves unclear, a few at a time, never one it already answers. A point the user clearly does not care about is noted as "not stated" rather than pressed. When the description covers all five, go straight on.
   - The problem: what is wrong or missing today, and for whom.
   - The result wanted: what exists once this workflow is done.
   - How success will show: what the user will see, run or measure to know it worked.
   - The limits: time, technology, compatibility, and what must not change.
   - Out of scope: what this workflow will not do.
4. **Recommend models.** Each later step runs in its own agent on a model and effort. The defaults are in the Default models section below. Load the `choosing-model-and-effort` skill and, from what the user described, decide where this workflow needs another model or effort than the default, and why. Keep only the steps that differ, each with a one-line reason tied to this workflow; `xhigh` only where that skill says it is earned, and never Fable or `max`. None differing is a fine answer.
5. **Gate.** The gate dialog is the restatement: it shows the five points and the user confirms or corrects them there, so do not restate them in chat or in a dialog of your own. Call mcp__workflow__advance with the five points as you understood them (`problem`, `result`, `success`, `limits`, `outOfScope`, each one line, "not stated" where the user left it open) and your recommendations as `recommendations` (`{ step, model, effort, reason }` each). The mod saves the five points as the goal once the user answers Continue or Stop here. When the user corrects them (Not yet, or a text typed under Other), amend the points from their answer and call mcp__workflow__advance again. After Continue the user chooses between the defaults, your recommendations and a choice per step, or, with technical decisions off, the mod takes your recommendations without asking: you never set the models yourself.

Rules:

- Ask, do not propose: no design, option or technology choice in this phase. Note what the user volunteers about the how; the design phase uses it.
- Use AskUserQuestion when an answer is a choice between a few options, plain questions otherwise, a few at a time. Follow up once on a vague answer.
- Write no file, and run no command that changes one.
