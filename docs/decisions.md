# Decisions

Dated one-line entries: what was decided and why. Newest last. Add one whenever a change is a decision someone could later question.

## 2026-10-22: the rebuild

- **The repo is `~/.claude` itself**, with a whitelist `.gitignore`: one clone sets up a machine, and Claude Code's runtime data stays out of git.
- **The install replaces `~/.claude` instead of merging into it**, then copies the runtime data back: merging would have kept the old third-party skills loaded.
- **No rule per language.** Six path-scoped rules; error idioms of every language live in `code.md`. More only when the retro shows repeated corrections.
- **Knowledge skills ported from the ZeBuilder samples, made generic**, and cut to what Claude would not do unprompted.
- **TDD is triggered by CLAUDE.md for any behaviour change in a repo with tests**, with frozen tests, no special-casing, a visible red and an explicit way out, because cheating happens when there is no legitimate exit.
- **Test levels scale with the project**: unit, integration, end-to-end and abuse cases by project size, not all of them everywhere.
- **Security: own skill plus Anthropic's `/security-review`, a per-project overlay skill per stack, and a short OWASP map** instead of a full mapping.
- **No custom skill-writing skill**: Anthropic's `skill-creator` exists; the house style is a rule.
- **context7 is used when the installed version is newer than what Claude knows**, read from the lockfile.
- **The workflow is a mod plus markdown, not a skill**: routing, state, locks, gates and status are code, and cost no tokens; phase instructions stay markdown that also works by hand.
- **A test lock instead of separate test-writer and implementer agents**: the same separation, enforced by the mod, without two cold starts per slice on a Pro quota.
- **The mod never runs project code**: tests run in the sandbox through Bash and the mod only watches their results, because `$.process.run` is not sandboxed.
- **One reviewer agent per feature, not per slice**, plus the built-in `/code-review`, for the token budget.
- **One slice per session**, with `/workflow next` clearing the context; `auto_next` is opt-in.
- **Workflow state in the git common dir**: uncommitted, shared by every worktree, rebuilt from committed documents by `/workflow adopt`.
- **The workflow mod is its own repo** (`ilianusss/claude-workflow`), a submodule here, installable anywhere as a plugin; `house` stays personal.
- **Defaults taken for the open questions**: specs and ADRs committed; slices chained by hand; commits after each slice asked once per workflow; phase write scopes refuse rather than warn; em dashes in replies rewritten; building on the early-access mod API, with manual mode as the fallback.
- **Opus 5.5 effort lowered from xhigh to high**: xhigh drains a Pro quota fastest.

## 2026-10-22: measured in M0

- **Every Bash permission rule is written twice, plain and with `rtk `**: rules match the command after `rtk` rewrites it, and a plain `Bash(git push:*)` deny let `git push` through.
- **`house` asks for risky commands itself**: prefix rules miss forms like `git -C dir push`, and an unsandboxed retry would otherwise be judged by the auto-mode classifier.
- **Mod tools ask with `$.ui.ask`**: a tool the mod serves skips the permission step, so a `tool.check` ask never fires for it.
- **`/workflow next` runs `/clear` from a timer**: a mod cannot run a command from inside its own command hook.
- **The workflow state folder is denied to `Edit`**: through the sandbox merge this also blocks shell writes, and the mod writes with its own file access.

## 2026-10-22: fewer deterministic blockers

- **`settings.json` keeps only `deny` rules**: the `ask` list is gone and so is the `allow` list, which `autoAllowBashIfSandboxed` already made redundant for sandboxed commands. Push, discards, infra changes and publishes now rest on the CLAUDE.md Safety section and on the `house` asks, because the aim is to block only secrets and the workflow state and trust the model with the rest.

## 2026-10-22: ask only for critical commands

- **`house` stops asking for every unsandboxed command**: a harmless retry now keeps the verdict from beneath, so the auto-mode classifier judges it. The ask stays for commands on the risky list and for commands that touch a secret path, because the `deny` rules bind a command only inside the sandbox.
- **`git push` never asks**: Claude may push, the ask stays on `gh pr merge`.
- **`rm -rf` asks only outside the sandbox**: inside it the damage stays in the working directory, which the sandbox already contains.

## 2026-10-22: model and effort stay out of the repo

- **A git clean filter strips `model`, `effortLevel` and `modelSettings` from `settings.json`**: `/model` rewrites them in the user file, which has no `.local` variant, so they made every session leave a diff. Git cannot ignore single lines, and `skip-worktree` would hide real edits to the file.

## 2026-10-26: house stops asking for checkout, switch, restore and stash

- **`git checkout`, `git switch`, `git restore` and `git stash` no longer ask**: they asked on every branch switch and every stash, too often for the risk. The CLAUDE.md Safety section still asks Claude to check before discarding uncommitted work; `reset --hard`, `clean` and `branch -D` keep the ask.
