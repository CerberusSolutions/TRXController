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
