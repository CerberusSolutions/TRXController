import { parseScanObjectLine, parseScanScreen, type ActiveChannel, type Lcd, type Status } from '@trxcontroller/rcip';

/** "119.775000" -> { mhz: "119", khz: "775000" } */
export function splitFrequency(hz: number): { mhz: string; frac: string } {
  const mhz = Math.floor(hz / 1_000_000);
  const frac = String(hz % 1_000_000).padStart(6, '0');
  return { mhz: String(mhz), frac };
}

export function formatMHz(hz: number, digits = 6): string {
  return (hz / 1e6).toFixed(digits);
}

/**
 * Best available channel identity. While a transmission is in progress the
 * `a` header is authoritative; otherwise fall back to the scan-mode LCD
 * layout (line 1 scanlist, line 3 object name, line 2 type + flags).
 */
export interface ChannelIdentity {
  name: string;
  system: string;
  detail: string;
  source: 'active' | 'lcd' | 'scanning' | 'none';
}

/**
 * In Scan mode the LCD has two layouts: the channel layout while stopped on
 * an object (line 2 carries the type and psDr flags) and, while sweeping,
 * a plain list of the enabled scanlists. Only the former names a channel.
 */
export function isChannelScreen(lcd: Lcd | null, status: Status | null): boolean {
  if (!lcd || status?.mode !== 0x0a) return false;
  return parseScanObjectLine(lcd.lines[2] ?? '')?.flags != null;
}

const FREQ_TEXT = /^\d{1,4}\.\d{3,6}$/;

export function identify(active: ActiveChannel | null, lcd: Lcd | null, status: Status | null): ChannelIdentity {
  const h = active?.header;
  const channelScreen = isChannelScreen(lcd, status);
  const scanlist = channelScreen ? (lcd?.lines[1]?.trim() ?? '') : '';
  if (h) {
    // For conventional objects the info tag is just the frequency again, and
    // there is no system tag, so the scanlist from the LCD is the better label.
    const info = FREQ_TEXT.test(h.infoTag.trim()) ? '' : h.infoTag.trim();
    const system = h.systemTag || scanlist;
    const detail = [h.systemTag && h.siteName ? h.siteName : '', info].filter(Boolean).join(' · ');
    return { name: h.objectTag || '—', system, detail, source: 'active' };
  }
  if (lcd && channelScreen) {
    const screen = parseScanScreen(lcd);
    const name = screen?.name ?? (screen?.tgid !== null && screen?.tgid !== undefined ? `TG ${screen.tgid}` : '');
    const detail = screen?.type ?? '';
    if (name || scanlist) return { name: name || '—', system: scanlist, detail, source: 'lcd' };
  }
  if (lcd && status?.mode === 0x0a) {
    // Sweeping: the display lists the enabled scanlists.
    const lists = lcd.lines.map((l) => l.trim()).filter(Boolean);
    return { name: 'Scanning', system: lists.join(' · '), detail: '', source: 'scanning' };
  }
  return { name: '', system: '', detail: '', source: 'none' };
}

export function batteryText(status: Status | null): string {
  if (!status) return '—';
  return status.battery.usb ? `USB · ${status.battery.level}` : `Batt ${status.battery.level}`;
}
