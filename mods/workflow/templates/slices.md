# Slices: <title>

Keep this format: the workflow mod reads the `## Slice N:` headings, the `- [ ] Done` lines and the `Design:` lines.

## Slice 1: Walking skeleton
- [ ] Done

Goal: <the thinnest path through every layer, runnable end to end>.
Acceptance criteria:
- AC1: WHEN <trigger> THE SYSTEM SHALL <response>.
Contract: <types, schemas, migrations to fix before the tests>.
Test levels: <unit, integration, end-to-end>.
Sensitive: <yes or no>.
Design: <exact names of the design sections this slice needs, comma-separated>
Depends on: none

## Slice 2: <one behaviour, end to end>
- [ ] Done

Goal: <what a user can do once this slice is done>.
Acceptance criteria:
- AC1: ...
- AC2: IF ... THEN THE SYSTEM SHALL ...
Contract: <...>.
Test levels: <...>.
Sensitive: <yes or no>.
Design: <section names>
Depends on: Slice 1
