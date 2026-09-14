# TRXController

A modern Windows remote-control and logging app for the Whistler TRX-1 / TRX-1E / TRX-2
digital scanners, replacing Whistler's own remote control software.

- Protocol spec: `docs/Whistler_Remote_Control_Protocol_v1_7.pdf`
- Working notes on the protocol: `docs/protocol-notes.md`
- Protocol library: `packages/rcip`
- Hardware probe: `scripts/probe.ts`

## Stack

Electron + Vite + React + TypeScript, Tailwind, `serialport` in the main process,
Zustand in the renderer, `better-sqlite3` for logging. Windows only.

## Getting started

```
npm install
npm test                      # protocol library unit tests
npm run probe -- --list       # list serial ports
npm run probe -- COM7         # query the scanner on COM7
npm run probe -- COM7 --identify   # walk the unlabelled key codes
npm run dev                   # run the Electron app
```

See `CLAUDE.md` for the design constraints.
