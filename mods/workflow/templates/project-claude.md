# <Project name>

<One sentence: what this project is and who uses it.>

## Commands

| What | Command |
| --- | --- |
| Install | `<command>` |
| Run locally | `<command>` |
| All tests | `<command>` |
| Some test files | `<command with the files>` |
| Lint | `<command>` |
| Typecheck | `<command>` |
| Format check | `<command>` |
| End-to-end | `<command>` |

The same commands are in `.claude/workflow.json`, which the workflow mod reads.

## Architecture

<Five lines at most: the main parts, how a request flows through them, where the data lives. Link the files or docs that hold more.>

## Invariants

<What must never break, each with where it is enforced: "a user only reads their own notes (checked in the query, `src/notes/repo.ts`)".>

## Tests

- Level: <solo tool | personal app, deployed | multi-user, team or production> (see `writing-tests-first`).
- Where: <unit tests next to the code, integration tests in `tests/`, end-to-end in `e2e/`>.
- Needs: <a database container, environment variables by name>.

## Conventions

<Only what differs from the global setup or what Claude got wrong here: naming, folder layout, the reviewers of pull requests, the issue tracker.>
