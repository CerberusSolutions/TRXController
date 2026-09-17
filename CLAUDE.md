# TRXController

Modern Windows remote-control and logging app for the Whistler TRX-1 / TRX-1E / TRX-2
scanner (also WS-1080/1088/1095/1098). It replaces Whistler's own remote control
software. The protocol spec is `docs/Whistler_Remote_Control_Protocol_v1_7.pdf`
(Remote Control Interface Protocol, "RCIP"); `docs/protocol-notes.md` is the
condensed, code-oriented reading of it. Read both before touching the protocol code.

## Stack decisions (do not reinvent)

- Electron + Vite (via `electron-vite`) + React + TypeScript. Windows is the primary target; a
  macOS Apple-silicon build (unsigned, not notarised) is packaged too. Platform differences are
  confined to: window chrome in `src/main/index.ts` (`hiddenInset` + traffic lights on macOS, the
  title-bar overlay elsewhere), the top bar's padding (`window.trx.platform`), the help / status
  text (data folder, Cmd vs Ctrl), and the update link (`.dmg` on macOS).
- Tailwind CSS v4 (`@tailwindcss/vite` plugin, `@import "tailwindcss"` in `src/renderer/src/index.css`).
- `serialport` lives in the **main process only**. The renderer never touches the port;
  it talks to main over IPC exposed by the preload (`contextBridge`).
- Zustand for renderer state.
- Logging uses Node's built-in `node:sqlite` (`DatabaseSync`) in the main process.
  Electron 44 bundles Node 24, where it is available without flags, so there is no
  native module and no rebuild step (the original plan was `better-sqlite3`; switching
  back is a one-file change in `src/main/log/db.ts` if ever needed). Under the host
  Node 22 used by vitest and the probe it prints an ExperimentalWarning; harmless.
  `serialport` is N-API so it needs **no** Electron rebuild and works under plain Node
  (that is how `scripts/probe.ts` runs).
- npm workspaces. `packages/rcip` is the pure-TypeScript protocol library, with no
  Node or Electron dependencies, unit-tested with vitest. Everything protocol-related
  goes there, never in `src/main`.
- Same general approach as the author's FlexRC-28 project.

## Hard constraints

- **No direct tune. Everything is keystrokes.** The scanner exposes no "set frequency"
  or "go to object" command. The only way to change what the scanner does is the
  `K` (Send Key) command, exactly as a human would press the keys. Higher-level
  actions must be implemented as key sequences, never as invented commands.
  `src/main/scanner/macros.ts` is where those live: each step is verified against the
  LCD (menu title, cursor line, Tune Mode screen) before the next key, and the menu
  navigator finds items by label so menu order and scrolling do not matter. Click-to-tune
  on the Band tab, on a frequency in the log table, and the Tune box under the keypad are
  Main Menu > Searches > Tune Mode,
  the digits with the decimal point, then SEL (the scanner's ENTER); "Scan" is
  Main Menu > Scan. One macro runs at a time (`ScannerSession.runMacro`).
- Serial: 115200 baud, 8N1, no flow control. Remote control mode is always active;
  no special mode switch is needed.
- Frame format: `STX code data ETX sum`, `sum = (sum of bytes from code through ETX) & 0xFF`.
  Codes are case-sensitive (`A` and `a` are different commands).
- `K`, `t` and `C` produce **no response**. Do not wait for one.
- Data bytes are binary and may legitimately contain 0x02/0x03, so frames are
  delimited by known response lengths (see `packages/rcip/src/frame.ts`), not by
  scanning for ETX.

## Hardware facts (TRX-1e, CPU firmware 7.4, probed 14 Sep 2026)

- `L` returns 96 text bytes + 3 icon bytes (99 data, 103 total). The spec's "lcd96" is a typo.
- Byte 0x93 marks the highlighted menu line (`Lcd.cursorLine`), despite the spec saying
  cursors are not sent: column 16 on the main and Scanlists menus, column 0 on the Searches
  menu. Scanlists check boxes: 0x8B ticked, 0x89 empty
  (`LCD_GLYPHS` in `packages/rcip/src/lcd.ts`; unknown glyph bytes render as ▯).
- Arrow keys: UP=8, DOWN=10, LEFT=16, RIGHT=2. RIGHT also selects the highlighted menu item.
- The `a` recording header is big-endian except its `stm` start time, which is
  little-endian (local time, yday and isdst left at zero). Confirmed on a live reception.
- Responses come back within a few tens of ms. Right after a mode change, and for several
  seconds while it loads scanlists, the scanner stops servicing the port but **buffers every
  request** and answers them all in order once it wakes (Whistler's own app stalls the same
  way). So a timeout is "retry", never a fault, and after one the link waits for the line to
  go quiet (`ScannerLink.drain`) before sending more, otherwise the scanner stays several
  replies behind for good and every answer lands as "unsolicited". The session also polls
  once a second instead of every 150 ms while timeouts are consecutive, to keep that backlog
  small. Measured 15 Sep 2026 with `probe --log`: two large scanlists = 80.7 s of silence,
  26 unanswered polls, all 52 replies delivered in one burst on waking, with a few bytes of
  one reply leaking out mid-load. `link.stall` in the snapshot marks the silence (with
  `loading` when the last reply came from a menu); the top bar shows "Loading scanlists · N s"
  and the keypad is held so presses are not queued into the scanner.
- The volume / squelch bar the scanner draws while a knob is turned is **not** in the `L`
  text or icon bytes (checked with `probe --log`): nothing to show for it.
- See `docs/probe-results-2026-09-14.md` for the raw frames.

## Layout

- `packages/rcip/` protocol library (encoder/decoder, parsers, key table, lookup tables, tests)
- `src/main/scanner/` serial transport, request link, polling session
- `src/main/log/` reception tracker, SQLite log, logger glue
- `src/main/index.ts` Electron main: window, IPC handlers, wiring
- `src/preload/` contextBridge API surface
- `src/renderer/` React UI
- `scripts/probe.ts` hardware probe, run with `npm run probe -- COM7`
- `docs/` protocol PDF and notes

## Commands

- `npm install`
- `npm test` runs the rcip unit tests
- `npm run typecheck`
- `npm run probe -- --list` / `npm run probe -- COM7` / `npm run probe -- COM7 --identify`;
  `--log` prints a timestamped change log (LCD lines with raw bytes when non-ASCII, icon
  bytes, status fields, silences and how many replies were queued, stray bytes) while you
  use the scanner; `--listen` sends nothing and prints anything that arrives unprompted.
- `npm run dev` starts Electron with hot reload
- `npm run build` then `npm start` runs the built app
- `npm run dist:mac` (on a Mac) builds `release/TRXController-<version>-mac-arm64.dmg` + zip:
  `mac:` target in `electron-builder.yml`, `identity: null`, the universal darwin serialport
  prebuild kept, icon converted from `build/icon.png`. Gatekeeper needs right-click › Open.
- `npm run dist` builds the Windows installer into `release/` (electron-builder, NSIS,
  per-user, config in `electron-builder.yml`, icon in `build/`). `npm run dist:dir` stops at
  `release/win-unpacked`, which also works on Linux; the NSIS step needs Wine there, so build
  the installer itself on Windows. `npmRebuild` is off:
  serialport's prebuilt N-API binding is used as is, and only its win32-x64 prebuild is packaged.
  Only `serialport` is a runtime dependency; everything else is bundled by Vite, so keep new
  packages in `devDependencies` unless main needs to `require` them at run time.
  The installer is ~98% Electron; `compression: maximum` and `electronLanguages` (English only)
  keep it around 85-90 MB. Do not strip Chromium DLLs to go lower.
- Releases: `.\scripts\release.ps1 [patch|minor|major]` (clean tree, checkout main, pull,
  `npm version`, `git push --follow-tags`, stops at the first failure). The `v*` tag runs
  `.github/workflows/release.yml` as a matrix on `windows-latest` and `macos-latest`, which
  checks the tag against package.json, tests, builds with `--publish never` and attaches the
  exe / dmg / zip to a GitHub Release via softprops/action-gh-release. Run by hand with the
  `attach_to` input (e.g. `v0.2.7`) to add builds to a release already published without a
  version bump; blank leaves them as workflow artifacts. `ci.yml` runs test / typecheck /
  build on pushes and PRs.

## UI preview without a scanner

The renderer only needs `window.trx`. To eyeball it outside Electron, build, serve
`out/renderer` over HTTP and inject a fake `window.trx` with `page.addInitScript`
(Playwright); the session 2 screenshots were produced that way from the real frames
captured on 14 Sep 2026.

## Reception log

- A reception is a period with RF squelch open on one frequency. `ReceptionTracker`
  opens on squelch, keeps absorbing better details (the `a` header often lands a poll
  later), closes after the squelch has been shut for 400 ms (it flutters), and splits
  when the frequency changes mid-reception. Peak RSSI is kept.
- Nothing is written until the squelch has been open for 500 ms: noise bursts and the
  scanner's brief pauses on chattering frequencies are discarded (counted in memory only).
- A new opening on the same frequency and channel (same name / talkgroup, or unknown)
  within 10 s of the previous row ending reopens that row: first-heard stays, last-heard
  and `calls` move on, peak RSSI is the max. One conversation, one row. Rows are ordered
  by last activity, open rows first. Clearing the log resets the merge memory.
- DMR radio IDs resolve to callsign/name via the `dmr_users` table, imported from the
  radioid.net CSV/JSON export (Data menu). Snapshots carry `radioUser`; log rows join it.
- Ofcom Wireless Telegraphy Register: `Data > Import WTR CSV` streams the export and keeps
  25-1300 MHz, Live, channel width <= 200 kHz (drops fixed links, radar, AIS, satellite),
  collapsing the T (base transmits) and R (base receives) rows and duplicates of the same
  frequency + licensee + location, digital emission (F1W/G7W, signal-nature digit 1/2/7/9)
  beating analogue (F3E/G3E). ~58k rows from a ~206k-row export. Lookup is ±3.125 kHz
  (a quarter of the 12.5 kHz raster), nearest first from the location in
  `userData/settings.json` (lat/lon/radius, set in the Data menu). Snapshots carry the
  nearest five as `licences`; the hero shows three; receptions store the nearest as
  `licensee`; the Band tab looks it up on hover. Not in the WTR: PMR446, Simple UK/Site
  business radio, amateur, MoD/Home Office (so the P25 system stays unnamed).
- UK amateur repeaters: `Data > Import repeater list CSV` loads the RSGB ETCC list from
  https://ukrepeater.net/csvfiles.html (`repeaterlist_all.csv`, ~800 rows: callsign, band,
  channel, txMHz = repeater output, rxMHz = input, CTCSS, locator, place, lat/lon, Y flags for
  ANALOG/DMR/DSTAR/FUSION) into the `repeaters` table (`src/main/identities/repeaters.ts`).
  Lookup is ±3.125 kHz on the output or the input (`side`), nearest first, no radius cap.
  Snapshots carry the nearest five as `repeaters`; the hero shows a "Repeater" block when there
  is no WTR licence (amateur bands never have one), with colour-coded FM / DMR / D-STAR / Fusion
  pills (`--t-mode-*` tokens) and the repeater whose CTCSS matches the detected tone first
  (`rankRepeaters` in `src/shared/repeaters.ts`, since several share each channel); receptions
  store that one as `licensee` ("GB3AA · BRISTOL"). Not in the list: repeaters awaiting
  licence. The beta RSGB API (https://api-beta.rsgb.online/) may replace the CSV later.
- RadioReference (online, optional): `src/main/identities/radioreference.ts` is a SOAP 1.1
  rpc/encoded client with its own small XML parser (no dependency); `rrService.ts` caches
  results in `rr_freqs` / `rr_systems` / `rr_talkgroups` and asks the web service only when
  the squelch opens on an uncached frequency (`searchStateFreq`, then `getTrsDetails` /
  `getTrsSites` / `getTrsTalkgroups` once per trunked system), one call in flight, 1.2 s
  apart, 10-minute backoff per failed frequency. Needs the user's own premium login (Data
  menu; password encrypted with `safeStorage`, blanked in `settingsGet`) and a region
  (`stid`), plus the app key `__RR_APP_KEY__` injected at build time from `RR_KEY`
  (`electron.vite.config.ts`; `secrets.RR_KEY` in release.yml). Never commit or print the key.
  A region-wide search returns every system and channel in England on a frequency, so
  results are filtered to the user's WTR location / radius: systems by the matched site's
  lat/lon (`pickSite`: NAC, else nearest), else by the system's own centre plus its range
  (many UK sites carry no coordinates; 0,0 counts as none), conventional entries by their
  county's centre plus its range (`getCountyInfo` once per county, cached in `rr_counties`).
  No location: keep everything. With one, a system nobody can place is dropped unless the site's
  NAC matches the one heard (a county entry without a centre is kept). Descriptions are the names; alpha tags are short codes shown secondary. Snapshots
  carry `rr: RrInfo`; the hero merges RadioReference, WTR and repeater rows into one "Listed"
  block with a source pill per row; `describe()` fills a blank log name / system from the
  nearest system / channel. Details in `docs/radioreference-api.md`.
- Lookup order: `settings.lookups` (`LookupPref[]`, Data menu "Lookup order", default WTR >
  RRDB > UKR, each with an `enabled` tick) is carried on every snapshot as `lookups` so
  `describe()` and the hero rank the sources the same way: the scanner's own name always
  wins; a RadioReference talkgroup beats any licensee (registers know no talkgroups); a
  RadioReference channel description is used only when no higher-ranked licensee will show;
  the licensee is the higher-ranked of WTR / UKR with a match; an entry nobody can place
  (`distanceKm` null) never outranks one that is, in the log or the hero's Listed block, whatever
  the order. A lookup switched off is neither
  queried (main skips the WTR / repeater queries and RadioReference requests) nor shown.
- Each row stores `source` (`src/shared/sources.ts`: '' scanner, `RRDB`, `WTR`, `UKR`), the
  lookup behind the name, or behind the system when the scanner named the object, or behind
  the licensee when that is all the row will show. The tracker carries it with those fields
  (`sourceAfter`), not value by value, so a scanner name arriving a poll later clears it. The
  log's Src column adds `RID` when the row's only name is the radio ID's callsign
  (`rowSource` in `src/renderer/src/lib/sources.ts`); the hero's Listed pills use the same
  initials and colours. The CSV export has a `source` column.
- A reception the display never named (a blip too short for the object screen, or a search on
  a programmed frequency) takes the scanner's object (name, scanlist, type, system) from the
  latest row on that frequency which showed it (`LogDb.lastScannerObject`,
  `ReceptionLogger.remember`), with source `MEM` so it is never taken for a live reading; a
  live object arriving later replaces it. The Detail view's Scanner column dims it.
- Each row also keeps every source's own answer (`scannerName`, `wtr`, `rrName`, `rrSystem`,
  `rpt`) beside the chosen name, so the log's **Detail** view (Simple / Detail toggle, kept in
  localStorage) can show one column per source: Scanner · List · WTR · RRDB · UKR · Sys. Rows
  from before those fields existed fall back to the chosen name under its source's column. The
  CSV carries the same columns. `LogTable` is column-driven (`Column[]` per view); dragging a
  header divider resizes that column (px override kept per view in localStorage
  `trx.logColumns`), double-click resets it.
- Distance and bearing: `src/shared/geo.ts` (`distanceKm`, `bearingDeg`, `placeFrom`, `formatPlace`) places
  every match (`WtrMatch`, `RepeaterMatch`, `RrConventional`, `RrSystemInfo` carry `distanceKm` +
  `bearingDeg`); distances are stored in km and shown in `settings.units` (`km` | `mi`, the toggle beside
  the radius in the Data dialog, which also shows the radius in those units). Each row stores the placement
  of the identity it shows (`distanceKm`, `bearingDeg`: the licensee's licence or repeater, or
  RadioReference's site / county when RadioReference named it; the tracker moves it with the name exactly as
  `sourceAfter` moves the source) and `candidates`, everything the enabled lookups offered for the
  frequency, ranked by `candidatesFor` in `src/shared/listed.ts` (placed first, then lookup order, tone
  match leading the repeaters), which the hero's Listed block draws from the same function. The list only
  grows while a reception is open (RadioReference answers late) and survives a merge. The log's **+**
  column unfolds a row's candidates beneath it; the **Dist** column shows the row's placement; the CSV
  has `distance_km`, `bearing_deg` and a `candidates` column (one line, ` | ` separated, always km).
- Rows live in `trx-log.sqlite` under Electron's userData folder
  (`%APPDATA%\TRXController` on Windows). Hits = receptions on the same frequency.
- The renderer shows the newest 1000 rows, live-updated over `log:upsert`, in a tab
  that shares the panel under the hero with the raw scanner display. The CSV button saves
  the rows as shown (after the filter) through a save dialog (`log:export-csv`,
  `src/renderer/src/lib/csv.ts`, UTF-8 with BOM for Excel).
- "Scan" (Main Menu > Scan) counts as done as soon as the scanner goes silent after the
  key (it is loading scanlists), via `MacroHost.stalled`; tune / scan failure messages clear
  themselves after 8 s.

## Band tab (channel occupancy)

- `src/renderer/src/store/band.ts` accumulates one bin per frequency the scanner visits
  in Scan, Search, Sweeper or Monitor mode (peak/last RSSI, samples, squelch opens,
  last seen), capped at 6000 bins, in renderer memory only, until Reset.
- `BandChart.tsx` draws it as a histogram: bar height = peak RSSI, cyan fading with age,
  amber where squelch ever opened, dashed marker at the current frequency, hover
  tooltip. Step = median gap between visited frequencies; isolated single visits far
  from the rest do not set the axis range.
- It is a visual aid ("that band is busy"), not a measurement: the scanner's RSSI is
  uncalibrated and sample density depends on poll rate versus search speed.

## Theme

- Colour tokens live in `src/renderer/src/index.css` as `--t-*` on `:root` (dark) and
  `:root[data-theme="light"]`, mapped to Tailwind via `@theme inline`, so `bg-panel`,
  `text-ink` etc. follow the theme. Never hard-code a colour in a component; add a token.
- The scanner display panel keeps its dark colours in both themes.
- `ThemeToggle` (sun / moon / monitor) in the top bar sets `trx.theme` in localStorage
  and tells main over IPC; main sets `nativeTheme.themeSource`, which also flips
  `prefers-color-scheme` in the renderer (how "system" resolves) and recolours the
  window background and title-bar overlay.

## Connection memory

- `settings.json` also keeps `port` (last successful connection) and `autoConnect`. Main retries
  the remembered port every 5 s while nothing is connected, but only when the OS lists it, so an
  absent scanner never raises an error. A manual Disconnect sets `autoConnect` false until the
  next manual Connect. The renderer's port selector follows whatever main connected to.
- `settings.json` also keeps `window` (normal bounds + maximised flag, saved 400 ms after a
  resize / move). It is restored only if at least an 80 px grip of it is still on a connected
  screen; otherwise the 1320 x 780 default is used.

## Help screen and identity

- `DataDialog` (`components/DataMenu.tsx`, the Data button; `useUi.dataOpen`) is the same
  modal chrome as the help screen, two columns: lookup order, location and RadioReference on
  the left, the three data-file imports on the right. Esc / click outside closes it and the
  Keypad ignores shortcuts while either dialog is open.
- `HelpDialog` (the `?` button; opens by itself on first run, remembered in localStorage) carries
  the beta / no-warranty notice, connection steps, the two data-file download URLs with what to
  do with them, and the keyboard summary. The publisher name and URLs are constants at the top of
  that file. The Keypad ignores keyboard shortcuts while it is open.
- `app:info` IPC returns name/version from package.json for the top bar (`BETA v0.2.0`).
  `productName` is set so dev and packaged builds share `%APPDATA%\TRXController`.
- Update check: `src/main/updates.ts` fetches GitHub's `/releases/latest` (public API, no
  token) 5 s after launch and every 6 h, compares the tag with `app.getVersion()`, and
  broadcasts `app:update`; the top bar shows a "vX available" link and the help screen an
  Updates section with the installer link. Notification only, never an auto-install (the exe is
  unsigned). Failures are silent (null).
- Testing aids stay out of the normal UI: `useUi.diagnostics` (Ctrl+Shift+D, persisted in
  localStorage, `DIAG` tag in the status bar) gates the hex / copy dump on the Scanner display
  tab. Put any future debugging control behind the same flag.

## Window chrome

- Frameless: `titleBarStyle: 'hidden'` with `titleBarOverlay` so Windows draws the
  native minimise/maximise/close buttons over our top bar (46 px). The top bar is the
  drag region (`.app-drag`); interactive controls carry `.no-drag`. The header's right
  padding uses `env(titlebar-area-width)` to stay clear of the overlay.

## UI design notes (for session 2 onwards)

- Frequency display must be large and legible; signal strength and mode likewise.
  These are the things Whistler's own app gets wrong.
- The scanner does not report "which channel" directly. `A` gives the frequency
  (and mode, RSSI); `a` gives object/system/talkgroup alpha tags but only while a
  transmission is in progress. Between transmissions only the LCD text and the
  frequency are available, so keep a local frequency-to-channel lookup (seeded
  from what `a` and the LCD report over time, and/or an imported channel list) to
  label the idle display.
- Visual reference: the Uniden SDS200 web UI and Icom RS-BA1 (screenshots to be
  supplied in session 2).
- Layout decision (session 2): the frequency is the hero at the top of the main panel,
  the channel name and system/scanlist sit directly beneath it, then a parameter row
  (type, TGID, radio ID, site, squelch, control channel, start time). The raw scanner
  LCD sits below that, the keypad in a right-hand column, and the log table will go
  under the LCD in session 3. Dark theme; amber frequency digits; segmented signal
  meter driven by the LCD RSSI bars (0-5), with the raw RSSI shown as a number.
- Channel identity comes from `a` while receiving (object tag, system tag), falling back
  to the scan-mode LCD lines (line 1 scanlist, line 3 object name). For conventional
  objects the `a` info tag is just the frequency, so the scanlist is used as the subtitle.
  In Tune Mode / the searches (mode 0x12) there is no object: the `a` object tag is just
  "DMRs 145.637500" and its ID fields are empty, so `parseSearchScreen` takes TGID, radio
  ID, slot and colour code off the LCD (`-Service Search-` / `Tune Mode` / mode+frequency /
  `Slot:1  Color:15` / `RadioID:` alternating with `TGID:`). The hero shows "Tune Mode" over
  "Service Search · TG 9", the log row has scanlist "Tune Mode" and type "Search", and the
  radio ID resolves through `dmr_users` from either source (`snapshotRadioId`). Because the
  display alternates, the renderer keeps `held` details (`holdDetails` in `lib/format.ts`)
  for the current reception: every field seen while the signal is up, cleared 1.5 s after
  it drops or when the frequency changes, so TGID, radio ID and slot show together.
- Keypad rows in `src/renderer/src/lib/keypad.ts` are a design choice, not the
  scanner's physical layout. Keyboard shortcuts map onto the same table. POWER needs a
  second click within 2.5 s.
- Further references (Butel ARC DV1 PRO, ARC125): big frequency in a display panel,
  keypad beside it, history log table underneath.
- Additional reference: ARC536PRO (Uniden SDS). Not the best, but clear: an LCD-like
  panel with the channel/department/system names in large text and the frequency
  larger still, a metadata block beside it (TGID, NAC, site, UID, RSSI, mode),
  a compact keypad column on the right, and a scrolling log table underneath
  (time, frequency, TGID, channel, system, department, hits, RSSI, mode).
