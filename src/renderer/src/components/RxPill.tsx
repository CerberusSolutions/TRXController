/**
 * The receiver pill: RX1 in cyan, RX2 in amber, the same everywhere a thing belongs to one scanner (the top bar, the
 * heroes, the log's RX column, the status strip, the map and the Band tab's chips). Shown only once the window has
 * two scanners; a single-scanner window never says "RX1".
 */
export const RX_PILL: readonly { bg: string; text: string; label: string }[] = [
  { bg: 'bg-rx1', text: 'text-rx1', label: 'RX1' },
  { bg: 'bg-rx2', text: 'text-rx2', label: 'RX2' },
];

export default function RxPill({ rx, className = '', title }: { rx: number; className?: string; title?: string }) {
  const p = RX_PILL[rx] ?? RX_PILL[0]!;
  return (
    <span className={`inline-block rounded px-1.5 py-px font-sans text-[9px] font-bold tracking-wider text-bg ${p.bg} ${className}`} title={title}>
      {p.label}
    </span>
  );
}
