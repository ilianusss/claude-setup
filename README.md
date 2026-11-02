# .claude

A Claude Code setup for fullstack and devops work; this repo is `~/.claude` itself.

## Role in the system

The setup loads two mods, both kept here: `warden`, which guards every session, and `workflow`, which runs project workflows. The old standalone [claude-workflow](https://github.com/ilianusss/claude-workflow) repo is no longer used.

## Prerequisites

- Claude Code 2.1.308 or later (the mods use an early-access API).
- git, with access to the repo.
- [rtk](https://github.com/rtk-ai/rtk), which the Bash hook calls.

## Getting started

On a new machine:

```sh
git clone git@github.com:ilianusss/.claude.git ~/.claude
```

On a machine that already has a `~/.claude`, quit every Claude Code session, then replace the folder and bring back the runtime data (memory, transcripts, history, plugins, themes):

```sh
mv ~/.claude ~/.claude.old
git clone git@github.com:ilianusss/.claude.git ~/.claude
rsync -a --ignore-existing \
  --exclude /skills/ --exclude /CLAUDE.md --exclude /RTK.md \
  --exclude '/settings.json*' --exclude /dev-mods/ \
  ~/.claude.old/ ~/.claude/
```

The clone uses SSH so changes to the setup can be pushed back. Old skills are left behind on purpose. Keep `~/.claude.old` until a week of use shows nothing is missing. Then start a session in a repo and type `/workflow`: an answer means the mods loaded.

## Commands

The daily commands are `/workflow` and its subcommands, described in [docs/workflow.md](docs/workflow.md).

## Project structure

```text
CLAUDE.md        instructions for every session
settings.json    permissions, the rtk hook, the mods to load
skills/          knowledge Claude loads on demand
agents/          the reviewer, run in a fresh context
mods/warden/     every session: em dashes, safety asks, weakened tests
mods/workflow/   the /workflow mod
docs/            how it works and how to change it
```

Everything else in `~/.claude` is Claude Code's runtime data, ignored by git.

## Documentation

- [docs/architecture.md](docs/architecture.md): how the setup is built and enforced.
- [docs/workflow.md](docs/workflow.md): using `/workflow`.
- [docs/editing.md](docs/editing.md): changing the setup, by hand or with Claude.
- [docs/decisions.md](docs/decisions.md): what was decided and why.

## Outside this repo

The swap leaves these untouched:

- MCP servers, in `~/.claude.json`: `claude mcp list` shows them.
- Skills and plugins from the claude.ai account and `/plugin`.
