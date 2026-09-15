import type React from 'react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { modeName } from '@trxcontroller/rcip';
import { useBand, type Bin } from '../store/band';
import { useScanner } from '../store/scanner';

const PAD = { top: 12, right: 12, bottom: 26, left: 40 };
/** A bin this many steps from any neighbour, with few samples, is a stray visit and does not set the axis. */
const OUTLIER_GAP_STEPS = 20;
const MIN_STEP_HZ = 5_000;
/** Bins older than this fade to their floor opacity. */
const FADE_MS = 5 * 60_000;

function niceStep(rangeHz: number, px: number): number {
  const target = rangeHz / Math.max(2, Math.floor(px / 90));
  const steps = [5e3, 1e4, 2.5e4, 5e4, 1e5, 2.5e5, 5e5, 1e6, 2.5e6, 5e6, 1e7, 2.5e7, 5e7, 1e8];
  return steps.find((s) => s >= target) ?? 1e8;
}

function fmtMHz(hz: number, stepHz: number): string {
  const d = stepHz >= 1e6 ? 0 : stepHz >= 1e5 ? 1 : stepHz >= 1e4 ? 2 : 3;
  return (hz / 1e6).toFixed(d);
}

export default function BandChart() {
  const version = useBand((s) => s.version);
  const bins = useBand((s) => s.bins);
  const currentHz = useBand((s) => s.currentHz);
  const mode = useBand((s) => s.mode);
  const reset = useBand((s) => s.reset);
  const ref = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ w: 600, h: 200 });
  const [hover, setHover] = useState<Bin | null>(null);
  const tune = useScanner((s) => s.tune);
  const tuneState = useScanner((s) => s.tuneState);
  const online = useScanner((s) => s.snapshot.link.status === 'connected' || s.snapshot.link.status === 'unresponsive');
  const [now, setNow] = useState(Date.now());
  // 'frequency': linear axis (right for a Search sweep). 'channels': every visited
  // frequency gets an equal-width bar (right for Scan lists spanning several bands).
  const [layout, setLayout] = useState<'frequency' | 'channels'>(() => {
    try {
      return localStorage.getItem('trx.bandLayout') === 'channels' ? 'channels' : 'frequency';
    } catch {
      return 'frequency';
    }
  });
  useEffect(() => {
    try {
      localStorage.setItem('trx.bandLayout', layout);
    } catch {
      /* ignore */
    }
  }, [layout]);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver(([e]) => {
      if (e) setSize({ w: Math.max(200, e.contentRect.width), h: Math.max(120, e.contentRect.height) });
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // Recency fade only needs a coarse clock.
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 5000);
    return () => clearInterval(t);
  }, []);

  const model = useMemo(() => {
    const all = [...bins.values()].sort((a, b) => a.hz - b.hz);
    if (all.length === 0) return null;
    // Step: the median gap between neighbours (robust to one odd gap).
    const gaps = all.slice(1).map((b, i) => b.hz - all[i]!.hz).filter((g) => g > 0).sort((a, b) => a - b);
    let step = gaps.length ? gaps[Math.floor(gaps.length / 2)]! : MIN_STEP_HZ;
    if (step < MIN_STEP_HZ) step = MIN_STEP_HZ;
    // Axis range from the populated region: drop stray single visits far from everything else.
    const core =
      all.length >= 8
        ? all.filter((b, i) => {
            const left = i > 0 ? b.hz - all[i - 1]!.hz : Infinity;
            const right = i < all.length - 1 ? all[i + 1]!.hz - b.hz : Infinity;
            return b.samples > 2 || Math.min(left, right) <= OUTLIER_GAP_STEPS * step;
          })
        : all;
    const base = core.length ? core : all;
    const minHz = base[0]!.hz;
    const maxHz = base[base.length - 1]!.hz;
    const rangeHz = Math.max(maxHz - minHz + step, step);
    const list = all.filter((b) => b.hz >= minHz && b.hz <= maxHz);
    const maxRssi = Math.max(400, ...list.map((b) => b.peakRssi));
    return { list, minHz, maxHz, step, rangeHz, maxRssi };
    // version is the real dependency: the Map is mutated in place.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [version, bins]);

  const plotW = size.w - PAD.left - PAD.right;
  const plotH = size.h - PAD.top - PAD.bottom;

  if (!model) {
    return (
      <div className="flex h-full flex-col">
        <Header caption="Peak RSSI · amber = squelch opened · fades with age" />
        <div ref={ref} className="flex flex-1 items-center justify-center text-sm text-ink-3">
          Nothing charted yet. Start a Search or Sweeper on the scanner, or let it scan.
        </div>
      </div>
    );
  }

  const { minHz, step, rangeHz, maxRssi } = model;
  const channels = layout === 'channels';
  // In channel layout every bin is drawn, outliers included, since the axis is ordinal.
  const list = channels ? [...bins.values()].sort((a, b) => a.hz - b.hz) : model.list;
  const slotW = channels ? plotW / list.length : (step / rangeHz) * plotW;
  const index = new Map(list.map((b, i) => [b.hz, i]));
  const x = (hz: number): number =>
    channels ? PAD.left + ((index.get(hz) ?? 0) + 0.5) * slotW : PAD.left + ((hz - minHz + step / 2) / rangeHz) * plotW;
  const barW = Math.max(2, slotW - 2);
  const y = (rssi: number): number => PAD.top + plotH - (Math.max(0, rssi) / maxRssi) * plotH;
  const tick = niceStep(rangeHz, plotW);
  const ticks: number[] = [];
  if (channels) {
    // Label every k-th channel so labels stay ~70 px apart.
    const every = Math.max(1, Math.ceil(70 / slotW));
    for (let i = 0; i < list.length; i += every) ticks.push(list[i]!.hz);
  } else {
    for (let t = Math.ceil(minHz / tick) * tick; t <= minHz + rangeHz; t += tick) ticks.push(t);
  }
  const tickX = (t: number): number => (channels ? x(t) : x(t) - slotW / 2 + barW / 2);
  const tickLabel = (t: number): string => (channels ? (t / 1e6).toFixed(3) : fmtMHz(t, tick));

  const onMove = (e: React.MouseEvent<SVGSVGElement>): void => {
    const rect = e.currentTarget.getBoundingClientRect();
    const px = e.clientX - rect.left;
    if (channels) {
      const i = Math.floor((px - PAD.left) / slotW);
      setHover(i >= 0 && i < list.length ? list[i]! : null);
      return;
    }
    const hz = minHz - step / 2 + ((px - PAD.left) / plotW) * rangeHz;
    let best: Bin | null = null;
    for (const b of list) if (!best || Math.abs(b.hz - hz) < Math.abs(best.hz - hz)) best = b;
    setHover(best && Math.abs(best.hz - hz) <= step ? best : null);
  };

  return (
    <div className="flex h-full flex-col">
      <Header
        caption={
          tuneState
            ? tuneState.phase === 'tuning'
              ? `Tuning ${(tuneState.hz / 1e6).toFixed(4)} MHz…`
              : tuneState.phase === 'done'
                ? `Tuned to ${(tuneState.hz / 1e6).toFixed(4)} MHz`
                : `Tune failed: ${tuneState.message ?? ''}`
            : 'Peak RSSI · amber = squelch opened · click a bar to tune'
        }
        captionClass={tuneState ? (tuneState.phase === 'error' ? 'text-red' : tuneState.phase === 'done' ? 'text-green' : 'text-amber') : ''}
      >
        <span>{mode !== null ? modeName(mode) : ''}</span>
        <span>{list.length} bins</span>
        <span>
          {(list[0]!.hz / 1e6).toFixed(3)}–{(list[list.length - 1]!.hz / 1e6).toFixed(3)} MHz
        </span>
        <span className="flex overflow-hidden rounded border border-edge">
          {(['frequency', 'channels'] as const).map((l) => (
            <button
              key={l}
              className={`px-1.5 py-0.5 ${layout === l ? 'bg-panel-2 text-ink' : 'text-ink-3 hover:text-ink-2'}`}
              title={l === 'frequency' ? 'Linear frequency axis (Search)' : 'One equal-width bar per visited frequency (Scan)'}
              onClick={() => setLayout(l)}
            >
              {l}
            </button>
          ))}
        </span>
        <button className="rounded border border-edge px-1.5 py-0.5 text-ink-3 hover:text-ink-2" onClick={reset}>
          reset
        </button>
      </Header>
      <div ref={ref} className="relative min-h-0 w-full flex-1">
      <svg
        width={size.w}
        height={size.h}
        className={`block ${hover && online ? 'cursor-pointer' : ''}`}
        onMouseMove={onMove}
        onMouseLeave={() => setHover(null)}
        onClick={() => {
          if (hover && online && tuneState?.phase !== 'tuning') void tune(hover.hz);
        }}
      >
        {/* y grid: recessive */}
        {[0.25, 0.5, 0.75, 1].map((f) => (
          <line key={f} x1={PAD.left} x2={size.w - PAD.right} y1={y(maxRssi * f)} y2={y(maxRssi * f)} stroke="var(--color-edge)" strokeWidth={1} />
        ))}
        {[0.5, 1].map((f) => (
          <text key={f} x={PAD.left - 6} y={y(maxRssi * f) + 3} textAnchor="end" fontSize={10} fill="var(--color-ink-3)" fontFamily="var(--font-mono)">
            {Math.round(maxRssi * f)}
          </text>
        ))}
        {/* bars */}
        {list.map((b) => {
          const age = now - b.lastSeenAt;
          const fade = 0.35 + 0.65 * Math.max(0, 1 - age / FADE_MS);
          const active = b.opens > 0;
          const top = y(b.peakRssi);
          const h = Math.max(2, PAD.top + plotH - top);
          return (
            <rect
              key={b.hz}
              x={x(b.hz) - barW / 2}
              y={top}
              width={barW}
              height={h}
              rx={Math.min(2, barW / 2)}
              fill={active ? 'var(--color-amber)' : 'var(--color-cyan)'}
              opacity={hover?.hz === b.hz ? 1 : fade}
            />
          );
        })}
        {/* current frequency marker */}
        {currentHz !== null && (channels ? index.has(currentHz) : currentHz >= minHz - step && currentHz <= minHz + rangeHz) && (
          <line x1={x(currentHz)} x2={x(currentHz)} y1={PAD.top} y2={PAD.top + plotH} stroke="var(--color-ink)" strokeWidth={1} strokeDasharray="2 3" opacity={0.8} />
        )}
        {/* baseline + x axis */}
        <line x1={PAD.left} x2={size.w - PAD.right} y1={PAD.top + plotH} y2={PAD.top + plotH} stroke="var(--color-edge)" />
        {ticks.map((t) => (
          <g key={t}>
            <line x1={tickX(t)} x2={tickX(t)} y1={PAD.top + plotH} y2={PAD.top + plotH + 4} stroke="var(--color-ink-3)" />
            <text x={tickX(t)} y={PAD.top + plotH + 16} textAnchor="middle" fontSize={10} fill="var(--color-ink-3)" fontFamily="var(--font-mono)">
              {tickLabel(t)}
            </text>
          </g>
        ))}
      </svg>

      {hover && (
        <div
          className="pointer-events-none absolute rounded-md border border-edge bg-panel-2 px-2 py-1 font-mono text-[11px] text-ink-2 shadow-lg"
          style={{ left: Math.min(x(hover.hz) + 10, size.w - 190), top: Math.max(0, y(hover.peakRssi) - 8) }}
        >
          <div className="text-amber-2">{(hover.hz / 1e6).toFixed(6)} MHz</div>
          <div>
            peak {hover.peakRssi} · last {hover.lastRssi} · {hover.samples} samples
          </div>
          <div>
            {hover.opens > 0 ? `${hover.opens} squelch open · ` : ''}
            seen {Math.round((now - hover.lastSeenAt) / 1000)}s ago
            {online ? ' · click to tune' : ''}
          </div>
        </div>
      )}

      </div>
    </div>
  );
}

/** Caption on the left, controls on the right, above the plot so nothing overlays it. */
function Header({ caption, captionClass = '', children }: { caption: string; captionClass?: string; children?: React.ReactNode }) {
  return (
    <div className="mb-1 flex h-6 shrink-0 items-center gap-3 font-mono text-[11px] text-ink-3">
      <span className={`truncate uppercase tracking-wider ${captionClass}`}>{caption}</span>
      <div className="ml-auto flex items-center gap-3">{children}</div>
    </div>
  );
}
