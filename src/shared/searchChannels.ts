/**
 * The scanner's service-search channel tables (E models, United Kingdom band plan). The card holds only
 * an enable bit per row (`ProgSearch.channels`); the frequencies are the scanner's own, taken from EZ
 * Scan's Search Options lists on 21 Sep 2026. Row n is bit n of its table (CB UK channels 1 and 2 moved
 * bits 0 and 1 in EZ Scan's save).
 */

export interface SearchChannel {
  label: string;
  hz: number;
}

const ch = (label: string, mhz: number): SearchChannel => ({ label, hz: Math.round(mhz * 1e6) });

/** CB UK: 40 channels from 27.60125 MHz in 10 kHz steps. */
export const CB_UK: readonly SearchChannel[] = Array.from({ length: 40 }, (_, i) => ch(String(i + 1), 27.60125 + i * 0.01));

/** Mosque (UK 454 MHz allocations), as EZ Scan lists them. */
export const MOSQUE: readonly SearchChannel[] = [454.39375, 454.40625, 454.79375, 454.80625, 454.025, 454.05, 454.075, 454.1, 454.125, 454.15, 454.175, 454.25, 454.275, 454.3, 454.325, 454.35, 454.7, 454.775, 454.7875, 454.825, 454.2, 454.6, 454.6125].map((f, i) => ch(String(i + 1), f));

/**
 * VHF Marine on the ITU plan: a row per frequency, so a duplex channel is two rows (ship, then coast),
 * channels 1-28 then 60-88, then L1, L2, F1-F3. EZ Scan's list shows the same rows; the order between
 * the ones seen is assumed from the plan.
 */
export const VHF_MARINE: readonly SearchChannel[] = (() => {
  const out: SearchChannel[] = [];
  const duplex = (n: number, ship: number, coast: number): void => {
    out.push(ch(String(n), ship), ch(String(n), coast));
  };
  const simplex = (n: number, f: number): void => {
    out.push(ch(String(n), f));
  };
  for (let n = 1; n <= 5; n++) duplex(n, 156.05 + (n - 1) * 0.05, 160.65 + (n - 1) * 0.05);
  simplex(6, 156.3);
  duplex(7, 156.35, 160.95);
  for (let n = 8; n <= 17; n++) simplex(n, 156.4 + (n - 8) * 0.05);
  for (let n = 18; n <= 28; n++) duplex(n, 156.9 + (n - 18) * 0.05, 161.5 + (n - 18) * 0.05);
  for (let n = 60; n <= 66; n++) duplex(n, 156.025 + (n - 60) * 0.05, 160.625 + (n - 60) * 0.05);
  for (let n = 67; n <= 77; n++) simplex(n, 156.375 + (n - 67) * 0.05);
  for (let n = 78; n <= 88; n++) duplex(n, 156.925 + (n - 78) * 0.05, 161.525 + (n - 78) * 0.05);
  out.push(ch('L1', 155.5), ch('L2', 155.525), ch('F1', 155.625), ch('F2', 155.775), ch('F3', 155.825));
  return out;
})();

/** PMR446: 16 analogue channels then the same 16 for digital, 446.00625 MHz in 12.5 kHz steps. */
export const PMR446: readonly SearchChannel[] = [
  ...Array.from({ length: 16 }, (_, i) => ch(`${String(i + 1).padStart(2, '0')}A`, 446.00625 + i * 0.0125)),
  ...Array.from({ length: 16 }, (_, i) => ch(`${String(i + 1).padStart(2, '0')}D`, 446.00625 + i * 0.0125)),
];

export type ChannelSearch = 'cbUk' | 'mosque' | 'vhfMarine' | 'pmr446';
export const CHANNEL_SEARCHES: readonly { id: ChannelSearch; name: string; channels: readonly SearchChannel[] }[] = [
  { id: 'cbUk', name: 'CB UK', channels: CB_UK },
  { id: 'mosque', name: 'Mosque', channels: MOSQUE },
  { id: 'vhfMarine', name: 'VHF Marine', channels: VHF_MARINE },
  { id: 'pmr446', name: 'PMR446', channels: PMR446 },
];
