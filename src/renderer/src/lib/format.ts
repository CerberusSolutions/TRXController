import { isModeFrequencyText, parseScanObjectLine, parseScanScreen, parseSearchScreen, type ActiveChannel, type Lcd, type SignalDetails, type Status } from '@trxcontroller/rcip';
import type { ScannerSnapshot } from '../../../shared/ipc';

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

/**
 * The scanner's own name for a search screen ("Tune Mode") with its family
 * ("Service Search") as the subtitle. The name stays put while the display
 * alternates its TGID and RadioID lines; a DMR talkgroup goes in the detail.
 */
function searchIdentity(search: NonNullable<ReturnType<typeof parseSearchScreen>>, receiving: boolean, tgid: number | null): ChannelIdentity {
  const detail = tgid !== null ? `TG ${tgid}` : search.name === 'Tune Mode' && !receiving ? 'Direct frequency entry' : '';
  return { name: search.name, system: search.family, detail, source: 'lcd' };
}

/**
 * @param held  details accumulated over the reception (see `holdDetails`), so
 *              the talkgroup does not blink as the scanner alternates its lines
 */
export function identify(active: ActiveChannel | null, lcd: Lcd | null, status: Status | null, held: HeldDetails | null = null): ChannelIdentity {
  const h = active?.header;
  const channelScreen = isChannelScreen(lcd, status);
  const scanlist = channelScreen ? (lcd?.lines[1]?.trim() ?? '') : '';
  const search = lcd ? parseSearchScreen(lcd) : null;
  const tgid = held?.tgid ?? search?.tgid ?? null;
  if (h) {
    // In a search there is no object: the tag is just the mode and frequency
    // ("DMRs 145.637500"), so the search screen is the better identity.
    if (search && isModeFrequencyText(h.objectTag)) return searchIdentity(search, true, tgid);
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
  if (search) return searchIdentity(search, false, tgid);
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

/**
 * TGID, radio ID, slot, colour code and detected tone for the current
 * reception, from whichever screen the scanner is showing (Scan channel or
 * Search). Null fields mean the display does not say.
 */
export function signalDetails(lcd: Lcd | null, status: Status | null): SignalDetails | null {
  if (!lcd) return null;
  if (isChannelScreen(lcd, status)) return parseScanScreen(lcd);
  return parseSearchScreen(lcd);
}

/** Signal details accumulated over one reception on one frequency. */
export interface HeldDetails extends SignalDetails {
  frequencyHz: number;
  /** When the signal was last up, so a squelch flutter does not blank the row. */
  liveAt: number;
}

/** How long the held details survive after the signal drops (the squelch flutters). */
export const HOLD_GRACE_MS = 1500;

/**
 * The scanner alternates "TGID:" and "RadioID:" on the same display line, so
 * any one poll has only one of them. Keep every field seen while the signal
 * is up on this frequency, and let go once it has been down for a moment.
 */
export function holdDetails(prev: HeldDetails | null, s: ScannerSnapshot, now = Date.now()): HeldDetails | null {
  const status = s.status;
  if (!status) return null;
  const live = status.squelch.rf || !!s.active?.header;
  const kept = prev && prev.frequencyHz === status.frequencyHz ? prev : null;
  if (!live) return kept && now - kept.liveAt < HOLD_GRACE_MS ? kept : null;
  const fresh = signalDetails(s.lcd, status);
  const base: HeldDetails = kept ?? { frequencyHz: status.frequencyHz, liveAt: now, tgid: null, radioId: null, slot: null, colorCode: null, detectedTone: null, toneFlag: null };
  if (!fresh) return { ...base, liveAt: now };
  return {
    ...base,
    liveAt: now,
    tgid: fresh.tgid ?? base.tgid,
    radioId: fresh.radioId ?? base.radioId,
    slot: fresh.slot ?? base.slot,
    colorCode: fresh.colorCode ?? base.colorCode,
    detectedTone: fresh.detectedTone ?? base.detectedTone,
    toneFlag: fresh.toneFlag ?? base.toneFlag,
  };
}
