# TRXController

A modern remote-control and logging app (Windows, and macOS on Apple silicon) for the Whistler TRX-1 / TRX-1E / TRX-2
digital scanners, replacing Whistler's own remote control software.

- Protocol spec: `docs/Whistler_Remote_Control_Protocol_v1_7.pdf`
- Working notes on the protocol: `docs/protocol-notes.md`
- Protocol library: `packages/rcip`
- Hardware probe: `scripts/probe.ts`

## Stack

Electron + Vite + React + TypeScript, Tailwind, `serialport` in the main process,
Zustand in the renderer, Node's built-in `node:sqlite` for the reception log. Windows first; a macOS (Apple silicon) build is provided as well.

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
- **RadioReference** (optional, online): Data > RadioReference, enter your radioreference.com
  premium login and pick your country and region. Heard frequencies are looked up once and
  cached: trunked systems get their system, site and talkgroup names; conventional channels
  their descriptions. Only builds made with the `RR_KEY` application key have this.
- **UK amateur repeaters**: download the "all" repeater list from the RSGB ETCC
  (<https://ukrepeater.net/csvfiles.html>), then Data > Import repeater list CSV. Amateur
  repeater outputs then show the callsign, place, distance, CTCSS tone and FM / DMR / D-STAR /
  Fusion capabilities, with the repeater whose tone matches the one the scanner detects first.

The same links and steps are on the app's help screen (the `?` button; shown on first run).
Put downloads in `data/` (git-ignored).

The scanner's own programming always wins: a lookup only fills in a name or system the scanner
did not have. Data > Lookup order sets which lookup is asked first (default: the Ofcom register,
then RadioReference, then the repeater list; a RadioReference talkgroup name still wins, since the
register knows no talkgroups). Untick a lookup to ignore it while it is offline or returning
junk. The log's **Src** column (and the `source` column of the CSV export) says which
lookup did: blank for the scanner's data, `WTR`, `RRDB` (RadioReference), `UKR` (repeater list)
or `RID` (radioid.net). A row with a blank source and a different licensee in the CSV is a
channel worth reprogramming on the scanner.

## Windows installer

```
npm run dist        # release/TRXController-Setup-<version>.exe (NSIS, per-user)
npm run dist:dir    # release/win-unpacked/ only, for a quick check without installing
```

Run `npm run dist` on Windows (the NSIS step needs Wine anywhere else; `dist:dir` works on Linux).

## Installing on a Mac (Apple silicon)

The macOS build is for M-series Macs only (M1 onwards); it will not run on an Intel Mac. It is
unsigned and not notarised, which is why Gatekeeper objects the first time. These steps are all
that is needed:

1. Download `TRXController-<version>-mac-arm64.dmg` from the
   [releases page](https://github.com/CerberusSolutions/TRXController/releases) and open it.
2. Drag **TRXController** into **Applications**, then eject the disk image.
3. First launch: in Finder, open Applications, **right-click** (or Control-click) TRXController and
   choose **Open**, then **Open** again in the dialog. A plain double-click is refused for an
   unsigned app; right-click › Open only has to be done once.
4. If macOS says the app **"is damaged and can't be opened"** or should be moved to the bin, that is
   the download quarantine flag rather than a damaged file. Open Terminal and run:

   ```
   xattr -dr com.apple.quarantine /Applications/TRXController.app
   ```

   then launch it normally. On macOS 15 (Sequoia) and later you may instead see the app blocked
   with a note in **System Settings › Privacy & Security**; scroll to the bottom of that page and
   choose **Open Anyway**.
5. Plug the scanner in over USB and switch it on. No driver is needed; it appears in the port
   selector in the top bar as `/dev/tty.usbserial-…` or `/dev/tty.usbmodem…`. Press **Connect**.
   The port is remembered for next time.

Everything else is the same as on Windows, with Cmd in place of Ctrl (Cmd+Shift+D for
diagnostics). The log, settings and imported data live in
`~/Library/Application Support/TRXController`. To update, download the new dmg and drag the app
over the old one; data and settings are kept. To remove it, delete the app and, if you want a
clean slate, that folder.

Building it yourself: `npm run dist:mac` on a Mac produces the dmg (and a zip) in `release/`.
electron-builder config is `electron-builder.yml`; the icon is `build/icon.ico`. The installer
is unsigned, so SmartScreen shows a warning the first time it runs. The app installs under
`%LOCALAPPDATA%\Programs\TRXController` and keeps its log, settings and imported data in
`%APPDATA%\TRXController`, the same folder the dev build uses, so nothing needs re-importing.
The last port used is reopened at launch.

## Releases on GitHub

Pushing a version tag builds the Windows installer and the macOS app on their own runners and attaches them to a GitHub
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
