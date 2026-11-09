# The theme home

The skins are the palettes of one `theme` folder (the author's `~/.theme`, whose `theme` command also
sets the colours of Ghostty, zsh and Neovim), and the two directions stay in sync. The other side of
this contract is `~/.theme/AGENTS.md` (its palette table lists the `claude_*` keys) and its
`add-palette` skill: change both together.

## Turning it on

Set `SKIN_THEME_HOME` to the theme folder, in Claude Code's settings (user, project or `--settings`):

```json
{ "env": { "SKIN_THEME_HOME": "~/.theme" } }
```

or in the shell that starts Claude Code (`export SKIN_THEME_HOME=~/.theme`; the process environment
wins over settings). `~` and `$HOME` are expanded. The folder counts only when `<home>/colors/`
exists. Without one, the built-in `miasma` skin (`src/skins/default-skin.ts`) is the only skin.

## What it reads

| Path under the theme home | Use |
|---|---|
| `colors/<name>/palette` | one skin per folder, named `<name>`, labelled by its `name=` key |
| `current/colors` | symlink to the selected palette folder: the skin in use |
| `generated/stamp` | rewritten by every `theme apply`: polled (mtime, every 2 s) to follow changes |
| `bin/theme` | run as `theme colors <name>` (with `THEME_HOME=<home>`) when a skin is picked |

A palette is `key="value"` lines (`#` comments). Keys used:

| Key | Use |
|---|---|
| `base00`..`base0F` | required; the derived skin (below) |
| `name` | the label |
| `claude_<slot>` | optional: one slot's colour, `"#rrggbb"` (slots: `user fg muted surface zebra ok err warn read write run search web mcp other`) |
| `claude_spinner`, `claude_done` | optional: the spinner's gerunds and the turn footer's past-tense words, comma-separated (`"Purring,Curled up"`); without them, miasma's |

Derived from base16, then each `claude_<slot>` over it:

| Slot | base16 | | Slot | base16 |
|---|---|---|---|---|
| `fg` | 05 | | `read` | 0D |
| `muted` | 04 | | `write` | 09 |
| `surface` | 01 | | `run` | 0B |
| `zebra` | mix(00, 01) | | `search` | 0E |
| `user` | 0D | | `web` | 0C |
| `ok` | 0B | | `mcp` | 0A |
| `err` | 08 | | `other` | 04 |
| `warn` | 09 | | | |

The palette is drawn as-is whatever Claude Code's light/dark setting: it was made for the terminal's
own background. A palette missing a base16 key, or with a malformed hex, is skipped (debug log).

## Behaviour

- `/skin` and `/skin list` show only the palettes; any other name is "unknown".
- `/skin <palette>` (or picking it in the pane) runs `theme colors <palette>`; a failure is a toast and
  nothing else changes.
- `theme colors <palette>` anywhere moves every open session within ~2 s; so does editing a palette and
  running `theme apply`.
- `/skin off` stays off across theme changes; `/skin on` turns on the selected palette.
- Pinned folders keep their parts; the skin always follows the theme.

## Code

`src/skins/theme-home.ts` (pure: parse, derive), `src/engine/theme-home.ts` (env, files, poll,
`theme colors`), `src/engine/prefs.ts` (`load`, `commit`), `src/skins/catalog.ts` (which skins exist).
Tests: `tests/theme.test.tsx`.

## When the skin does not follow

1. Theme home found? `/skin list` shows `skins from <home>/colors`. If it says "no theme home",
   `SKIN_THEME_HOME` is unset or `<home>/colors` is missing (`claude --debug` shows the mod's debug
   lines).
2. Palette skipped? A missing base16 key or bad hex is logged as `palette <name>: …`.
3. Shell switch not seen? `theme apply` must rewrite `generated/stamp` (check its mtime).
4. `/skin <palette>` toast `theme colors … failed`: run `~/.theme/bin/theme colors <palette>` by hand;
   `bin/theme` needs zsh on PATH.
