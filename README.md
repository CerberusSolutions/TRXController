# TRXController

A modern Windows remote-control and logging app for the Whistler TRX-1 / TRX-1E / TRX-2
digital scanners, replacing Whistler's own remote control software.

- Protocol spec: `docs/Whistler_Remote_Control_Protocol_v1_7.pdf`
- Working notes on the protocol: `docs/protocol-notes.md`
- Protocol library: `packages/rcip`
- Hardware probe: `scripts/probe.ts`

## Stack

Electron + Vite + React + TypeScript, Tailwind, `serialport` in the main process,
Zustand in the renderer, Node's built-in `node:sqlite` for the reception log. Windows only.

## Getting started

```
npm install
npm test                      # protocol library unit tests
npm run probe -- --list       # list serial ports
npm run probe -- COM7         # query the scanner on COM7
npm run probe -- COM7 --identify   # walk the unlabelled key codes
npm run dev                   # run the Electron app with hot reload
npm run build && npm start    # run the built app
```

## Optional data

- **DMR user database**: download the user export from radioid.net
  (<https://radioid.net/static/user.csv>), then Data > Import.
- **Ofcom Wireless Telegraphy Register**: download the WTR CSV from Ofcom
  (<https://static.ofcom.org.uk/static/radiolicensing/html/register/WTR.csv>), set your
  location in Data, then Data > Import WTR CSV. Heard frequencies then show the nearest licensees.

The same links and steps are on the app's help screen (the `?` button; shown on first run).
Put downloads in `data/` (git-ignored).

## Windows installer

```
npm run dist        # release/TRXController-Setup-<version>.exe (NSIS, per-user)
npm run dist:dir    # release/win-unpacked/ only, for a quick check without installing
```

Run `npm run dist` on Windows (the NSIS step needs Wine anywhere else; `dist:dir` works on Linux).
electron-builder config is `electron-builder.yml`; the icon is `build/icon.ico`. The installer
is unsigned, so SmartScreen shows a warning the first time it runs. The app installs under
`%LOCALAPPDATA%\Programs\TRXController` and keeps its log, settings and imported data in
`%APPDATA%\TRXController`, the same folder the dev build uses, so nothing needs re-importing.
The last port used is reopened at launch.

## Status

Beta, from Cerberus Systems, for the TRX-1 / TRX-1E / TRX-2. Provided as is with no warranty or
guarantee of any kind. Not affiliated with Whistler.

See `CLAUDE.md` for the design constraints.
