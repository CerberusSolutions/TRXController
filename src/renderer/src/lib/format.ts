import type { ActiveChannel, Lcd, Status } from '@trxcontroller/rcip';

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
  source: 'active' | 'lcd' | 'none';
}

const FREQ_TEXT = /^\d{1,4}\.\d{3,6}$/;

export function identify(active: ActiveChannel | null, lcd: Lcd | null, status: Status | null): ChannelIdentity {
  const h = active?.header;
  const scanlist = status?.mode === 0x0a ? (lcd?.lines[1]?.trim() ?? '') : '';
  if (h) {
    // For conventional objects the info tag is just the frequency again, and
    // there is no system tag, so the scanlist from the LCD is the better label.
    const info = FREQ_TEXT.test(h.infoTag.trim()) ? '' : h.infoTag.trim();
    const system = h.systemTag || scanlist;
    const detail = [h.systemTag && h.siteName ? h.siteName : '', info].filter(Boolean).join(' · ');
    return { name: h.objectTag || '—', system, detail, source: 'active' };
  }
  if (lcd && status?.mode === 0x0a) {
    const name = lcd.lines[3]?.trim() ?? '';
    const detail = lcd.lines[2]?.trim() ?? '';
    if (name || scanlist) return { name: name || '—', system: scanlist, detail, source: 'lcd' };
  }
  return { name: '', system: '', detail: '', source: 'none' };
}

export function batteryText(status: Status | null): string {
  if (!status) return '—';
  return status.battery.usb ? `USB · ${status.battery.level}` : `Batt ${status.battery.level}`;
}
