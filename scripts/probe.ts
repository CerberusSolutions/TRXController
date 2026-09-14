/**
 * Hardware probe for the Whistler TRX-1/TRX-1E/TRX-2 RCIP link.
 *
 *   npm run probe -- --list                  list serial ports
 *   npm run probe -- COM7                    send V, P, A, L, a and print results
 *   npm run probe -- COM7 --identify         walk key codes 8,10,16,2 interactively
 *   npm run probe -- COM7 --identify --keys 8,10,16,2,12
 *   npm run probe -- COM7 --key 17           send one key code, then dump the LCD
 *   npm run probe -- COM7 --watch            poll A and L every 500 ms until Ctrl-C
 *   npm run probe -- COM7 --clock            set the scanner clock from the PC (unverified byte order)
 *
 * Runs under plain Node via tsx. serialport is N-API, so no Electron rebuild.
 */
import { createInterface } from 'node:readline/promises';
import { stdin, stdout } from 'node:process';
import { SerialPort } from 'serialport';
import {
  Key,
  SERIAL_SETTINGS,
  describeIcons,
  formatFrequency,
  formatId,
  getActiveChannel,
  getLcd,
  getPower,
  getStatus,
  getVersion,
  keyLabel,
  parseResponse,
  renderLcd,
  sendKey,
  setClockFromDate,
  splitFrames,
  toHex,
  type ActiveChannel,
  type DecoderEvent,
  type Lcd,
  type Status,
  type Version,
} from '@trxcontroller/rcip';

// ---------------------------------------------------------------------------
// args

interface Args {
  list: boolean;
  port: string | undefined;
  identify: boolean;
  keys: number[];
  key: number | undefined;
  watch: boolean;
  clock: boolean;
  quietMs: number;
  timeoutMs: number;
  settleMs: number;
}

function parseArgs(argv: string[]): Args {
  const a: Args = {
    list: false,
    port: undefined,
    identify: false,
    keys: [8, 10, 16, 2],
    key: undefined,
    watch: false,
    clock: false,
    quietMs: 150,
    timeoutMs: 1500,
    settleMs: 400,
  };
  for (let i = 0; i < argv.length; i++) {
    const v = argv[i]!;
    const next = (): string => {
      const n = argv[++i];
      if (n === undefined) throw new Error(`${v} needs a value`);
      return n;
    };
    switch (v) {
      case '--list': a.list = true; break;
      case '--identify': a.identify = true; break;
      case '--keys': a.keys = next().split(',').map((s) => Number(s.trim())).filter((n) => Number.isInteger(n)); break;
      case '--key': a.key = Number(next()); break;
      case '--watch': a.watch = true; break;
      case '--clock': a.clock = true; break;
      case '--quiet': a.quietMs = Number(next()); break;
      case '--timeout': a.timeoutMs = Number(next()); break;
      case '--settle': a.settleMs = Number(next()); break;
      case '-h': case '--help': usage(); process.exit(0);
      default:
        if (v.startsWith('-')) throw new Error(`Unknown option ${v}`);
        a.port = v;
    }
  }
  return a;
}

function usage(): void {
  console.log(`Usage:
  probe --list
  probe <port> [--identify [--keys 8,10,16,2]] [--key N] [--watch] [--clock]
        [--quiet ms] [--timeout ms] [--settle ms]`);
}

// ---------------------------------------------------------------------------
// link

class Link {
  private port: SerialPort;
  private chunks: Uint8Array[] = [];
  private received = 0;
  private waiters: (() => void)[] = [];

  constructor(path: string) {
    this.port = new SerialPort({
      path,
      baudRate: SERIAL_SETTINGS.baudRate,
      dataBits: SERIAL_SETTINGS.dataBits,
      stopBits: SERIAL_SETTINGS.stopBits,
      parity: SERIAL_SETTINGS.parity,
      autoOpen: false,
    });
    this.port.on('data', (d: Buffer) => {
      this.chunks.push(new Uint8Array(d));
      this.received++;
      for (const w of this.waiters.splice(0)) w();
    });
  }

  open(): Promise<void> {
    return new Promise((resolve, reject) => this.port.open((e) => (e ? reject(e) : resolve())));
  }

  close(): Promise<void> {
    return new Promise((resolve) => {
      if (!this.port.isOpen) return resolve();
      this.port.close(() => resolve());
    });
  }

  private drainChunks(): Uint8Array {
    const total = this.chunks.reduce((n, c) => n + c.length, 0);
    const out = new Uint8Array(total);
    let off = 0;
    for (const c of this.chunks) {
      out.set(c, off);
      off += c.length;
    }
    this.chunks = [];
    return out;
  }

  private write(bytes: Uint8Array): Promise<void> {
    return new Promise((resolve, reject) => {
      this.port.write(Buffer.from(bytes), (e) => {
        if (e) return reject(e);
        this.port.drain((e2) => (e2 ? reject(e2) : resolve()));
      });
    });
  }

  /**
   * Send a command and collect everything that comes back until the line has
   * been quiet for `quietMs` (after the first byte) or `timeoutMs` in total.
   */
  async transact(cmd: Uint8Array, quietMs: number, timeoutMs: number): Promise<{ raw: Uint8Array; events: DecoderEvent[]; ms: number }> {
    const stale = this.drainChunks();
    if (stale.length) console.log(`  (discarded ${stale.length} unsolicited bytes: ${toHex(stale.subarray(0, 32))}${stale.length > 32 ? ' ...' : ''})`);
    const t0 = Date.now();
    await this.write(cmd);
    let gotAny = false;
    for (;;) {
      const elapsed = Date.now() - t0;
      if (elapsed >= timeoutMs) break;
      const wait = gotAny ? quietMs : timeoutMs - elapsed;
      const arrived = await this.waitForData(wait);
      if (!arrived) break;
      gotAny = true;
    }
    const raw = this.drainChunks();
    return { raw, events: splitFrames(raw), ms: Date.now() - t0 };
  }

  /** Fire-and-forget for commands with no response. */
  async send(cmd: Uint8Array): Promise<void> {
    await this.write(cmd);
  }

  /** Resolve true when a new data chunk arrives within `ms`, else false. */
  private waitForData(ms: number): Promise<boolean> {
    return new Promise((resolve) => {
      const t = setTimeout(() => {
        this.waiters = this.waiters.filter((w) => w !== onData);
        resolve(false);
      }, ms);
      const onData = (): void => {
        clearTimeout(t);
        resolve(true);
      };
      this.waiters.push(onData);
    });
  }
}

// ---------------------------------------------------------------------------
// printing

function printEvents(events: DecoderEvent[]): void {
  for (const e of events) {
    if (e.type === 'noise') {
      console.log(`  noise (${e.bytes.length} bytes): ${toHex(e.bytes.subarray(0, 48))}${e.bytes.length > 48 ? ' ...' : ''}`);
      const txt = Buffer.from(e.bytes).toString('latin1').replace(/[^\x20-\x7e]/g, '.');
      console.log(`        as text: ${txt.slice(0, 80)}`);
    } else if (e.type === 'error') {
      console.log(`  frame error: ${e.error.message} raw=${toHex(e.error.raw)}`);
    } else {
      const f = e.frame;
      console.log(`  frame '${f.codeChar}' data=${f.data.length} bytes, total=${f.raw.length}`);
    }
  }
}

function printStatus(s: Status): void {
  console.log(`  mode      ${s.mode} (${s.modeName})`);
  console.log(`  squelch   rf=${s.squelch.rf} unmuted=${s.squelch.unmuted} xf=${s.squelch.xf} (raw 0x${s.squelch.raw.toString(16)})`);
  console.log(`  battery   level=${s.battery.level} usb=${s.battery.usb}`);
  console.log(`  rssi      ${s.rssi}`);
  console.log(`  zeromatic ${s.zeromatic}`);
  console.log(`  led       r=${s.led.r} g=${s.led.g} b=${s.led.b}`);
  console.log(`  freq      ${s.frequencyHz} Hz = ${formatFrequency(s.frequencyHz)}`);
  console.log(`  rxmode    ${s.rxMode} (${s.rxModeName})`);
}

function printLcd(l: Lcd): void {
  console.log(renderLcd(l).split('\n').map((x) => '  ' + x).join('\n'));
  console.log(`  text bytes: ${l.textLength} (trailer: ${l.trailer.length ? toHex(l.trailer) : 'none'})`);
  console.log(`  icons: ${toHex(l.icons.raw)} -> ${describeIcons(l.icons)}`);
}

function printActive(a: ActiveChannel): void {
  console.log(`  length ${a.length}`);
  if (!a.header) {
    console.log('  no transmission in progress');
    return;
  }
  const h = a.header;
  console.log(`  magic 0x${h.magic.toString(16)} offset=${h.dataOffset} size=0x${h.dataSize.toString(16)} enc=${h.encoding} rate=${h.sampleRate} ch=${h.channels}`);
  console.log(`  type      ${h.recordingType} (${h.recordingTypeName})`);
  console.log(`  start     ${h.startTime.iso ?? 'unparseable'} [${h.startTime.byteOrder}] raw=${toHex(a.raw!.subarray(25, 43))}`);
  console.log(`  object    "${h.objectTag}"  system "${h.systemTag}"  info "${h.infoTag}"`);
  console.log(`  objectId  ${h.objectId}  tg1 ${formatId(h.talkgroupId1)}  tg2 ${formatId(h.talkgroupId2)}  rid1 ${formatId(h.radioId1)}  rid2 ${formatId(h.radioId2)}`);
  console.log(`  site      "${h.siteName}"  tsysIndex ${h.tsysFileIndex}  misc "${h.miscText}"`);
  console.log(`  voice     ${formatFrequency(h.voiceFrequencyHz)}  control ${formatFrequency(h.controlFrequencyHz)}`);
  console.log(`  squelch   ${h.squelchText} (mode ${h.squelchMode}, value ${h.squelchValue})`);
  console.log(`  tsys      ${h.tsysType} (${h.tsysTypeName})`);
  const nz = h.reserved.some((b) => b !== 0);
  console.log(`  reserved  ${nz ? 'has non-zero bytes: ' + toHex(h.reserved.subarray(0, 32)) + ' ...' : 'all zero'}`);
}

function printVersion(v: Version): void {
  console.log(`  model "${v.modelRaw}" -> ${v.model}`);
  console.log(`  boot ${v.boot.text}  cpu ${v.cpu.text}  dsp1 ${v.dsp1.text}  dsp2 ${v.dsp2.text}`);
  if (v.cpu.raw < 0x12) console.log('  WARNING: CPU firmware < 1.2, the K (send key) command is not reliable');
}

async function query(link: Link, label: string, cmd: Uint8Array, args: Args): Promise<DecoderEvent[]> {
  console.log(`\n== ${label}`);
  console.log(`  TX ${toHex(cmd)}`);
  const { raw, events, ms } = await link.transact(cmd, args.quietMs, args.timeoutMs);
  console.log(`  RX ${raw.length} bytes in ${ms} ms${raw.length ? ': ' + toHex(raw.subarray(0, 64)) + (raw.length > 64 ? ' ...' : '') : ''}`);
  if (raw.length > 64) console.log(`  RX full: ${toHex(raw)}`);
  printEvents(events);
  for (const e of events) {
    if (e.type !== 'frame') continue;
    try {
      const p = parseResponse(e.frame);
      if (p.code === 'A' && 'status' in p) printStatus(p.status);
      else if (p.code === 'L' && 'lcd' in p) printLcd(p.lcd);
      else if (p.code === 'a' && 'activeChannel' in p) printActive(p.activeChannel);
      else if (p.code === 'V' && 'version' in p) printVersion(p.version);
      else if (p.code === 'P' && 'power' in p) console.log(`  power ${p.power.on ? 'ON' : 'OFF'} (raw ${p.power.raw})`);
      else console.log(`  unknown response code '${p.code}'`);
    } catch (err) {
      console.log(`  parse error: ${(err as Error).message}`);
    }
  }
  if (!events.some((e) => e.type === 'frame')) console.log('  NO FRAME DECODED');
  return events;
}

async function readLcd(link: Link, args: Args): Promise<Lcd | undefined> {
  const { events } = await link.transact(getLcd(), args.quietMs, args.timeoutMs);
  for (const e of events) {
    if (e.type === 'frame' && e.frame.codeChar === 'L') {
      const p = parseResponse(e.frame);
      if ('lcd' in p) return p.lcd;
    }
  }
  return undefined;
}

function diffLcd(before: Lcd | undefined, after: Lcd | undefined): string[] {
  if (!before || !after) return ['(LCD unavailable)'];
  const out: string[] = [];
  for (let i = 0; i < 6; i++) {
    if (before.lines[i] !== after.lines[i]) out.push(`  line ${i}: "${before.lines[i]}" -> "${after.lines[i]}"`);
  }
  if (toHex(before.icons.raw) !== toHex(after.icons.raw)) out.push(`  icons: ${toHex(before.icons.raw)} -> ${toHex(after.icons.raw)}`);
  return out.length ? out : ['  (no change in LCD text or icons)'];
}

// ---------------------------------------------------------------------------
// modes

async function listPorts(): Promise<void> {
  let ports: Awaited<ReturnType<typeof SerialPort.list>>;
  try {
    ports = await SerialPort.list();
  } catch (err) {
    console.log(`Could not list ports: ${(err as Error).message}`);
    return;
  }
  if (!ports.length) {
    console.log('No serial ports found.');
    return;
  }
  for (const p of ports) {
    const bits = [p.path, p.manufacturer, p.friendlyName, p.vendorId && p.productId ? `VID:PID ${p.vendorId}:${p.productId}` : undefined, p.serialNumber]
      .filter(Boolean);
    console.log(bits.join('  '));
  }
}

async function runQueries(link: Link, args: Args): Promise<void> {
  await query(link, 'V  Version', getVersion(), args);
  await query(link, 'P  Power status', getPower(), args);
  await query(link, 'A  Status', getStatus(), args);
  await query(link, 'L  LCD', getLcd(), args);
  await query(link, 'a  Active channel', getActiveChannel(), args);
}

async function identify(link: Link, args: Args): Promise<void> {
  const rl = createInterface({ input: stdin, output: stdout });
  console.log(`\n== Identify key codes ${args.keys.join(', ')}`);
  console.log('  Watch the scanner. After each key is sent, type what it did');
  console.log('  (e.g. up, down, left, right, nothing, menu opened) and press Enter.');
  console.log('  Tip: press MENU on the scanner first so the arrows have a list to move in.');
  await ask(rl, '  Press Enter when ready... ');
  const results: { code: number; observed: string; diff: string[] }[] = [];
  for (const code of args.keys) {
    const before = await readLcd(link, args);
    const cmd = sendKey(code);
    console.log(`\n  -> key ${code} (${keyLabel(code)})  TX ${toHex(cmd)}`);
    await link.send(cmd);
    await sleep(args.settleMs);
    const after = await readLcd(link, args);
    const diff = diffLcd(before, after);
    console.log(diff.join('\n'));
    if (after) console.log(renderLcd(after).split('\n').map((x) => '     ' + x).join('\n'));
    const observed = (await ask(rl, `  What did the scanner do for code ${code}? `)).trim() || '(no answer)';
    results.push({ code, observed, diff });
  }
  rl.close();
  console.log('\n== Identification summary');
  console.log('  code  currently  observed');
  for (const r of results) console.log(`  ${String(r.code).padStart(4)}  ${keyLabel(r.code).padEnd(9)}  ${r.observed}`);
  console.log('\n  Provisional mapping in packages/rcip/src/keys.ts: UP=8 DOWN=10 LEFT=16 RIGHT=2');
}

async function watch(link: Link, args: Args): Promise<void> {
  console.log('\n== Watching (Ctrl-C to stop)');
  for (;;) {
    const s = await link.transact(getStatus(), args.quietMs, args.timeoutMs);
    const l = await link.transact(getLcd(), args.quietMs, args.timeoutMs);
    console.clear();
    for (const e of s.events) if (e.type === 'frame') { const p = parseResponse(e.frame); if ('status' in p) printStatus(p.status); }
    for (const e of l.events) if (e.type === 'frame') { const p = parseResponse(e.frame); if ('lcd' in p) printLcd(p.lcd); }
    await sleep(500);
  }
}

/** rl.question that survives stdin closing (e.g. when input is piped). */
async function ask(rl: ReturnType<typeof createInterface>, prompt: string): Promise<string> {
  try {
    return await rl.question(prompt);
  } catch {
    return '';
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  if (args.list || !args.port) {
    await listPorts();
    if (!args.port) {
      if (!args.list) {
        console.log('\nPass a port name to query the scanner, e.g.  npm run probe -- COM7');
      }
      return;
    }
  }

  const link = new Link(args.port);
  console.log(`Opening ${args.port} at ${SERIAL_SETTINGS.baudRate} 8N1 ...`);
  await link.open();
  console.log('Open.');
  try {
    if (args.key !== undefined) {
      const cmd = sendKey(args.key);
      console.log(`\n== K  key ${args.key} (${keyLabel(args.key)})  TX ${toHex(cmd)}`);
      await link.send(cmd);
      await sleep(args.settleMs);
      await query(link, 'L  LCD after key', getLcd(), args);
    } else if (args.identify) {
      await runQueries(link, args);
      await identify(link, args);
    } else if (args.watch) {
      await watch(link, args);
    } else {
      await runQueries(link, args);
      if (args.clock) {
        const cmd = setClockFromDate(new Date());
        console.log(`\n== t  Clock set  TX ${toHex(cmd)}`);
        await link.send(cmd);
        console.log('  sent (no response expected; check the scanner clock)');
      }
      console.log('\nDone. Key codes to identify: run with --identify');
    }
  } finally {
    await link.close();
  }
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
