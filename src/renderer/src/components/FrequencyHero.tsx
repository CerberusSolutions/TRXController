import { formatId, parseScanObjectLine } from '@trxcontroller/rcip';
import { identify, isChannelScreen, splitFrequency } from '../lib/format';
import { useScanner } from '../store/scanner';
import SignalMeter from './SignalMeter';

function Param({ label, value }: { label: string; value: string | null | undefined }) {
  if (!value) return null;
  return (
    <div className="flex flex-col">
      <span className="text-[10px] font-semibold uppercase tracking-widest text-ink-3">{label}</span>
      <span className="font-mono text-sm text-ink-2">{value}</span>
    </div>
  );
}

export default function FrequencyHero() {
  const { status, lcd, active, link, radioUser } = useScanner((s) => s.snapshot);
  const online = (link.status === 'connected' || link.status === 'unresponsive') && status !== null;
  const receiving = !!status?.squelch.rf;
  const hz = status?.frequencyHz ?? 0;
  const { mhz, frac } = splitFrequency(hz);
  const id = identify(active, lcd, status);
  const h = active?.header ?? null;
  const modeText = status?.rxModeName ?? '';
  const icons = lcd?.icons;
  const objectLine = isChannelScreen(lcd, status) && lcd ? parseScanObjectLine(lcd.lines[2] ?? '') : null;
  // Header present but squelch closed: the scanner is holding on the channel
  // through its scan delay after a transmission.
  const rxState: 'rx' | 'hold' | 'idle' = receiving ? 'rx' : active?.header ? 'hold' : 'idle';

  return (
    <section className={`rounded-xl border border-edge bg-panel p-5 ${receiving ? 'shadow-[inset_0_0_0_1px_rgba(61,220,132,0.35)]' : ''}`}>
      <div className="flex items-start justify-between">
        <div className="flex items-baseline font-mono">
          <span className={`freq-digits text-[64px] leading-none ${online ? 'text-amber' : 'text-ink-3'}`}>
            {online ? `${mhz}.` : '---.'}
          </span>
          <span className={`freq-digits text-[64px] leading-none ${online ? 'text-amber-2' : 'text-ink-3'}`}>
            {online ? frac : '------'}
          </span>
          <span className="ml-3 text-lg text-ink-3">MHz</span>
        </div>
        <div className="flex min-h-[5.5rem] flex-col items-end gap-1.5 pt-1">
          <span
            className={`rounded-md px-2.5 py-1 text-xs font-bold tracking-widest ${
              rxState === 'rx' ? 'bg-green text-bg' : rxState === 'hold' ? 'bg-amber text-bg' : 'border border-edge text-ink-3'
            }`}
          >
            {rxState === 'rx' ? 'RX' : rxState === 'hold' ? 'HOLD' : 'IDLE'}
          </span>
          <div className="flex gap-1.5 font-mono text-xs">
            {modeText && <span className="rounded border border-edge px-1.5 py-0.5 text-cyan">{modeText}</span>}
            {icons?.signalType && icons.signalTypeName !== modeText ? (
              <span className="rounded border border-edge px-1.5 py-0.5 text-ink-2">{icons.signalTypeName}</span>
            ) : null}
            {objectLine?.type && <span className="rounded border border-edge px-1.5 py-0.5 text-ink-2">{objectLine.type}</span>}
            {status && !objectLine && <span className="rounded border border-edge px-1.5 py-0.5 text-ink-3">{status.modeName}</span>}
          </div>
          <div className="flex h-5 gap-1 font-mono text-[10px] tracking-wider" title={objectLine?.flags ? `Object attributes: ${objectLine.flags.raw}` : undefined}>
            {objectLine?.flags &&
              (
                [
                  ['PRI', objectLine.flags.priority],
                  ['SKIP', objectLine.flags.skip],
                  ['DLY', objectLine.flags.delay],
                  ['REC', objectLine.flags.record],
                ] as const
              ).map(([label, on]) => (
                <span key={label} className={`rounded px-1.5 py-0.5 ${on ? 'bg-cyan/15 text-cyan' : 'border border-edge text-ink-3/60'}`}>
                  {label}
                </span>
              ))}
          </div>
        </div>
      </div>

      <div className="mt-4">
        <SignalMeter bars={icons?.rssiBars ?? 0} rssi={status?.rssi ?? null} active={online} />
      </div>

      <div className="mt-5 h-[4.25rem]">
        {id.source === 'none' ? (
          <p className="text-xl text-ink-3">{online ? status.modeName : link.status === 'disconnected' ? 'Not connected' : 'Waiting for scanner'}</p>
        ) : (
          <>
            <p className={`truncate text-3xl font-semibold tracking-tight ${id.source === 'scanning' ? 'text-ink-3' : 'text-ink'}`}>{id.name}</p>
            <p className="mt-0.5 truncate text-base text-ink-2">
              {id.system || id.detail}
              {id.system && id.detail ? <span className="text-ink-3"> · {id.detail}</span> : null}
            </p>
          </>
        )}
      </div>

      <div className="mt-4 flex h-12 gap-x-8 overflow-hidden border-t border-edge pt-3">
        {h ? (
          <>
            <Param label="Type" value={h.recordingTypeName} />
            {h.recordingType === 1 && <Param label="System" value={h.tsysTypeName} />}
            {h.talkgroupId1 !== 0xffffffff && <Param label="TGID" value={formatId(h.talkgroupId1)} />}
            {h.radioId1 !== 0xffffffff && (
              <Param
                label="Radio ID"
                value={radioUser ? `${formatId(h.radioId1)} · ${radioUser.callsign}${radioUser.name ? ' ' + radioUser.name : ''}` : formatId(h.radioId1)}
              />
            )}
            {radioUser && (radioUser.city || radioUser.country) && (
              <Param label="Location" value={[radioUser.city, radioUser.country].filter(Boolean).join(', ')} />
            )}
            {h.siteName && <Param label="Site" value={h.siteName} />}
            <Param label="Squelch" value={h.squelchText} />
            {h.controlFrequencyHz > 0 && <Param label="Control" value={(h.controlFrequencyHz / 1e6).toFixed(6)} />}
            {h.miscText && <Param label="Info" value={h.miscText} />}
            <Param label="Started" value={h.startTime.iso?.replace('T', ' ') ?? null} />
          </>
        ) : (
          <>
            <Param label="Squelch" value={status ? (status.squelch.rf ? 'Open' : 'Closed') : null} />
            <Param label="Audio" value={status ? (status.squelch.unmuted ? 'Unmuted' : 'Muted') : null} />
            <Param label="ZeroMatic" value={status ? String(status.zeromatic) : null} />
          </>
        )}
      </div>
    </section>
  );
}
