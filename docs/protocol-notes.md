# Whistler RCIP protocol notes

Condensed from `Whistler_Remote_Control_Protocol_v1_7.pdf` (v1.7, 1 Aug 2017).
Anything marked **unverified** has not yet been confirmed against a real scanner.

## Link

115200 baud, 8 data bits, no parity, 1 stop bit. USB CDC serial (shows as a COM port).
Remote control is always active. No echo is documented.

## Frame

```
STX(0x02) <code> <data...> ETX(0x03) <sum>
sum = (code + data bytes + ETX) & 0xFF
```

Codes are case-sensitive. Data is binary and may contain 0x02/0x03, so responses are
delimited by their known lengths:

| Code | Direction | Data bytes | Frame total |
|------|-----------|-----------:|------------:|
| `A`  | cmd       | 0          | 4  |
| `A`  | resp      | 16         | 20 |
| `L`  | cmd       | 0          | 4  |
| `L`  | resp      | 97 + 3 (see note) | 104 |
| `a`  | cmd       | 0          | 4  |
| `a`  | resp      | 2 + len    | 6 + len (len is 0 or 320) |
| `K`  | cmd       | 1          | 5, no response |
| `t`  | cmd       | 18 (9 x int16) | 22, no response |
| `P`  | cmd       | 0          | 4  |
| `P`  | resp      | 1          | 5  |
| `V`  | cmd       | 1 (0x00)   | 5  |
| `V`  | resp      | 13         | 17 |
| `C`  | cmd       | 1          | 5, no response |

Note on `L`: the spec says `<lcd0>` .. `<lcd96>` (97 bytes) then three icon bytes, but
also "6 lines at 16 characters" (96). The 97th byte is presumably a C string NUL.
**Unverified**; the probe reports the actual length.

## `A` Get Status (16 data bytes, in order)

mode, sq, battL, battH, rssiL, rssiH, zmL, zmH, ledR, ledG, ledB, freq0..freq3, rxmode

- sq bit0 RF squelch open, bit1 unmuted, bit2 /XF (IMBE detect)
- batt = battL | (battH & 0x7F) << 8; battH bit7 set = on USB power
- rssi and ZeroMatic are 16-bit little-endian
- freq is 32-bit little-endian, Hz
- rxmode 0 AM, 1 FM, 2 NFM
- mode 0x00..0x14, see `MODES` in `packages/rcip/src/tables.ts`

## `L` Get LCD

6 lines x 16 chars, then icons1/icons2/icons3 bitmaps (see `packages/rcip/src/lcd.ts`).
Check boxes and cursor arrows are not included in the text.

## `a` Get Active Channel

`lenH lenL` then `len` bytes. `len` is 0 when nothing is being received, otherwise 320
(the audio recording header). Needs firmware from June 2017 or later.

Recording header: all integers **big-endian** except the `stm` start-time struct, which
the spec says is **little-endian** (the two statements conflict, so the parser
auto-detects and reports which it used). Strings are `char[17]`, NUL-terminated.
Radio/talkgroup IDs are 0xFFFFFFFF when unavailable. Layout in
`packages/rcip/src/activeChannel.ts`.

## `K` Send Key

Needs CPU firmware 1.2 or later. Codes from the spec table:

| Key | Code | Key | Code |
|-----|-----:|-----|-----:|
| MENU | 17 | PLAY/SEL/PAUSE | 9 |
| SKIP | 1 | WX | 3 |
| ATT | 15 | ▼ (down) | 10 |
| ▲ (up) | 8 | ► (right) | 2 |
| ◄ (left) | 16 | PRI | 5 |
| Fn | 12 | . (decimal) | 19 |
| 1 | 29 | 2 | 22 |
| 3 | 30 | 4 | 23 |
| 5 | 31 | 6 | 24 |
| 7 | 32 | 8 | 25 |
| 9 | 33 | 0 | 26 |
| Knob CW | 40 | Knob CCW | 41 |
| Knob push | 43 | POWER | 44 |

The four arrow labels are not extractable as text from the PDF: they are Webdings
glyphs 0x33..0x36, which are ◄ ► ▲ ▼ respectively. Reading them back against the
table rows gives up=8, down=10, left=16, right=2. **Unverified on hardware** until
`npm run probe -- COM7 --identify` has been run.

## `t` Clock Set

Nine 16-bit values: sec, min, hour, mday, month(0-11), year(since 1900), wday, yday,
isDST. The spec does not state byte order. The library defaults to little-endian
(matching `stm` and the `A` frequency field). **Unverified.**

## `V` Version

Command carries one 0x00 data byte. Response: 0x00, 8 ASCII model chars
(e.g. `"WS1080  "`), then boot, CPU, DSP1, DSP2 versions as `major<<4 | minor`.

## `P` Power status

One byte: 0 off, 1 on.

## `C` CC Dump control

One byte, 0 off / 1 on. Turning it on makes the scanner stream ASCII control-channel
lines on the same port, interleaved with RCIP responses. The stream decoder treats
non-frame bytes as noise and surfaces them separately.
