# Changelog

## 1.0.0

- The Help panel, one per session: `HELP>` search as you type, Back / Forward / Topics, breadcrumbs, a Sections
  list, "See also", and linked `help <topic>` references.
- Sources: GMCP `Client.Help 1`, Evennia's `Help.View` / `Help.Search`, or the game's printed help. Chosen
  automatically for each world, or set in settings.
- Typed `help …` and `helpsearch …` open in the panel. Turn this off with Settings → Text → Help in its own panel.
  It is always off in screen reader mode.
- F1, a ☰ menu row, `?topic` in Ctrl+K, and Look up in Help on a word or a selection.
- A 60-page cache with 100 steps of history. A page the game doesn't answer for falls back to the cache.
- An API for other extensions: `open`, `show`, `page`, `provideSource`, `dialect`.
