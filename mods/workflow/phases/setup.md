---
writes: ["CLAUDE.md", ".claude/**"]
---
# The setup phase

Goal: make this project ready for workflows. You learn how to build, test and check it; the workflow mod learns which files are tests and which commands to watch.

1. **Read before asking.** The manifests (`package.json`, `pyproject.toml`, `Cargo.toml`, `go.mod`, `Makefile`, `CMakeLists.txt`, `*.rockspec`), the CI config, the README, any existing CLAUDE.md, the test folders and one or two test files.
2. **Detect** the languages and frameworks, the package manager, and the commands: the whole test suite, chosen test files, lint, typecheck, format, end-to-end. In a monorepo, one set per package.
3. **Prove each command** by running it once. A command that fails before any change is a finding: report it, do not fix the project in this phase. Check that the test-files command runs exactly the files it is given: run it on one test file and read the output.
4. **Ask the user**, in one AskUserQuestion batch, only what the files cannot tell you: the test level (the table in `writing-tests-first`), the invariants that must never break, and conventions you saw but are unsure of.
5. **Write**, from the templates folder (see Files):
   - `.claude/workflow.json` from `workflow.json`: `testGlobs` (every pattern a test file here matches), `testConfig` (the files that decide which tests run), `commands` (`test` and `testFiles` with `{files}`, then `lint`, `typecheck`, `format`, `e2e` when they exist), `testLevel`, `specsDir`, and `packages` for a monorepo.
   - `CLAUDE.md` from `project-claude.md`: commands, a five-line architecture with links, invariants, test level, conventions. Under 80 lines. When one exists, extend it instead of replacing it.
   - `.claude/settings.json`: allow rules for this project's commands, each Bash rule twice (plain and with `rtk ` in front, because rules match the command after `rtk` rewrites it), and the sandbox exceptions the project needs (`sandbox.network.allowedDomains` for a host its tools reach).
6. **Approval.** Inside a workflow, call `mcp__workflow__advance` with the commands you proved, the test level, and anything that failed. Outside one (`/workflow adopt`), show the three files and ask the user to review them.

Rules:

- No new test infrastructure without asking: a project with no test setup gets a proposal, not an install.
- Rust: inline `#[cfg(test)]` modules cannot be locked by path. In a workflow, tests go in `tests/` or in a separate `tests.rs` module file; tell the user when the project uses inline tests.
- The commands must work from the repo root, as written: the mod compares the commands you run with these, character for character.
