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

## 2026-10-30: `/safety` lifts the infra and publish asks for one session

- **`/safety` toggles off the house asks for terraform, tofu, kubectl, helm, docker and package publishes**: devops sessions hit them on every apply. Git discards, `rm -rf`, gh, `dropdb` and secrets outside the sandbox keep asking, because none of them is routine devops work.
- **It lasts for the session and is obeyed only when typed at the prompt**: a forgotten toggle cannot leak into the next session, and neither Claude nor another plugin can lift a guard meant to hold against them.

## 2026-11-02: model and effort are picked per task

- **The `choosing-model-and-effort` skill maps each kind of task to a model and an effort, and every Agent call passes both**: on the Pro plan the main session and every subagent share one usage window, and a subagent without an explicit pick inherits Opus at the session's effort, while built-in Explore runs on Opus on a subscription whatever the session runs.
- **Fable and `max` effort are never used, and `xhigh` only when the skill's conditions hold**: Fable can bill to usage credits on Pro, and Anthropic warns that `max` gives diminishing returns and overthinks.

## 2026-11-02: house covers what the sandbox covered

- **`rm -rf` and any shell command that names a secret file ask in every session**: with the sandbox off since 2026-10-26, the `Read` deny rules no longer bind shell commands and nothing contains `rm -rf`, and both asks fired only outside the sandbox, so they never fired. The secret match now needs a file name (`.env.example`, `process.env` and `jq '.key'` stay quiet), because it runs on every command.
- **`env`, `bash -c`, `sh -c` and `zsh -c` are unwrapped**: a wrapper no longer hides a risky command from the checks.
- **Force pushes ask**: CLAUDE.md forbids force-pushing unless the user names it. A plain `git push` still never asks.
- **`rules/tests.md` became one CLAUDE.md line**: in auto mode Claude reads and edits mostly through Bash, which never loads path rules, and the audit saw "do not change a wrong expectation, ask" hold in 1 of 4 runs. Its other lines already live in `writing-tests-first`.
- **The Figma plugin is disabled and `aws-mcp` removed**: about 2.4k tokens of always-on context nobody used, and a server that failed to connect in every session.

## 2026-11-02: one repo, warden, checks on the outcome

- **`house` is renamed `warden`**: the name says what it does. Folder, manifest, messages, state key and status line follow.
- **The workflow mod lives in this repo, not in a submodule**: one person uses it, and every change cost a commit and a push in two repos. The `ilianusss/claude-workflow` repo and its Desktop clone are no longer used.
- **`/safety` also lifts force pushes**: they are routine when rewriting a feature branch. Each check now says whether `/safety` may lift it, instead of a list of programs.
- **Command replies leave the prefix to Claude Code**: it already shows `workflow:` before a command's output, so the mods' own prefix printed twice.
- **Shell writes are checked on the outcome, with notes rather than refusals**: in auto mode Claude edits mostly through Bash, which the Edit and Write guards never see. warden compares the em dashes in the git diff and the untracked files at the start and end of each turn; the workflow diffs the working tree around each shell command in a phase with a write scope. The command has already run, so both leave a note instead of undoing anything.
- **The build prompt names the test command and the checks**: Claude used to spend one refused `lock` call per slice to learn them. The build phase also checks each acceptance criterion against the design before writing tests, because Sonnet copied a wrong one into a locked test.
- **Plan mode for changes that fit one session, `/workflow` for several slices**: plan mode enforces the approval that CLAUDE.md used to ask for in prose.
- **warden has an eval suite, the rest uses the audit harness**: `claude plugin eval` runs each case with and without the plugin, which fits warden. CLAUDE.md and the skills are not a plugin, and the workflow starts from a slash command that headless runs can drop, so they rerun through `~/.claude/audit/harness/regress.sh`.

## 2026-11-02: no path-scoped rules

- **`rules/` is gone**: a rule loads only when Claude's Read, Edit or Write tools touch a matching file, and in auto mode Claude mostly reads and edits through Bash, so the rules rarely loaded. What they held that nothing else did moved: the infrastructure file conventions into `changing-infrastructure`, the two TypeScript lines (floating promises, `import type`) into `writing-clean-code`, and the UI check (mobile and desktop widths, focus, overflow, dark mode, keyboard) into the CLAUDE.md verification line. The rest already lived in `writing-clean-code`, `writing-secure-code` and `editing-claude-setup`.
- **`changing-database-schema` lost its `paths`**: a path-scoped skill is offered only when Claude's tools touch a matching file, like a rule, so it now triggers on its description like the other skills (about 90 tokens per request).
- **The workflow mod declares its own tools in `types/index.d.ts`**: the generated MCP types come from the session that last saved the mod, and a session outside a workflow repo never registers them, so every edit from `~/.claude` broke the type-check.

## 2026-11-04: scribe

- **scribe fixes typos and nothing else**: Anthropic's current Claude Code guidance says a plain prompt already works and that what improves one is information Claude cannot see (the symptom, the file, what done looks like). A rewriter cannot know those facts, so an "improve my prompt" pass would guess or pad. It is left out until a design that hints instead of rewriting is worth trying.
- **The fix is applied without asking, with a toast**: putting the correction back in the prompt box would cost an extra Enter on every prompt. The guards (length, protected spans, em dashes) and the toast make a silent rewrite safe enough.
- **scribe fails open where warden fails closed**: a broken warden must not let a risky command through, but a broken scribe must not block or lose a prompt. Every failure sends the prompt as typed; the engine already skips a hook that throws, so the mod needs no `try/catch`.
- **Haiku at low effort, 4 s timeout**: measured in headless runs at 0.9 to 1.8 s per call, the hook settling about 30 ms after the answer.

## 2026-11-09: work in a worktree

- **Changes in a git repo happen in a worktree**: the main checkout may hold the user's own uncommitted work, and a worktree keeps Claude's apart. CLAUDE.md names `EnterWorktree`, whose own description says to use it only when the user or CLAUDE.md asks.
- **warden asks the person once per checkout instead of refusing outright**: some tasks continue the user's uncommitted work, which does not follow into a worktree. The dialog's "allow this checkout for this session" covers them; a dismissed dialog and a headless run refuse, so the guard fails closed.
- **Shell changes are caught around each Bash command, by status and content hash, not around the turn**: a shell command cannot be read for the files it writes, and a hash catches a file the user had already changed when it changes again. A turn-wide comparison would blame Claude for the files the user saves in the main checkout while Claude works, which is the point of the worktree. The check is a note, so it fails open; the edit guard fails closed.
- **`worktree.baseRef` is `head`**: the default `fresh` branches from `origin/<default branch>`, so a task on a feature branch would start without its commits.
- **`/workflow new` always creates a worktree** except in a linked worktree that runs no workflow yet, which drops the "use this checkout anyway" choice.
- **`git` is excluded from rtk**: a session in a worktree refuses every `rtk git ...` command, and the rule puts most sessions in one. git output is no longer compressed.
- **The em dash eval case grades the trace, not the file**: the eval sandbox's home is a git repo, so the worktree guard also refuses the corrected Write and no file is ever written. The case now checks warden's em dash refusal in the trace, like `force-push-asks`.
- **The audit harness scores the worktree Claude entered, and the workflow fixture is a linked worktree**: otherwise `regress.sh` would score an untouched main checkout.


## 2026-11-09: shush

- **The caveman plugin's voice rules, not the plugin**: caveman also runs in subagents, writes one-line commits, compresses CLAUDE.md and filters tool output, which clash with full-prose handoffs, the git conventions and `rtk`. Only its reply rules were kept, without its dropped articles, which cost nuance and read badly.
- **Rules attached to each prompt, not CLAUDE.md**: the CLAUDE.md line on reply length was loaded once, far from the turn, and held poorly. Hidden context beside each typed prompt sits next to the turn it governs.
- **shush loads before scribe**: the first plugin in `CLAUDE_CODE_PLUGIN_DIRS` is the outermost hook. Loaded after scribe, a trailing `++` would reach Haiku first, which may drop it as stray punctuation, and the rules would come back on.
- **No classifier**: the main model already knows a simple question from a design one, so a Haiku call to pick the mode would cost latency to answer what it knows. The rules carry their own exceptions, and `++` or `/shush off` cover the cases where the person knows better.
## 2026-11-09: skin moves into the setup

- **A mod here, not a marketplace plugin**: the person is its only user, so the marketplace, the installer, the CI matrix and the release process cost upkeep for nobody. Loaded from `mods/skin` through `CLAUDE_CODE_PLUGIN_DIRS` like the other mods, a change takes effect on merge, with no version bump.
- **No history imported**: the code was restructured on the way in (`hooks/` for the entry, `src/` for the code, as in the other mods), so the old paths would not have matched anyway. The `ilianusss/claude-skin` repo keeps the history.
- **Skins come only from `~/.theme`**: the sixteen built-in skins, skin files, the repaint editor, the `make-skin` skill and the shortlist were never used once the theme home drove the colours. What four palettes borrowed from a built-in through `claude_skin` moved into the palettes as `claude_<slot>` keys, and the words as new `claude_spinner` and `claude_done` keys, so they draw exactly as before (checked palette by palette against the old code).
- **One built-in skin kept, `miasma`**: a session with no theme home (another machine, `SKIN_THEME_HOME` unset) still gets a skin, and its words fill a palette that names none, as noir's did.
- **No light/dark detection**: a palette is drawn as-is for its own background, so the system probes and `SKIN_APPEARANCE` changed nothing any more and were removed.
