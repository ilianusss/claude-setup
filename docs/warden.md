# warden: everything it blocks

Tracking sheet for `mods/warden`. The source of truth is the code: `src/safety.ts`, `src/typography.ts`, `src/integrity.ts`, `src/worktree.ts`. Update this file in the same change as any guard.

Outcomes:

- **ask**: a person-only dialog before the call runs. The person approves or declines.
- **refuse**: the call is denied and Claude gets the reason. No dialog.
- **note**: the call already ran. Claude gets a note or a follow-up prompt and must fix it.
- **rewrite**: warden edits the text itself.

## Unlock commands

| Command | Where | Effect | Scope |
| --- | --- | --- | --- |
| `/safety` | Typed at the prompt only. Ignored from a skill, hook or model. | Turns off the asks marked **/safety** below. Status line shows `warden: safety off`. Typing it again turns them back on. | Current session |
| "Allow this checkout for this session" | Answer to the worktree dialog | Lets edits and shell changes in that main checkout through without asking again | Current session, that checkout |

Nothing else can be unlocked. The rows marked "none" stay on in every session.

## Safety asks (Bash)

Matched with or without `rtk`, in any segment of a compound command (`;`, `&&`, `|`), through `sudo`, `env`, `command`, `exec`, `time`, `nohup`, and inside `bash -c`, `sh -c`, `zsh -c`, `dash -c`.

| Command | Asks when | Reason shown | Unlock |
| --- | --- | --- | --- |
| `git reset` | `--hard` | can discard uncommitted work | none |
| `git clean` | not `-n` and not `--dry-run` | deletes untracked files | none |
| `git push` | `-f`, `--force`, `--force-with-lease`, or a `+refspec` | force-pushes, rewriting the remote history | `/safety` |
| `git branch` | `-D`, or `-d` with `--force` | deletes a branch with unmerged work | none |
| `rm` | recursive and force (`-rf`, `-fr`, `--recursive --force`) | deletes files recursively without asking | none |
| `terraform`, `tofu` | `apply`, `destroy`, `import` | changes infrastructure | `/safety` |
| `terraform`, `tofu` | `state` with anything except `list`, `show`, `pull` | changes Terraform state | `/safety` |
| `kubectl` | `apply`, `delete`, `edit`, `patch`, `scale`, `replace`, `drain` | changes a cluster | `/safety` |
| `kubectl` | `rollout` with anything except `status`, `history` | changes a cluster | `/safety` |
| `helm` | `install`, `upgrade`, `uninstall`, `delete`, `rollback` | changes a cluster | `/safety` |
| `docker` | `system prune` | deletes Docker data | `/safety` |
| `docker` | `volume rm`, `volume prune` | deletes Docker volumes | `/safety` |
| `docker compose`, `docker-compose` | `down` with `-v` or `--volumes` | deletes Docker volumes | `/safety` |
| `gh` | `pr merge` | merges a pull request | none |
| `gh` | `release` with anything except `list`, `view`, `download` | changes a release | none |
| `gh` | `repo delete` | deletes a repository | none |
| `npm`, `pnpm`, `yarn`, `cargo` | any argument `publish` | publishes a package | `/safety` |
| `dropdb` | always | drops a database | none |
| any command | names a secret path (see below) | touches a secret file | none |

Secret paths: `.env` and `.env.*` (except `.example`, `.sample`, `.template`, `.dist`), `.ssh/...`, `.kube/config`, `.aws/credentials`, `*.tfstate`, `*.tfstate.backup`, `*.pem`, `*.key`.

If the safety check itself throws, warden asks (fails closed), and `/safety` does not lift that.

## Em dash guard (every file and message)

| What | Outcome | Condition | Unlock |
| --- | --- | --- | --- |
| `Edit` | refuse | `new_string` has more em dashes than `old_string` | none |
| `Write` | refuse | content has more em dashes than the file on disk | none |
| `NotebookEdit` | refuse | the new cell source has an em dash (not for delete) | none |
| `Bash` that writes prose | refuse | `git commit` or `gh pr/issue/release create/edit/comment`, and the command or a `-F`, `--file`, `--body-file` file has an em dash | none |
| Shell edits to files | note | an em dash was added in the git diff or an untracked file during the turn; follow-up prompt at the end of the turn | none |
| Claude's chat reply | rewrite | em dashes become ` - ` | none |
| Any of the checks above fails | refuse | the call is refused rather than let through | none |

## Test integrity (notes only)

| What | Outcome | Condition | Unlock |
| --- | --- | --- | --- |
| `Edit` or `Write` on a test file | note | adds `.only`, `.skip`, `xit`/`xdescribe`/`xtest`, `fit`/`fdescribe`, a pytest skip or xfail, a unittest skip, `t.Skip`, `#[ignore]`, or removes assertions | none |
| `Edit` or `Write` on a snapshot | note | any change: "read every line of the change" | none |
| Shell edits to test files | note | same findings, found in the uncommitted diff at the end of the turn, minus those present at the turn start | none |

Test files: `*.test.*`, `*.spec.*`, `__tests__/`, `tests/`, `test/`, `spec/`, `e2e/`, `*_test.go`, `test_*.py`, `*_test.py`, plus the project's own test globs. Snapshots: `__snapshots__/`, `*.snap`.

## Worktree guard

Applies only in a main checkout (not a linked worktree).

| What | Outcome | Unlock |
| --- | --- | --- |
| `Edit`, `Write`, `NotebookEdit` in a main checkout | ask: "Move the work to a worktree" or "Allow this checkout for this session". A dismissed dialog, a typed answer or a headless run refuses. | "Allow this checkout for this session" |
| `Bash` that changed files in a main checkout | note after the command, with the same dialog and the same unlock | "Allow this checkout for this session" |
| The worktree check fails | refuse for Edit, Write and NotebookEdit; the shell command is let through | none |

## Not warden

`settings.json` `permissions.deny` blocks the Read tool on `.env*`, `*.tfstate*`, `~/.kube/config`, `~/.aws/credentials`, `~/.ssh/**`, `*.pem`, `*.key`, and edits to `.git/claude-workflow/**`. Those rules do not bind the shell, which is why warden asks on secret paths in Bash.
