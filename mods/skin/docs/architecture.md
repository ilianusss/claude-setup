# Architecture

The skin is a Claude Code **function-hooks mod**: `hooks/hooks.json` names one module,
`hooks/register.tsx`, whose `register(on)` hooks engine events (`session.start`, `ui.render`,
`command.run`, …). A render hook gets an event `e` and the engine `$`, and answers an element tree, or
`next(e)` to keep Claude Code's own drawing. What it draws is listed in [FEATURES.md](../FEATURES.md);
where its colours come from, in [theme-home.md](theme-home.md).

## Rules

The engine enforces the first two when it loads the module (`claude plugin test` and `claude plugin
validate` report them):

1. **Only `src/engine/` touches `$`**, and `$` crosses a file boundary only into a `function`
   declaration: passing `$` to an arrow function imported from another file fails to load. Every
   engine helper is `export async function x($: EngineInterface, …)`.
2. **`read` / `update` must name an atom declared in the same file.** So all session state lives in
   `src/engine/state.ts`, which exports one small accessor per atom (`getPrefs`, `setPrefs`,
   `durationOf($, e)`, …). Nothing else imports `atom`; add an accessor rather than an atom elsewhere.
3. Everything outside `src/engine/` is pure (no `$`) and unit-tested.
4. Every prefs change goes through `commit()` in `src/engine/prefs.ts`.
5. `types/index.d.ts` is the public contract: self-contained, no imports.
6. A hook failure that costs one drawing goes to `debugLog($, 'prefix: ')`; nothing throws out of a
   hook that gates the session.
7. A user-visible change updates FEATURES.md and, for a command, `helpText()` in
   `src/prefs/command.ts`.

TypeScript strict, no semicolons, single quotes, 2-space indent, `h`/`Fragment` JSX. Comments say
why, briefly.

## Layout

```
hooks/
  hooks.json          names register.tsx
  register.tsx        wires the engine modules, nothing else
src/
  engine/             the only code that touches `$`
    state.ts          every atom + accessors, `live` (per-session values), `Turn`, debugLog
    lifecycle.ts      session.start (register /skin, load, timers), clear/resume reload, turn and tool
                      events (timings, touched files, stats)
    prefs.ts          load (theme home + prefs + pins), commit (the one path for a prefs change; it
                      runs `theme colors` for a new palette), pin/unpin/share, reload on a new session
    command.tsx       /skin, the settings pane, the gallery pane
    render-tools.tsx  ToolUse, ToolGroup, ToolResult
    render-reply.tsx  UserMessage, AssistantMessage, CommandOutput, the chart hint (prompt.compose)
    render-chrome.tsx Spinner, TurnDuration, AbovePrompt / PromptHint (usage band), AskUserQuestion
    look.ts           activeSkin, the Look a drawing gets, links, copy
    entrances.ts      card entrance animations: play once, then settle
    usage.ts          usage band data: context, plan limits, countdowns, prompt cache, Compact
    theme-home.ts     SKIN_THEME_HOME, palettes, stamp poll, `theme colors`
    api.ts            $.skins.markdown for other mods
  skins/              skin data and logic (pure)
    skin.ts           Skin, Palette, SLOTS, icon sets
    default-skin.ts   miasma, drawn without a theme home; its words fill palettes that name none
    theme-home.ts     palette file → Skin (base16 derivation, claude_<slot>, claude_spinner/done)
    catalog.ts        which skins exist: the theme home's palettes, or miasma alone
  prefs/              command.ts (Prefs defaults, /skin words, list, help), folders.ts (pins)
  ui/                 element builders (pure): look.ts (Look type), rows.tsx (tool, prompt, spinner,
                      footer rows), reply-rows.tsx (reply layout, tables), cards.tsx (card images and
                      copy controls), band.tsx (usage band), settings.tsx, gallery.tsx, …
  markdown/           reply splitting, blocks, links, highlighter, diff fences, command output
  charts/             Mermaid parse/layout, terminal art, SVG charts
  math/  svg/  tools/  util/
  vendor/             mermaid-ascii.js, bundled from beautiful-mermaid by scripts/vendor (never edit)
types/index.d.ts      public contract: Prefs, state shape, $.skins (must not import anything)
tests/                claude-code/testing: pure tests and engine tests with stubbed events;
                      fixtures.ts holds sample palettes for the pure drawing tests
scripts/vendor/       `npm install && npm run build` there after bumping beautiful-mermaid
```

## Flow

1. **`session.start`** registers `/skin`, then `load()`: find the theme home and read its palettes,
   read prefs from the mod's store (per folder when pinned), fill the atoms, start the stamp poll,
   read terminal capabilities; then usage and timers.
2. **Drawing**: each render hook calls `activeSkin($)` (prefs + theme home) and either answers
   `next(e)` (skin off, or not ours to draw) or builds elements with a `Look` (`ui`, `skin`, `prefs`,
   `surface`, optional `svg`, `copy`, `links`, `touched`, `folds`). Reading an atom subscribes the
   drawing: a write redraws it.
3. **Changes**: `/skin …` → `runSkinCommand` (pure) → `commit()` → atom + store (+ `theme colors` for a
   new palette). The settings pane calls the same `commit()`.
4. **New session without session.start** (`/clear`, `/resume`, plan guards): the first appended row or
   `classic.SessionStart` reloads (`reloadIfNewSession`).

## State and storage

| What | Where |
|---|---|
| Prefs, pinned folders | the mod's store (`$.store`: `prefs`, `folders`), a JSON file Claude Code keeps per plugin in `~/.claude/plugins/store/` |
| Palettes | `$SKIN_THEME_HOME/colors/*/palette`, selection `current/colors`, signal `generated/stamp` |
| Session state | atoms in `src/engine/state.ts` (reset by /clear) |

## Adding a part (an on/off setting)

A part is a boolean in `Prefs`, switched by `/skin <word> on|off` and a settings-pane button.

1. **Type**: the field, with a one-line comment, in `Prefs` in `types/index.d.ts`.
2. **Defaults and parsing** (`src/prefs/command.ts`): its default in `DEFAULT_PREFS`; `word: 'field'`
   in `TOGGLES`; `field: flagOr(saved.field, DEFAULT_PREFS.field)` in `parsePrefs` (stored prefs may be
   old); a row in `listing()` and in `helpText()`.
3. **Command hint**: the word in `argumentHint` in `src/engine/lifecycle.ts`.
4. **Settings pane** (`src/ui/settings.tsx`): `{toggle('word', '<free hotkey>', prefs.field)}` in the
   Look row; check the other `toggle(...)` calls for a free hotkey.
5. **Use it** where it draws: `active.prefs.field` in `src/engine/render-*.tsx`, or `look.prefs.field`
   in a pure builder under `src/ui/`. Off means Claude Code's own drawing or nothing, never a
   half-drawn row.
6. **Calm**: if calm should change it, extend `CalmSnapshot` and `withCalm` together.
7. **Docs and tests**: FEATURES.md; a `runSkinCommand('word off', …)` case in `tests/logic.test.ts` and
   an engine test in `tests/rows.test.tsx` that mounts the row with it on and off.

## Checks

```sh
claude plugin test mods/skin        # every test; must stay green
claude plugin validate mods/skin
npx -y -p typescript@5.6.3 tsc -p mods/skin   # once the mod has loaded once (.claude-plugin/types)
```
