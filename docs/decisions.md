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

## 2026-11-11: accompagny

- **The conversation orchestrates and the mod registers one agent per step** (`workflow:map` to `workflow:review`, [ADR](adr/2026-11-11-workflow-steps-in-registered-agents.md)): only then are a step's prompt, tools, model and effort set by the mod and under test. A generic agent would keep `mcp__workflow__advance`, and one session switching models would fill the conversation the user follows with tool output.
- **Step agents cannot advance, hand off, ask the user, unlock or report progress**: `advance`, `handoff`, `unlock` and `AskUserQuestion` are withheld from their specs, and the mod also refuses `advance`, `handoff`, `unlock`, `progress` and `finish` by `agentId`, so a gate stays the user's answer in a dialog the conversation raised.
- **The mod hands the next step over when a build agent's run ends, instead of trusting the agent's report**: `verify` called from an agent records it, and its `turn.complete` makes the mod ask the next-slice dialog and submit the next step, because a report is prose the conversation may misread or skip.
- **A gate's Continue returns the next phase prompt in the same conversation**: typing `/workflow next` after each gate was the empty prompt the user wanted gone. `/workflow next` stays for resuming by hand in a fresh context.
- **The intake is its own phase and writes nothing, and an empty write scope now refuses every write**: the band shows it, a resumed workflow knows whether it happened, and its gate leads to the model question. An empty `writes` used to allow everything, which would have left the intake unguarded.
- **Each step has a default model and effort, changed in the Models panel or one dialog per step when the panel cannot be shown**: the defaults suit the Pro plan without a question, the plan changes only through the user's answers, and the dialog keeps a narrow terminal working. Fable and `max` are never offered.
- **Fixes in inspect run without the slice lock, test-first with every check, and the next review round checks them**: lock and verify belong to slices, and a "fix" mode tracked by the mod would add state and refusals for work the next round already checks.
- **The review loop stops after 3 rounds and asks the user**: a blocker or major still open after three fix rounds needs the user's decision more than another round.
- **The worktree is removed only when clean and pushed, without `--force`, after the user's yes, checked again at removal time**: the removal deletes files, so every check fails closed. The branch is deleted only when it points at its upstream's commit, and the dialog names the ignored files (`.env`, `node_modules/`) that `git worktree remove` deletes without asking.
- **Whether the session can leave the worktree comes from the `EnterWorktree` call the mod saw, not from `$.session.root()`**: root follows a worktree move too, so it cannot tell a session that entered the worktree, which `ExitWorktree` can leave, from one that started there. `finish` needs the yes kept in the mod's memory, so Claude cannot remove a worktree on its own; after a reload it points to `/workflow done`.
- 2026-11-12: **The next phase or slice is handed over in a turn of its own**, replacing the gate's Continue returning the next phase prompt in its result: `$.agent.register` applies from the next turn, so the gate, a plan change or a verified slice that registers the step agents again ends the turn and the mod submits what comes next as a prompt. Spawning in the same turn would run the agents as they were registered before.
- 2026-11-12: **The model question is asked on Stop here at the intake too**, not only on Continue: Stop here confirms the intake as well, and without the question the workflow paused on the default plan with Claude's recommendations lost. On Stop here the choice ends without a phase prompt, and `/workflow continue` resumes.
- 2026-11-12: **Continue sets the workflow active**, and so does every next step that goes on: a workflow paused by an earlier Stop here would otherwise stay paused, and the write scope and the shell scope watch run only while a workflow is active, so the phase after the gate ran unguarded.
- 2026-11-12: **`ExitWorktree` with `action: "remove"` is refused for a workflow's worktree**, when the session is inside it or entered it, and when git cannot resolve either repository: that removal deletes the worktree and its branch with none of the ending's checks. Shell commands that delete a worktree are left to the permission system.

## 2026-11-23: the intake starts from the user's description

- **The intake invites the user's own description first, then asks only about the points it leaves out or leaves unclear**, replacing five fixed questions asked up front: the user found the form asked too much and made them repeat what they had already said. The five points (problem and for whom, result, how success shows, limits, out of scope) stay the checklist and the shape of the restatement, and a point the user clearly does not care about is restated as "not stated" rather than pressed.

## 2026-11-23: the model choice shows the defaults

- **The model question at the intake's gate lists the default plan and what Claude's recommendations change**, built from `DEFAULT_PLAN` and the steps this workflow runs: the user did not remember the defaults, so "Use the defaults" and "Use Claude's recommendations" could not be compared. `$.ui.ask` takes option labels only, with no description, so both lines go in the question under it; the labels stay short and fixed, since the answer is compared with them exactly.
- **The Models panel lays out aligned Step, Model, Effort and Default columns**, with the step name and "changed from <default>" in the theme's suggestion colour on a row that differs, and a recommendation line only under the steps Claude recommended: the panel was usable but read as a list, and a "No recommendation" line on every other step was noise. The width at which the columns show is now computed from them, so the Default column never wraps; a narrower pane keeps the stacked layout, and the one-dialog-per-step fallback is unchanged.

## 2026-11-23: prompting level and technical decisions

- **Two per-workflow settings, asked at `/workflow new`: the prompting level (`all` or `major`) and technical decisions (yes or no)**: some users want to be asked only what matters, and some want their idea built without being involved in how. Technical off removes a kind of question, the level then removes the minor ones among what remains. A workflow saved before them reads as `all` and yes, which is what it was asked under.
- **"Major" and "product versus technical" are defined once, in `guides/decision-guide.md`**, and the phase prompt and every step agent's prompt carry a short section stating the two settings and pointing to it, instead of a rule in each phase doc: one definition cannot drift. A decision not asked is taken with the recommended option and recorded in the spec's Decisions taken or the design's Decision, so the user can read it later.
- **With technical off, the mod's own technical dialogs are skipped rather than asked**: the gates of setup, design, slice and inspect go on as if Continue, logged in the state; the intake's model choice uses Claude's recommendations, or the defaults, and says which; the next-slice question is not asked and the slices chain even if `auto_next` says no. The user's words were "you should not ask for approval and just run". Each phase's kind is decided in one table in `src/phases.ts`; the retro counts as product, since the user picks each change to their own setup.
- **The intake, spec and retro gates, the unlock, the push, the worktree removal, the branch question and the retro offer are always asked**: they decide what is built, guard safety or answer the user's own command. The push stays asked because the global CLAUDE.md forbids pushing unless asked.
- **Which question Claude asks in chat is the prompt's to rule, not a guard's**: the mod cannot tell a technical question from a product one, so the map offer and the inspect minors, which Claude asks, follow the prompt; the tests check the prompt says so for each combination that changes it.
- **One dialog per setting**: `$.ui.ask` asks one question. `$.tool.call` of `AskUserQuestion` takes several, but its permission check "opens no dialog" and the tool's answers are collected by its permission component, so whether it would show at all was not verified.

## 2026-11-23: the band under the prompt

- **On the terminal the band is drawn in the footer under the prompt (`PromptHint`), as one line in a rounded border**: the user wanted it on top, in one line and always shown, and a mod cannot draw a header fixed at the top of the terminal, so they chose a bordered one-liner at the bottom, like the skin plugin's usage band. The hook draws `next(e)` first and adds its row under it, so the engine's hint line and the usage band stay whatever the order the two mods' hooks run in.
- **Elsewhere the band stays above the prompt (`AbovePrompt`), as one line too**: the engine's types say only the terminal draws an addition to the hint line yet, and the skin plugin keeps its usage band above the prompt on the desktop for the same reason. The survey still takes that band.
- **Finished steps in the theme's success colour, no done markers**: the user asked for the done steps in colour; theme names (`success`, `suggestion`, `warning`) follow `/theme`, where a hex code would not.
- **In one line, the steps after the current one are dropped too, then the whole list, before the sub-step is shortened**: on two lines the later steps were cut by the line's end; on one they would push out "waiting for you". The list goes before the sub-step is shortened because the sub-step names the current step anyway.
- **No new session-start hook**: `session.start` already refreshes the band when the session runs on a workflow's branch, and `/workflow continue` refreshes it once the workflow is resumed; tests now cover both.

## 2026-11-23: the closing and /workflow delete

- **`/workflow new` asks which documents stay**, with four answers (keep everything, remove the spec and ADRs, keep only the code, choose at the end): the user wanted a project to be able to end with only its code. The documents stay until the closing because the inspect phase and the retro read them.
- **One closing at the end of the last phase**, not in inspect: a project's retro ran after the pull request was open, and nothing committed what was left uncommitted, so the worktree removal refused. The closing drafts the pull request, removes the documents, asks what to commit, push and open, then approves. It is a prompt section the mod builds from `keep_docs`, so inspect and retro share it. The known issues move to `## Known issues` in `design.md` so a project's pull request still has them after the retro, across a pause.
- **`/workflow delete` replaces `done` and `abandon`**: the user asked for one command that removes a workflow and its files, and offers to remove the worktree when it still exists. The retro offer that `done` made goes with it: the retro runs through the inspect gate. The record is deleted after the removal offer, because afterwards the mod can no longer offer it; when the worktree cannot be removed, the user chooses between deleting the record anyway and cancelling.
- **`.claude/workflow.json` is not deleted by `/workflow delete`**: the user suggested it, but it holds the repo's commands for every workflow and the next `/workflow new` reads it. It goes only through "Keep only the code", and only when the branch added it.

## 2026-11-25: structured gates that start nothing

- **The gate dialog is built by the mod from lists, not from a free-text summary**: Claude sent one 900-character paragraph, unreadable in a dialog. `mcp__workflow__advance` takes `produced`, `decisions`, `risks` and `open`, and the mod prints one dash line per item under a label; a missing required field is refused before any dialog, so a gate never shows an empty approval.
- **At the intake the gate is the restatement**: Claude asked "Is this restatement correct?" in a dialog of its own without ever writing it, and the gate then showed the same content again. The gate now carries the five points (`problem`, `result`, `success`, `limits`, `outOfScope`), saves them as the goal on Continue or Stop here, and a correction sends Claude back to amend them and call `advance` again. `mcp__workflow__handoff` lost its `goal` input, since nothing sets the goal there any more.
- **A gate no longer starts the next phase: it fills `/workflow continue` in the prompt box**: the prompt submitted from inside the tool call, while Claude's turn still ran, reached the conversation late or never (twice in one run, over an hour of waiting). The user presses Enter, which also gives the phase a turn of its own where the agents registered at the gate are spawned as registered. This replaces the 2026-11-12 hand-over for gates, for a conversation's `verify` and for the Models panel. A build agent's end of run still hands the next slice over by itself: that path works and stays.
- **What the user must read to answer goes inside the dialog**: text written just before an AskUserQuestion is hidden behind it, so the "Leading the user" rules put it in the question or in an option's `preview`.

## 2026-11-25: slices build in parallel lanes

- **A workflow that commits builds up to 3 slices at a time, each in a lane: its own git worktree `<worktree>-s<N>` on its own branch `<branch>-s<N>`, made from the workflow branch**: the user wanted the build parallel. Separate worktrees keep the agents' files, test runs and git indexes apart; a branch per slice gives each a merge of its own. 3 is a constant: more lanes spend more of the Pro plan's shared usage window at once and make conflicts likelier. With commits off the build stays sequential in the workflow's worktree, as before: a lane only reaches the workflow branch through commits, and a user who commits by hand would get commits they did not write.
- **The mod merges a lane, not the agent**: once a lane's agent verified its slice and its run ended, the mod runs `git merge --no-ff --no-commit` in the workflow's worktree, ticks the slice in `slices.md`, commits `feat: merge slice N (<name>)`, folds the lane's locked tests into the workflow lock, then removes the worktree and deletes the branch, never forced. Ticking at the merge means `slices.md` is only written in the workflow's worktree, and a slice counts as done only once its code is on the branch. The merge waits for the end of the run so the agent's commit is in. A conflict or any other failure aborts the merge and keeps the lane; a `workflow:build` agent spawned with "Resolve the merge of slice N" goes back into it, merges the workflow branch in and calls verify again, which checks the still-locked tests on the merged code.
- **The merge needs both worktrees clean**: `git merge --abort` cannot always give back changes that were uncommitted when the merge started, and the workflow's worktree may hold the user's own.
- **An `agent.spawn` hook sends the agent into its lane**: measured on 2.1.325, the hook can rewrite `cwd` and `prompt`, and inside the subagent's tool calls `$.session.cwd()` returns the lane, so the context, the guards, the lock and the runs find the lane by its branch on their own. The conversation spawns each slice with an exact prompt ("Build slice N of `<slug>`."), which the hook reads to pick the lane, and to deny a slice that is done, not ready, already building or over the limit, naming what to spawn instead. The lane is reserved in the state before git creates it, so spawns sent in one message never share a slice or pass the limit. The registered `workflow:build` agent holds no slice any more: the hook adds it to the prompt, so the agent is no longer registered again per slice.
- **Each lane has its own lock, runs and tree index**: two `git add -A` on one `GIT_INDEX_FILE` race. A lane's first lock starts from the workflow lock, so a line removed from a test a merged slice locked is still refused.
- **Every read-modify-write of a workflow's state goes through a queue per workflow**: lanes lock and verify at the same time, and two concurrent updates of one state file lost one of them in a test.
- **A hand-over waits for the main loop**: lanes end at any time, often during a turn, and a prompt submitted during a turn was seen to arrive late or never. It is submitted at once when the band says "waiting for you", otherwise at the end of the conversation's turn, joined with any other that waited.
- **After each merge the conversation runs the green checks in the workflow's worktree**: slices verified apart can break together. A failure goes to `workflow:build` with "Fix the integration of `<slug>`.", which fixes it test-first without the lock, as the inspect phase fixes findings, and commits the fix.
- **An optional `worktreeSetup` command readies a lane**, an install from the lockfile that the agent runs first in its folder: a new worktree has no dependencies. Nothing ignored or secret is copied into a lane.
- **The merges of one workflow run one at a time**, each reading `slices.md` and the workflow lock after the merge started: two lanes ending together each read them before the other saved, so a tick or a locked test was lost, and one merge's abort ended the other's. `merge --abort` runs only when `MERGE_HEAD` exists.
- **A merge that would drop a line of a locked test is never committed**: a resolution that kept one slice's version of a shared test passed every check. A test the user unlocked, in the lane or in the workflow's worktree, may change, and its new content is locked again at the merge. In a lane, a locked test may change without an unlock only while the lane merges the workflow branch's tip in (`MERGE_HEAD`, or `HEAD^2` once git committed the merge), and only to exactly what `git merge-file` makes cleanly of the lane's version, the version the lane started from and the workflow lock's: a rule on lines alone let an import be swapped for a stub, an expect be moved or a line be doubled. A conflict inside a locked test is restored, and the agent stops and puts it to the user.
- **A hand-over waits for the conversation's own loop, not for the band**: the band says "waiting for you" while a dialog of the mod is open in the middle of a turn. The loop is busy from each `turn.start` to each `turn.complete` of the main loop, a command's turn and one started without a typed prompt included. At a turn's end the queue goes after a tick, and only if no turn started in between, such as the one a prompt the user typed during the turn starts: the engine runs a plugin's prompt once the session is idle, in order with the user's queued ones, so the mod keeps no count of them, which a prompt delivered into the running turn left stuck.
- **A lane waits when the workflow's worktree is dirty**: it stays verified and the mod merges it at the next lane end or at `/workflow continue`, instead of spawning an agent that has nothing to do.
- **Every slice needs a `Depends on:` line**: without one a slice silently counted as independent and built in parallel with what it needed. The slice gate refuses a slice without it, and a slice whose dependencies cannot be read never starts.
- **Lane files live under `lanes/<slug>/<N>`** (`locks/`, `runs/`, and the tree index in the state folder): `<slug>-s<N>` was also the name of a workflow such as `migrate-to-s3`. The name refuses a slug that is not a plain file name and a slice that is not a positive whole number, so every writer inherits the check.
- **When no slice can start and no lane runs, the next step names what is wrong in `slices.md`** (from the gate's own check) instead of waiting for lanes that do not exist, and the workflow is not paused for it.
- **`/workflow delete` removes the merged lanes after the user agreed, and before the workflow's worktree**: `git branch -d` checks a lane against the workflow branch, which the removal of the worktree takes away.
- **A lane's first lock starts from the workflow lock as it stood when the lane was made**, saved beside the lane's own: seeding from the lock as it is at that lock refused, in the normal parallel case, the tests another lane merged since, which the lane's worktree never had. Those reach the lane only through its merge of the workflow branch, and the mod's merge still refuses a lost line.
- **A slice locked in the workflow's worktree before lanes existed finishes there**: lock and verify run outside a lane while the workflow lock is green, and the lanes start once it is verified.

## 2026-11-25: markers on the two-sided band

- **The finished steps carry a check and the current one a dot**: the user chose them with the band split in two sides (the phase status on the left, the steps on the right), where colour alone no longer told the steps apart at a glance. This replaces "no done markers" in the 2026-11-23 band entry; the colours stay theme names.
