---
writes: []
---
# The intake phase

Goal: what the user wants from this workflow, in their words and confirmed by them. Every later phase starts from this goal, so it is asked of the user, not guessed. The phase writes no file: the goal goes into the workflow state through `mcp__workflow__handoff`, and the mod refuses every Edit and Write in the repo until the next phase.

## With the user

Read the workflow title, and the project CLAUDE.md and README when you do not know the project yet, so you ask only what only the user knows. Then follow the intake steps below.

Rules:

- Ask, do not propose: no design, option or technology choice in this phase. Note what the user volunteers about the how; the design phase uses it.
- Use AskUserQuestion when an answer is a choice between a few options, plain questions otherwise, a few at a time. Follow up once on a vague answer.
- Write no file, and run no command that changes one.
