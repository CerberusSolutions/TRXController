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
npm run probe -- COM7 --log        # timestamped log of display/status changes and silences
npm run probe -- COM7 --listen     # send nothing; show anything the scanner volunteers
npm run dev                   # run the Electron app with hot reload
npm run build && npm start    # run the built app
```

## Optional data

- **DMR user database**: download the user export from radioid.net
  (<https://radioid.net/static/user.csv>), then Data > Import.
- **Ofcom Wireless Telegraphy Register**: download the WTR CSV from Ofcom
  (<https://static.ofcom.org.uk/static/radiolicensing/html/register/WTR.csv>), set your
  location in Data, then Data > Import WTR CSV. Heard frequencies then show the nearest licensees.
- **UK amateur repeaters**: download the "all" repeater list from the RSGB ETCC
  (<https://ukrepeater.net/csvfiles.html>), then Data > Import repeater list CSV. Amateur
  repeater outputs then show the callsign, place, distance, CTCSS tone and FM / DMR / D-STAR /
  Fusion capabilities, with the repeater whose tone matches the one the scanner detects first.

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

## Releases on GitHub

Pushing a version tag builds the installer on a Windows runner and attaches it to a GitHub
Release (`.github/workflows/release.yml`), so users download it from the Releases page:

```
.\scripts\release.ps1            # patch: 0.2.1 -> 0.2.2
.\scripts\release.ps1 minor      # 0.2.1 -> 0.3.0
```

The script refuses a dirty tree, then runs `git checkout main`, `git pull`,
`npm version <bump>` (commits and tags `v<version>`) and `git push --follow-tags`, stopping at
the first failure; the pushed tag starts the Release workflow. The workflow checks the tag against
`package.json`, runs the tests, builds `TRXController-Setup-<version>.exe` and publishes the
release with generated notes. Progress is under the repository's Actions tab; the installer is
also kept as a workflow artifact for manual runs (Actions > Release > Run workflow).
`.github/workflows/ci.yml` runs the tests, typecheck and build on every push and pull request.

## Status

Beta, from Cerberus Systems, for the TRX-1 / TRX-1E / TRX-2. Provided as is with no warranty or
guarantee of any kind. Not affiliated with Whistler.

See `CLAUDE.md` for the design constraints.
