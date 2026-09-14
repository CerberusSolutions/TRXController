# TRXController

Modern Windows remote-control and logging app for the Whistler TRX-1 / TRX-1E / TRX-2
scanner (also WS-1080/1088/1095/1098). It replaces Whistler's own remote control
software. The protocol spec is `docs/Whistler_Remote_Control_Protocol_v1_7.pdf`
(Remote Control Interface Protocol, "RCIP"); `docs/protocol-notes.md` is the
condensed, code-oriented reading of it. Read both before touching the protocol code.

## Stack decisions (do not reinvent)

- Electron + Vite (via `electron-vite`) + React + TypeScript. Windows is the only target.
- Tailwind CSS v4 (`@tailwindcss/vite` plugin, `@import "tailwindcss"` in `src/renderer/src/index.css`).
- `serialport` lives in the **main process only**. The renderer never touches the port;
  it talks to main over IPC exposed by the preload (`contextBridge`).
- Zustand for renderer state.
- `better-sqlite3` for logging (main process). Not yet added; add it when the logging
  layer is built, together with `@electron/rebuild -w better-sqlite3` in `postinstall`.
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
- Byte 0x93 in column 16 marks the highlighted menu line (`Lcd.cursorLine`), despite the
  spec saying cursors are not sent.
- Arrow keys: UP=8, DOWN=10, LEFT=16, RIGHT=2. RIGHT also selects the highlighted menu item.
- The `a` recording header is big-endian except its `stm` start time, which is
  little-endian (local time, yday and isdst left at zero). Confirmed on a live reception.
- Responses come back within a few tens of ms. Right after a mode change the scanner may
  not answer at all, so a polling loop must treat a timeout as "retry", never as a fault.
- See `docs/probe-results-2026-09-14.md` for the raw frames.

## Layout

- `packages/rcip/` protocol library (encoder/decoder, parsers, key table, lookup tables, tests)
- `src/main/` Electron main process (serial, IPC, later logging)
- `src/preload/` contextBridge API surface
- `src/renderer/` React UI
- `scripts/probe.ts` hardware probe, run with `npm run probe -- COM7`
- `docs/` protocol PDF and notes

## Commands

- `npm install`
- `npm test` runs the rcip unit tests
- `npm run typecheck`
- `npm run probe -- --list` / `npm run probe -- COM7` / `npm run probe -- COM7 --identify`
- `npm run dev` starts Electron with hot reload

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
- Additional reference: ARC536PRO (Uniden SDS). Not the best, but clear: an LCD-like
  panel with the channel/department/system names in large text and the frequency
  larger still, a metadata block beside it (TGID, NAC, site, UID, RSSI, mode),
  a compact keypad column on the right, and a scrolling log table underneath
  (time, frequency, TGID, channel, system, department, hits, RSSI, mode).
