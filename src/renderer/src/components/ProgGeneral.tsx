import { useState, type ReactNode } from 'react';
import type { Programming } from '../../../shared/programming';
import { NAME_MAX, Popover, ScanlistPicker, TextCell, mhz } from './ProgGrid';

const card = 'rounded-lg border border-edge bg-panel p-3';
const h3 = 'mb-2 text-[10px] font-bold uppercase tracking-widest text-ink-2';
const field = 'rounded-md border border-edge bg-panel-2 px-2 py-0.5 text-[12px] text-ink disabled:opacity-50';

/**
 * A setting EZ Scan shows on its General Settings or Advanced Features screens whose place on the card is not
 * yet known: shown as EZ Scan shows it, greyed, so the screen is complete while the bytes are found one save
 * at a time. The value is EZ Scan's default, not the card's.
 */
interface Pending {
  label: string;
  value: string;
  /** How EZ Scan presents it: a drop-down, a number in a range, a slider, or a tick. */
  kind?: 'select' | 'number' | 'slider' | 'check';
  unit?: string;
}

interface PendingCard {
  title: string;
  fields: Pending[];
}

/** EZ Scan's General Settings, in its order, with its defaults. */
const GENERAL_PENDING: PendingCard[] = [
  { title: 'Volume', fields: [{ label: 'Speaker', value: '20', kind: 'slider' }, { label: 'Headphone', value: '20', kind: 'slider' }, { label: 'Key volume', value: '15', kind: 'slider' }] },
  { title: 'Backlight', fields: [{ label: 'Mode (battery)', value: 'Key Press' }, { label: 'Mode (power)', value: 'On' }, { label: 'Area', value: 'Both' }, { label: 'Level', value: '4', kind: 'slider' }, { label: 'Timeout', value: '5', kind: 'number', unit: 's' }, { label: 'On when unmuted', value: 'off', kind: 'check' }] },
  { title: 'Display', fields: [{ label: 'Display mode', value: 'Advanced' }, { label: 'Blink time 1', value: '0.75', kind: 'number', unit: 's' }, { label: 'Blink time 2', value: '0.75', kind: 'number', unit: 's' }, { label: 'Contrast', value: '12', kind: 'slider' }] },
  { title: 'Sound', fields: [{ label: 'Mode', value: 'On' }, { label: 'Key beep', value: 'On' }] },
  { title: 'Alert', fields: [{ label: 'Mode', value: 'Both' }, { label: 'Volume', value: '15', kind: 'slider' }] },
  { title: 'Priority', fields: [{ label: 'Priority mode', value: 'Off' }, { label: 'Interval', value: '2.0', kind: 'number', unit: 's' }, { label: 'Max channels per check', value: '0', kind: 'number', unit: '0 = all' }] },
  { title: 'Attenuation', fields: [{ label: 'Attenuation mode', value: 'Normal' }, { label: 'Global attenuation', value: 'Off' }] },
  { title: 'Trunking', fields: [{ label: 'Talkgroup ID mode', value: 'Normal' }, { label: 'Use Radio ID alarm', value: 'Off' }] },
  { title: 'Frequency entry and band plan', fields: [{ label: 'Flex step', value: 'Enabled' }, { label: 'Band plan', value: 'United Kingdom' }] },
];

/** EZ Scan's Advanced Features tabs (Display, Audio, Receive / PC-IF), with its defaults. */
const ADVANCED_PENDING: PendingCard[] = [
  { title: 'Display lines', fields: [{ label: 'Trunked line 3', value: 'Alpha Tag Only' }, { label: 'Trunked line 4', value: 'System Name Only' }, { label: 'Trunked line 5', value: 'Off' }, { label: 'Conventional line 3', value: 'Alpha Tag Only' }, { label: 'Conventional line 5', value: 'Off' }] },
  { title: 'Audio', fields: [{ label: 'Search AGC', value: 'Enabled' }, { label: 'Global AGC mode', value: 'Global' }, { label: 'Global AGC', value: 'Enabled' }, { label: 'Encrypted audio', value: 'Audio Tone' }, { label: 'Tone volume', value: '-24 dBm0' }, { label: 'IF output', value: 'Off' }, { label: 'IF level', value: 'Max', kind: 'slider' }, { label: 'Recording', value: 'Enabled' }, { label: 'Search record', value: 'Disabled' }] },
  { title: 'Receive and PC/IF', fields: [{ label: 'DSP level adapt', value: '64' }, { label: 'ADC gain', value: '+0 dB' }, { label: 'DAC gain', value: '-4 dB' }, { label: 'M36 status bits', value: 'Ignore' }, { label: 'M36 encrypted talkgroups', value: 'Ignore' }, { label: 'ED encrypted talkgroups', value: 'Ignore' }, { label: 'PC/IF data dump', value: 'Off' }, { label: 'Cycle count', value: '100', kind: 'number' }, { label: 'Skip button', value: 'Skip' }] },
  { title: 'ZeroMatic', fields: [{ label: 'Threshold', value: '1180', kind: 'number', unit: '900-1500' }, { label: 'Slope', value: '520', kind: 'number', unit: '450-600' }, { label: 'Delay', value: '50', kind: 'number', unit: '10-250' }] },
];

/**
 * The General tab: EZ Scan's General Settings and Advanced Features as one screen of cards, like the Search
 * tab. The welcome text, signal bars, scanlist control and scan sets are read from and written to the card;
 * the other cards are EZ Scan's screens mocked up with its defaults until their bytes are found, and are
 * greyed so nobody takes them for the card's values.
 */
export default function ProgGeneral({ prog, onChange }: { prog: Programming; onChange: (p: Programming) => void }) {
  const g = prog.globals;
  const named = prog.scanlists.filter((l) => l.name && !/^Scanlist \d{3}$/.test(l.name));
  const [setAnchor, setSetAnchor] = useState<{ rect: DOMRect; number: number } | null>(null);
  const welcome = [0, 1, 2, 3, 4].map((i) => g.welcome[i] ?? '');
  return (
    <div className="h-full overflow-auto p-4 text-sm text-ink-2">
      <div className="mb-4 flex flex-wrap items-center gap-6 text-[12.5px]">
        <span className="flex items-center gap-2">
          <span className="text-[10px] font-bold uppercase tracking-widest text-ink-2">Last Tune Mode frequency</span>
          <span className="font-mono text-amber">{g.lastTuneHz ? `${mhz(g.lastTuneHz)} MHz` : '—'}</span>
        </span>
        <span className="text-[11px] text-ink-3">Greyed cards are EZ Scan's screens with its defaults: where those settings live on the card is not yet known, so they are kept as read.</span>
      </div>
      <div className="grid gap-4" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(min(100%, 20rem), 1fr))' }}>
        <section className={card}>
          <h3 className={h3}>Welcome text</h3>
          <div className="lcd-screen lcd-radio rounded-lg bg-lcd font-mono leading-[1.35] text-lcd-ink">
            {welcome.map((l, i) => (
              <input
                key={i}
                className="lcd-line block w-full bg-transparent text-center text-lcd-ink outline-none placeholder:text-lcd-ink/40 focus:bg-lcd-ink/10"
                maxLength={NAME_MAX}
                value={l}
                placeholder={i === 0 ? 'line 1' : ''}
                onChange={(e) => onChange({ ...prog, globals: { ...g, welcome: welcome.map((w, j) => (j === i ? e.target.value : w)) } })}
                title="Shown at power-on, centred, up to 16 characters"
              />
            ))}
          </div>
        </section>
        <section className={card} style={{ gridRow: 'span 3' }}>
          <h3 className={h3}>Scanlist control</h3>
          <div className="max-h-[36rem] overflow-y-auto">
            <table className="w-full text-[12.5px]">
              <thead className="sticky top-0 bg-panel">
                <tr className="text-left text-[10px] font-bold uppercase tracking-widest text-ink-2">
                  <th className="py-1 pr-2">##</th>
                  <th className="py-1 pr-2">Alpha tag</th>
                  <th className="py-1 pr-2">Enabled</th>
                  <th className="py-1">Objects</th>
                </tr>
              </thead>
              <tbody>
                {prog.scanlists
                  .filter((l) => l.objects.length || !/^Scanlist \d{3}$/.test(l.name))
                  .map((l) => (
                    <tr key={l.number} className="border-b border-edge/60">
                      <td className="py-0.5 pr-2 font-mono text-[11px] text-ink-3">{String(l.number).padStart(2, '0')}</td>
                      <td className="py-0.5 pr-2 text-ink">
                        <TextCell value={l.name} maxLength={NAME_MAX} onCommit={(name) => onChange({ ...prog, scanlists: prog.scanlists.map((x) => (x.number === l.number ? { ...x, name } : x)) })} />
                      </td>
                      <td className="py-0.5 pr-2">
                        <input type="checkbox" className="accent-green" checked={l.enabled} onChange={(e) => onChange({ ...prog, scanlists: prog.scanlists.map((x) => (x.number === l.number ? { ...x, enabled: e.target.checked } : x)) })} />
                      </td>
                      <td className="py-0.5 font-mono text-[11px]">{l.objects.length}</td>
                    </tr>
                  ))}
              </tbody>
            </table>
          </div>
        </section>
        <section className={card}>
          <h3 className={h3}>Scan sets</h3>
          <table className="w-full text-[12.5px]">
            <tbody>
              {prog.scanSets
                .filter((s) => s.scanlists.length || !/^Scan Set \d{2}$/.test(s.name))
                .map((s) => (
                  <tr key={s.number} className="border-b border-edge/60">
                    <td className="py-0.5 pr-2 font-mono text-[11px] text-ink-3">{String(s.number).padStart(2, '0')}</td>
                    <td className="py-0.5 pr-2 text-ink">
                      <TextCell value={s.name} maxLength={NAME_MAX} onCommit={(name) => onChange({ ...prog, scanSets: prog.scanSets.map((x) => (x.number === s.number ? { ...x, name } : x)) })} />
                    </td>
                    <td className="py-0.5 pr-2">
                      <input type="checkbox" className="accent-green" checked={s.enabled} onChange={(e) => onChange({ ...prog, scanSets: prog.scanSets.map((x) => (x.number === s.number ? { ...x, enabled: e.target.checked } : x)) })} title="Enabled" />
                    </td>
                    <td className="py-0.5">
                      <button type="button" className="rounded border border-transparent px-1 text-left font-mono text-[11px] hover:border-edge" onClick={(e) => setSetAnchor({ rect: e.currentTarget.getBoundingClientRect(), number: s.number })} title="The scanlists in this set">
                        {s.scanlists.length > 24 ? `${s.scanlists.length} lists` : s.scanlists.join(', ') || <span className="text-ink-3">none</span>}
                      </button>
                    </td>
                  </tr>
                ))}
            </tbody>
          </table>
          {setAnchor && (
            <Popover anchor={setAnchor.rect} onClose={() => setSetAnchor(null)} width={360}>
              <ScanlistPicker value={prog.scanSets.find((s) => s.number === setAnchor.number)?.scanlists ?? []} named={named} onCommit={(scanlists) => onChange({ ...prog, scanSets: prog.scanSets.map((x) => (x.number === setAnchor.number ? { ...x, scanlists } : x)) })} onClose={() => setSetAnchor(null)} />
            </Popover>
          )}
        </section>
        <SignalBars bars={g.signalBars} onChange={(signalBars) => onChange({ ...prog, globals: { ...g, signalBars } })} />
        {GENERAL_PENDING.map((c) => (
          <PendingCardView key={c.title} card={c} />
        ))}
        {ADVANCED_PENDING.map((c) => (
          <PendingCardView key={c.title} card={c} advanced />
        ))}
      </div>
    </div>
  );
}

/** The RSSI thresholds that light the five signal bars, ascending from bar 1 to 5, as EZ Scan's Advanced Features has them. */
function SignalBars({ bars, onChange }: { bars: number[]; onChange: (bars: number[]) => void }) {
  if (bars.length !== 5) return null;
  const ascending = bars.every((v, i) => i === 0 || v > bars[i - 1]!);
  return (
    <section className={card}>
      <h3 className={h3}>Signal bars</h3>
      <p className="mb-2 text-[11px] text-ink-3">The RSSI each bar needs, ascending from bar 1 to 5. EZ Scan's defaults are 190, 230, 260, 290, 320.</p>
      <div className="grid grid-cols-5 gap-2">
        {bars.map((v, i) => (
          <label key={i} className="text-[11px] text-ink-3">
            Bar {i + 1}
            <TextCell value={String(v)} mono className={ascending ? '' : 'text-red'} onCommit={(s) => onChange(bars.map((b, j) => (j === i ? Math.max(0, Math.min(65535, Math.round(Number(s) || 0))) : b)))} title={`RSSI needed to light bar ${i + 1}`} />
          </label>
        ))}
      </div>
      {!ascending && <p className="mt-2 text-[11px] text-red">The values must rise from bar 1 to bar 5.</p>}
    </section>
  );
}

function PendingCardView({ card: c, advanced }: { card: PendingCard; advanced?: boolean }) {
  return (
    <section className={`${card} opacity-70`} title="EZ Scan's screen with its defaults: where these live on the card is not yet known, so they are shown for completeness and kept as read.">
      <div className="mb-2 flex items-baseline gap-2">
        <h3 className={`${h3} mb-0`}>{c.title}</h3>
        {advanced && <span className="rounded bg-panel-2 px-1 text-[9px] font-bold uppercase tracking-wider text-ink-3">Advanced</span>}
        <span className="ml-auto rounded bg-amber/15 px-1 text-[9px] font-bold uppercase tracking-wider text-amber">Not decoded</span>
      </div>
      <div className="space-y-1 text-[12px]">
        {c.fields.map((f) => (
          <Row key={f.label} label={f.label}>
            {f.kind === 'check' ? (
              <input type="checkbox" className="h-3.5 w-3.5 accent-cyan" checked={f.value !== 'off'} disabled readOnly />
            ) : f.kind === 'slider' ? (
              <span className="flex items-center gap-2">
                <input type="range" className="w-24 accent-cyan" value={f.value === 'Max' ? 100 : Number(f.value)} min={0} max={f.value === 'Max' ? 100 : Math.max(31, Number(f.value))} disabled readOnly />
                <span className="font-mono text-ink-3">{f.value}</span>
              </span>
            ) : f.kind === 'number' ? (
              <span className="flex items-center gap-1">
                <input className={`${field} w-16 font-mono`} value={f.value} disabled readOnly />
                {f.unit && <span className="text-[11px] text-ink-3">{f.unit}</span>}
              </span>
            ) : (
              <select className={field} value={f.value} disabled>
                <option>{f.value}</option>
              </select>
            )}
          </Row>
        ))}
      </div>
    </section>
  );
}

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="flex items-center justify-between gap-3">
      <span className="text-ink-2">{label}</span>
      {children}
    </label>
  );
}
