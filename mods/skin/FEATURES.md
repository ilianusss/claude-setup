# Features

Everything the skin mod does, by area. "Desktop" is the desktop app's Code tab; "terminal" is the
CLI. Each part named in `code` switches with `/skin <part> on|off`. Where the code lives:
[docs/architecture.md](docs/architecture.md).

## Tool calls

- **Tool rows**: an icon per kind (read, write, run, search, web, MCP), a spinner while running, the
  target (path, command, pattern), lines changed (`+N −M`) and the time taken. On the terminal each
  call is a node on the turn's coloured `rail`; on the desktop an icon leads the row.
- **Open a row** with `▸`: the call's input in full and its answer — a read's text with line numbers,
  a search's matches, the shell card, the diff. A failed call opens by itself.
- **Groups**: a run of reads and searches collapses to one line (`Read 3 · Search 2 ▸`); `expand`
  opens every group instead.
- **`quiet`**: reads, searches and read-only commands fold to one row; a failure keeps its error line.
- **Files this turn touched** are coloured in rows and prose: created (`ok`), edited (`warn`).
- Agents, plan mode, todos and the permission prompt keep Claude Code's own rows.

## Edits and diffs

- **Edits** as a diff card with `+N −M` and numbered lines (desktop); Claude Code's own diff on the
  terminal and for failed edits.
- **` ```diff ` fences** as the same card (desktop) or numbered old/new rows (terminal), the code
  highlighted in the language its `+++` path or a ` ```diff-<lang> ` tag names, with Copy and
  `new only` (the code after the change).

## Shell output (`shell`)

- A card with the command, `✓` or `✗ exit N`, stderr apart in the error colour, paths, numbers and
  error/warning/pass words coloured.
- Folded: terminal 8 + 4 lines per stream, desktop 6 + 6; `▾ N more` / `▴ less`.
- **`clip`**: when the card is off, trims Claude Code's own shell output to its head and tail.
- Background commands and image output keep Claude Code's row.

## Replies

- **Tables**: a card with a header band, zebra rows and colour swatches (desktop), a cell grid with a
  header band (terminal). `/skin tables text` keeps them selectable on the desktop; `off` gives them
  back. Long cells wrap in full on the terminal; past 14 rows they fold.
- **Code blocks** (`highlight`): a framed card with the language, line numbers and highlighting in the
  skin's colours — TS/JS, JSON, shells, PowerShell, Python, Rust, Go, C/C++, C#, F#, Java, YAML, TOML,
  HTML/XML, CSS, SQL, diff, Markdown, Lua. Past 24 lines they fold. Shell fences on the desktop keep
  the app's block (and its Run button).
- **Mermaid charts** (`charts`): flowchart, xy, pie, gantt, timeline, journey, kanban, mindmap,
  quadrant, radar, sankey, gitGraph, treemap, packet, block, architecture, C4 — vector cards on the
  desktop, drawn in cells on the terminal (plus sequence, state, class and ER there). Too big → rows
  for flowchart/xy/pie, else the code. `hints` tells the model charts draw here (~130 tokens, never
  for headless runs).
- **Math** (`math`): `$$…$$`, `\[…\]` and ` ```math ` typeset as a card (fractions, roots, sums,
  integrals, matrices, aligned lines) or stacked in cells; inline `$…$` becomes Unicode.
- **Markdown** (`markdown`): GitHub alerts (`> [!NOTE]`…) as titled boxes, task lists with ticks and a
  done count.
- **Links** (`links`): URLs as OSC 8 links where the terminal supports them (`FORCE_HYPERLINK`
  overrides), the app's links on the desktop; paths with `:line`, numbers and versions coloured.
- **Side by side**: tables and charts in a row share it when they fit.
- **Copy** (`copy`): a button on every card, tables also `as text`, `copy reply` under multi-block
  replies, and on your prompts on the terminal; `/skin copy` and `/skin copy code`.
- **Fold** (`fold`): long code, tables and shell output fold behind `▾ N more`.
- **Command output** (`commands`): `/cost`, `/context` and plugin output — tables, code and
  `key: value` runs — drawn as cards.
- Cards animate once on first draw (never replayed, reduced motion respected).
- A reply block over 9,000 characters keeps Claude Code's drawing.

## Around the transcript

- **Your prompts** (terminal): a rounded outline, on the left or right (`/skin prompt`), or a plain
  marker, with Copy on the outline (after the text when plain). The desktop keeps the app's
  messages (copy, rewind, selection).
- **Spinner**: the skin's words with a band of light (`shimmer`) on the terminal; an animated icon per
  phase on the desktop. `/skin words claude` keeps Claude Code's words.
- **Turn footer**: the skin's past-tense word, the time, tools used and lines changed.
- **Usage band** (`band`): prompt-cache warmth (`warm cache · 52m`, `cold cache`), a context meter with
  tokens (`42% context · 84k/200k`), session and week plan limits with time to reset (`countdown`).
  Above the prompt on the desktop, the footer under it on the terminal.
- **Compact** (`compact`): a Compact button in the band, a nudge from 70% context (`0` presses it on the
  terminal); never mid-turn.
- **Question band**: AskUserQuestion's headers above Claude Code's own dialog.
- **Calm** (`/skin calm`): no motion, no rail line per row, read-only output folded, failures whole;
  `calm off` restores what was there.

## Skins

The skins are the palettes of the theme home `SKIN_THEME_HOME` names, `~/.theme`
([docs/theme-home.md](docs/theme-home.md)):

- Each palette is a skin: derived from its base16 colours, with `claude_<slot>` keys overriding
  single colours and `claude_spinner` / `claude_done` giving its words; drawn as-is for the
  terminal's background.
- Picking a palette runs `theme colors <name>`: Ghostty, Neovim and the prompt follow.
- `theme colors` anywhere (a shell, another session) moves every session's skin within ~2 s.
- Without a theme home, the built-in `miasma` skin draws.
- **Settings pane** (`/skin`): palettes with number hotkeys, a live preview, every part, the
  palette's swatches.
- **Per-folder looks**: `/skin pin` keeps this folder's parts, `unpin` drops them, `share` makes them
  the default; the skin always follows the theme home.
- **Gallery** (`/skin gallery`): every element the skin draws, numbered, to point at.
- **Icons**: `/skin icons ascii` for fonts without the glyphs (ASCII diagrams on the terminal too).

## For other plugins

- `$.skins.markdown({ surface, text, columns })` draws markdown the way the skin draws a reply.
- Replies the `skin-code` mod draws are left to it.
