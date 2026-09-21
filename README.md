# TRXController

A modern remote-control and logging app (Windows, macOS on Apple silicon, and Linux) for the Whistler TRX-1 / TRX-1E / TRX-2
digital scanners, replacing Whistler's own remote control software.

**Website, downloads and user guide:** <https://cerberussolutions.github.io/TRXController/>

- Protocol spec: `docs/Whistler_Remote_Control_Protocol_v1_7.pdf`
- Working notes on the protocol: `docs/protocol-notes.md`
- Protocol library: `packages/rcip`
- Hardware probe: `scripts/probe.ts`

## Stack

Electron + Vite + React + TypeScript, Tailwind, `serialport` in the main process,
Zustand in the renderer, Node's built-in `node:sqlite` for the log. Windows first; macOS (Apple silicon) and Linux (AppImage and .deb, x64 and arm64) builds are provided as well.

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
- **RadioReference.com** (optional, online): Data > RadioReference.com, enter your radioreference.com
  premium login and pick your country and region. Heard frequencies are looked up once and
  cached: trunked systems get their system, site and talkgroup names; conventional channels
  their descriptions. Only builds made with the `RR_KEY` application key have this.
- **RadioReference UK** (optional, online, <https://radioreferenceuk.co.uk/>): the UK-centric,
  Ofcom-backed database. Generate an API key in your RRUK account dashboard, paste it under Data >
  RadioReference UK, and optionally enter a postcode (otherwise your latitude and longitude are
  used, with the radius as the range, up to RRUK's 50 miles). Heard frequencies are looked up once
  and cached; entries carry the licensee, place, distance, bearing and the colour code or tone, which
  the app matches against what the scanner shows. The key is yours: it is stored encrypted and never
  built into the app.
- **UK amateur repeaters**: download the "all" repeater list from the RSGB ETCC
  (<https://ukrepeater.net/csvfiles.html>), then Data > Import repeater list CSV. Amateur
  repeater outputs then show the callsign, place, distance, CTCSS tone and FM / DMR / D-STAR /
  Fusion capabilities, with the repeater whose tone matches the one the scanner detects first.

The same links and steps are on the app's help screen (the `?` button; shown on first run).
Put downloads in `data/` (git-ignored).

The scanner's own programming always wins: a lookup only fills in a name or system the scanner
did not have. An object named only by its frequency, with or without a code noted after it ("453.0625",
"453.0625 CC15", "167.300 94.8"), counts as unnamed, so the lookups name it. Data > Lookup order sets which lookup is asked first (default: the Ofcom register,
then RadioReference UK, then RadioReference, then the repeater list; a RadioReference talkgroup name
still wins, since the register knows no talkgroups). Untick a lookup to ignore it while it is offline or returning
junk. The log's **Src** column (and the `source` column of the CSV export) says which
lookup did: blank for the scanner's data, `WTR`, `RRUK` (RadioReference UK), `RRDB` (RadioReference), `UKR` (repeater list)
or `RID` (radioid.net), and `MEM` when a log entry too brief to show the object on the display was
named from an earlier entry on the same frequency. The log loads the newest 500 entries and fetches 500 more as you scroll towards the bottom (up to
5,000); only the rows in view are drawn. The log's **Detail** view shows what every source said, one column each
(Scanner, List, WTR, RRUK, RRDB, UKR, Sys), and the CSV carries the same columns, so a row where the
scanner and the register disagree is easy to spot and reprogram. Drag a column divider in the
log header to resize it; double-click the divider to reset.

With a location set, every match carries its distance and bearing from you ("3.2 km 047°"), in km or
miles (the toggle beside the radius in Data). The hero's Listed block and the log's **Dist** column
show it, and each log row keeps every candidate the lookups offered for its frequency at the time:
click **+** at the left of a row to unfold them, ranked as the Listed block had them (placed entries
first, then your lookup order). The CSV export carries `trx_distance_km`, `trx_bearing_deg` and the whole
`trx_candidates` list, so the right match can be picked by hand when several users share a channel.

The CSV export is an **EZ Scan import file**: EZ Scan's own conventional-object columns come first,
exactly as its export writes them, so EZ Scan's CSV import takes it as it is and the session's
finds go into the scanner without retyping. One object per frequency and tone or colour code (the
way confirmations are keyed, so two users sharing a channel become two objects and twenty
conversations with one become one), the alpha tag from the log's name (cut to EZ Scan's 16
characters, else the scanner's own label such as "453.0625 CC12", else the frequency), the mode,
CTCSS / DCS / NAC, DMR colour code and slot filled in. The scanlist column is left empty, so EZ Scan
files the objects under its default import scanlist (normally scanlist 1; the default is yours to change
in EZ Scan). The log's own columns (first and last heard, entries, calls, peak
RSSI, every source's answer, `trx_distance_km`, `trx_bearing_deg`, `trx_candidates`) follow EZ Scan's, all
prefixed `trx_` so its importer, which matches columns by name, leaves them alone; any other program reads
them as a normal CSV.

When you know which one it is, say so: in the unfolded list press **confirm** on the right candidate,
or type a name none of them offer. The confirmation is keyed to the frequency and the tone or colour
code the row showed (and the talkgroup on a trunked object), so co-channel users stay apart. It
outranks every lookup and the scanner's own programming: every log entry it fits is renamed
with a green **CONF** pill, new entries take it as they arrive, and the hero shows it while the
scanner is on the frequency. **remove** withdraws it. Data > Confirmed identities lists them all.

Codes count: a candidate whose tone or DMR colour code matches the one the scanner shows ("CC 12",
"CTCSS 94.8", "NAC 293") is listed first and names the row whatever the lookup order; one whose code
differs sinks. The unfolded row also shows the traffic heard on that frequency by code: how many
entries, first and last heard, which radio IDs and which names, so the users sharing a channel
can be told apart and confirmed one code at a time.

The **map** button beside the hero's Listed block, or beside any placed candidate in a log entry, opens a second
window with you (your Data-dialog location) and every candidate for the frequency pinned on
OpenStreetMap, coloured by source, with a dashed line to the one the log chose carrying its distance
and bearing. It follows the scanner, or stays pinned to the log entry it was opened from (Follow, or
F, lets go). Dock (or D) parks it against whichever side of the main window has room, square and as tall as the
main window, and keeps it there as the main window moves; drag it away or press Dock again to free it. Keys: + and - zoom, arrows pan, A fits
everything in, Z centres on you, D docks; ? in the window's bar lists them. A WTR pin marks
the Ofcom licence holder, which is often a reseller's address rather than the transmitter; RRUK and
RadioReference pins are the sites those databases list; a UKR pin is the repeater. The card under a
pin says which. Tiles need an internet connection; the pins do not. Rows and candidates store their
position from now on, for a later "everything heard today" map.

Data > Scan timeout stops a dead carrier or a stuck beacon eating the session: after the chosen
number of seconds on one carrier in Scan mode the app presses ► for you and scanning resumes.
Searches and Tune Mode are never nudged.

## Windows installer

```
npm run dist        # release/TRXController-Setup-<version>.exe (NSIS, per-user)
npm run dist:dir    # release/win-unpacked/ only, for a quick check without installing
```

Run `npm run dist` on Windows (the NSIS step needs Wine anywhere else; `dist:dir` works on Linux).

electron-builder config is `electron-builder.yml`; the icon is `build/icon.ico`. The installer is
unsigned, so users see two one-off warnings: Edge holds the download ("isn't commonly downloaded":
⋯ › Keep, then the arrow on Delete › Keep anyway; Chrome and Firefox have a similar Keep prompt) and
SmartScreen objects when it runs ("Windows protected your PC": More info › Run anyway). The app
installs under `%LOCALAPPDATA%\Programs\TRXController` and keeps its log, settings and imported data
in `%APPDATA%\TRXController`, the same folder the dev build uses, so nothing needs re-importing. The
last port used is reopened at launch.

`npm run dist` also produces `TRXController-<version>-win-x64.zip`, the same app with no installer:
unzip it anywhere and run `TRXController.exe`. It is for machines where the installer is blocked, most
often by Windows' Controlled folder access refusing to write the Start Menu shortcut ("Unspecified error"
with a path ending in `TRXController.lnk`; the app is installed by then and runs from
`%LOCALAPPDATA%\Programs\TRXController`). Both use the same `%APPDATA%\TRXController` data folder. The
zip target builds anywhere; only the NSIS installer needs Windows or Wine.

## Installing on Linux (Ubuntu, Debian, Mint, Raspberry Pi, or any distro via AppImage)

Two packages are built for each release: a `.deb` for Ubuntu, Debian and Mint, and an AppImage that
runs on any distro without installing. Each comes in x64 (`amd64` / `x86_64`) for PCs and arm64 for
a Raspberry Pi running a 64-bit OS (Pi 3 onwards on Raspberry Pi OS 64-bit or Ubuntu). There is no
signing step on Linux, so no first-run warning.

**Ubuntu / Debian / Mint (.deb)**

1. Download `TRXController-<version>-linux-amd64.deb` (or `-arm64.deb` on a Pi) from the
   [releases page](https://github.com/CerberusSolutions/TRXController/releases).
2. Install it, which also pulls in the few libraries Electron needs:

   ```
   sudo apt install ./TRXController-<version>-linux-amd64.deb
   ```

3. Give yourself access to serial ports. They belong to the `dialout` group, so:

   ```
   sudo usermod -aG dialout $USER
   ```

   then **log out and back in** (or reboot); group changes only take effect on a new login. The
   installer prints this reminder too.
4. Plug the scanner in over USB and switch it on. No driver is needed; it appears as
   `/dev/ttyUSB0` (or `/dev/ttyACM0`). Launch **TRXController** from the applications menu, pick
   the port in the top bar and press **Connect**. The port is remembered for next time.

**Any distro (AppImage)**

1. Download `TRXController-<version>-linux-x86_64.AppImage` (or `-arm64.AppImage`).
2. Make it executable and run it:

   ```
   chmod +x TRXController-<version>-linux-x86_64.AppImage
   ./TRXController-<version>-linux-x86_64.AppImage
   ```

   If it complains about FUSE (older distros, some containers), install `libfuse2` or run it with
   `--appimage-extract-and-run`.
3. Do the `dialout` step above, then connect as above.

Everything else is the same as on Windows, with the same Ctrl shortcuts (Ctrl+Shift+D for
diagnostics). The log, settings and imported data live in `~/.config/TRXController`. The
RadioReference password is kept in the desktop keyring (GNOME Keyring or KWallet); on a system
without one it is stored obfuscated rather than encrypted and the Data dialog says so, and saving it
again after installing a keyring fixes that. To update, install the new `.deb` over the old one (or
replace the AppImage); data and settings are kept. To remove it, `sudo apt remove trxcontroller`
(or delete the AppImage) and, for a clean slate, that folder.

Building it yourself, on any Linux machine:

```
npm run dist:linux  # release/TRXController-<version>-linux-{x86_64,arm64}.AppImage and -{amd64,arm64}.deb
```

electron-builder downloads the arm64 Electron on an x64 machine, so both architectures build
anywhere. The config is the `linux:` section of `electron-builder.yml`; the icon is `build/icon.png`.

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
   selector in the top bar as `/dev/cu.usbmodem…` (the Mac's own debug-console, wlan-debug and
   Bluetooth ports are never a scanner, so the app leaves them out). Press **Connect**. If the box
   stays empty with the scanner on, run `ls /dev/cu.*` in Terminal: a `usbmodem` entry means macOS
   sees the scanner and the fault is ours, so please report it; none means macOS has not created a
   port for it, so check the lead, any hub or dock in the way, and System Information › USB.
   The port is remembered for next time.

Everything else is the same as on Windows, with Cmd in place of Ctrl (Cmd+Shift+D for
diagnostics). The log, settings and imported data live in
`~/Library/Application Support/TRXController`. To update, download the new dmg and drag the app
over the old one; data and settings are kept. To remove it, delete the app and, if you want a
clean slate, that folder.

Building it yourself: `npm run dist:mac` on a Mac produces the dmg (and a zip) in `release/`.

## Releases on GitHub

Pushing a version tag builds the Windows installer, the macOS app and the Linux AppImage and .deb on their own runners
and attaches them all to a GitHub Release (`.github/workflows/release.yml`), so users download it from the Releases page:

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

## Licence

Copyright © 2026 Cerberus Systems. All rights reserved. This is proprietary, source-available
software, not open source: the code is published to be read, not reused, and the installers on the
Releases page are free for personal, non-commercial use. See [LICENSE](LICENSE) for the terms.

See `CLAUDE.md` for the design constraints.
