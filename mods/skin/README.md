# skin

A Claude Code mod that redraws the transcript in the colours of the `~/.theme` palette: tool rows, cards for tables, code, diffs, shell output, math and Mermaid charts, and a usage band.

## Role in the system

It is one of the mods of the `~/.claude` setup, loaded through `CLAUDE_CODE_PLUGIN_DIRS` in its `settings.json`. Its skins are the palettes of the theme home that `SKIN_THEME_HOME` names, kept in the [dotfiles](https://github.com/ilianusss/dotfiles) repo, and picking one runs that repo's `theme colors`. Only the drawing changes: the conversation and what the model reads are untouched.

## Prerequisites

- Claude Code 2.1.308 or later. Mods use an early-access API that may change between releases.
- A theme home with a `colors/` folder, named by `SKIN_THEME_HOME`. Without one, only the built-in `miasma` skin draws.

## Getting started

Start a session: the skin of the selected palette draws. Type `/skin` to open the settings.

## Commands

`/skin help` lists every command; [FEATURES.md](FEATURES.md) says what each part draws.

## Project structure

```text
hooks/      the module Claude Code loads
src/        the engine hooks (src/engine) and the pure drawing code
types/      the public contract: prefs, state, $.skins for other mods
tests/      claude plugin test suites
scripts/    the build of the bundled Mermaid renderer
docs/       architecture and the theme home contract
```

## Documentation

- [FEATURES.md](FEATURES.md): everything the skin draws, by area.
- [docs/architecture.md](docs/architecture.md): the layout, the rules the engine enforces, adding a part, the checks.
- [docs/theme-home.md](docs/theme-home.md): how palettes become skins, and what to check when the skin does not follow.
- [docs/decisions.md](https://github.com/ilianusss/.claude/blob/main/docs/decisions.md) of the setup repo: why it lives here.

## Development

```sh
claude --plugin-dir mods/skin       # a session with the mod loaded, reloaded on save
claude plugin validate mods/skin    # what the engine would refuse
claude plugin test mods/skin        # the test suites
```

## License

MIT, see [LICENSE](LICENSE). Forked from [hellosverre/claude-skins](https://github.com/hellosverre/claude-skins).
