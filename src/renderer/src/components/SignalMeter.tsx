interface Props {
  /** 0..5 from the LCD icon bits. */
  bars: number;
  /** Raw RSSI from the status frame. */
  rssi: number | null;
  active: boolean;
}

const SEGMENTS = 20;

export default function SignalMeter({ bars, rssi, active }: Props) {
  const lit = Math.round((Math.max(0, Math.min(5, bars)) / 5) * SEGMENTS);
  return (
    <div className="flex items-center gap-3">
      <span className="w-6 text-[11px] font-bold tracking-widest text-ink-2">SIG</span>
      <div className="flex flex-1 gap-[3px]">
        {Array.from({ length: SEGMENTS }, (_, i) => {
          const on = i < lit && active;
          const tone = i < SEGMENTS * 0.6 ? 'bg-green' : i < SEGMENTS * 0.85 ? 'bg-amber' : 'bg-red';
          return <span key={i} className={`h-2.5 flex-1 rounded-[2px] ${on ? tone : 'bg-edge'}`} />;
        })}
      </div>
      <span className="w-14 text-right font-mono text-xs text-ink-3">{rssi === null ? '—' : rssi}</span>
    </div>
  );
}
