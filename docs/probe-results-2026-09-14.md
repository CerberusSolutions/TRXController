# Probe results, 14 September 2026

Scanner: Whistler TRX-1E on COM7 (USB, `VID:PID 2A59:0012`), sitting at the main menu.
Run from `D:\Ham\TRXController` with `npm run probe -- COM7` and `--identify`.

## Version

```
TX 02 56 00 03 59
RX 02 56 00 54 52 58 2D 31 65 20 20 13 74 32 16 03 29
```

Model `"TRX-1e  "`, boot 1.3, CPU 7.4, DSP1 3.2, DSP2 1.6. CPU is far past the 1.2
needed for the `K` command.

## Power

```
TX 02 50 03 53
RX 02 50 01 03 54        -> on
```

## Status

```
TX 02 41 03 44
RX 02 41 00 00 70 92 02 00 7E 00 00 00 00 38 49 68 07 00 03 B6
```

Mode 0 (Main Menu), squelch closed and muted, battery 4720 with the USB bit set,
RSSI 2, ZeroMatic 126, LED off, frequency 124.275000 MHz (last tuned), AM.

## LCD

```
TX 02 4C 03 4F
RX 02 4C 20 20 2D 4D 61 69 6E 20 4D 65 6E 75 2D 20 20 20 53 63 61 6E 20 20 20 20 20 20
   20 20 20 20 20 93 53 63 61 6E 6C 69 73 74 73 20 20 20 20 20 20 20 42 72 6F 77 73 65
   20 4C 69 62 72 61 72 79 20 20 42 72 6F 77 73 65 20 4F 62 6A 65 63 74 73 20 20 50 72
   6F 67 72 61 6D 20 4D 65 6E 75 20 20 20 20 00 00 00 03 DF
```

103 bytes: 96 text bytes and 3 icon bytes. Not 97 as the spec says. Byte `0x93` is in
column 16 of the highlighted line ("Scan"); after pressing UP it moved to "Playback".

```
+----------------+
|  -Main Menu-   |
|Scan           ◄|
|Scanlists       |
|Browse Library  |
|Browse Objects  |
|Program Menu    |
+----------------+
```

## Active channel

```
TX 02 61 03 64
RX 02 61 00 00 03 64      -> length 0, nothing being received
```

The 320-byte header has not yet been seen from real hardware; the parser is tested
against a synthetic header only.

## Key identification (at the main menu)

| Code | Sent | Scanner did | Conclusion |
|-----:|------|-------------|------------|
| 8  | `02 4B 08 03 56` | Cursor jumped from Scan (first) to Playback (last), list scrolled | UP, wraps around |
| 10 | `02 4B 0A 03 58` | Cursor back from Playback to Scan | DOWN, wraps around |
| 16 | `02 4B 10 03 5E` | No change | LEFT (nothing to go back to at top level) |
| 2  | `02 4B 02 03 50` | Entered Scan | RIGHT, doubles as select |

The LCD read straight after code 2 returned nothing within 1.5 s: the scanner was busy
starting Scan. Polling must tolerate a missed response.

## Timing

Every response completed within the probe's 150 ms quiet window (reported 164 to 184 ms
including the window), so actual turnaround is a few tens of milliseconds.

## Still unverified

- `stm` byte order inside the recording header (needs an `a` response during a transmission).
- `t` (clock set) byte order.
- The `a` header on real traffic in general.
