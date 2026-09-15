import { NO_ID, formatId, parseScanObjectLine } from '@trxcontroller/rcip';
import { identify, isChannelScreen, splitFrequency } from '../lib/format';
import { useScanner } from '../store/scanner';
import SignalMeter from './SignalMeter';

/** One size for every hero badge (RX state, mode, object type): fixed minimum width so AM / NFM or Scan / Search do not shift the row. */
const BADGE = 'inline-flex min-w-[4.25rem] justify-center rounded-md px-2.5 py-1 text-xs font-bold uppercase tracking-widest';

/**
 * `minCh` reserves a value width (in mono characters) so toggling text such as Muted / Unmuted
 * does not shift the neighbours. `flex` lets a long value (a radio user's location) take the
 * room that is left, up to a cap, and end in an ellipsis when the window is narrow.
 */
function Param({ label, value, title, minCh, flex }: { label: string; value: string | null | undefined; title?: string; minCh?: number; flex?: boolean }) {
  if (!value) return null;
  return (
    <div className={`flex flex-col whitespace-nowrap ${flex ? 'min-w-[6rem] max-w-[26rem] shrink' : 'shrink-0'}`} title={title}>
      <span className="text-[10px] font-semibold uppercase tracking-widest text-ink-3">{label}</span>
      <span className={`font-mono text-sm text-ink-2 ${flex ? 'truncate' : ''}`} style={minCh ? { minWidth: `${minCh}ch` } : undefined}>
        {value}
      </span>
    </div>
  );
}

export default function FrequencyHero() {
  const { status, lcd, active, link, radioUser, licences } = useScanner((s) => s.snapshot);
  const held = useScanner((s) => s.held);

  const online = (link.status === 'connected' || link.status === 'unresponsive') && status !== null;
  const receiving = !!status?.squelch.rf;
  const hz = status?.frequencyHz ?? 0;
  const { mhz, frac } = splitFrequency(hz);
  const id = identify(active, lcd, status, held);
  const h = active?.header ?? null;
  const modeText = status?.rxModeName ?? '';
  const icons = lcd?.icons;
  const objectLine = isChannelScreen(lcd, status) && lcd ? parseScanObjectLine(lcd.lines[2] ?? '') : null;
  // Details seen so far on this reception: the display alternates its TGID and
  // RadioID lines, so the held copy shows both at once until the signal drops.
  const details = held;
  const detected = details?.detectedTone ?? null;
  // The header carries the IDs on trunked / scanned objects; in Tune Mode and
  // the searches they only appear on the display.
  const tgid = h && h.talkgroupId1 !== NO_ID ? h.talkgroupId1 : (details?.tgid ?? null);
  const radioId = h && h.radioId1 !== NO_ID ? h.radioId1 : (details?.radioId ?? null);
  // The header's misc text repeats the slot line, with "--" where the display has the colour code.
  const slotText = details?.slot !== null && details?.slot !== undefined ? `${details.slot} · CC ${details.colorCode}` : null;
  const info = h?.miscText && !(slotText && /^Slot:/i.test(h.miscText)) ? h.miscText : null;
  // Header present but squelch closed: the scanner is holding on the channel
  // through its scan delay after a transmission.
  const rxState: 'rx' | 'hold' | 'idle' = receiving ? 'rx' : active?.header ? 'hold' : 'idle';

  const location = radioUser ? [radioUser.city, radioUser.state, radioUser.country].filter(Boolean).join(', ') : '';
  const ids = (
    <>
      {tgid !== null && <Param label="TGID" value={formatId(tgid)} />}
      {radioId !== null && (
        <Param
          label="Radio ID"
          value={radioUser ? [`${radioUser.callsign}${radioUser.name ? ' ' + radioUser.name : ''}`, location].filter(Boolean).join(' · ') : formatId(radioId)}
          title={radioUser ? `${formatId(radioId)} · ${radioUser.callsign} ${radioUser.name}${location ? ' · ' + location : ''}` : 'Radio ID (import the radioid.net database to resolve callsigns)'}
          flex={!!radioUser}
        />
      )}
      {slotText && <Param label="Slot" value={slotText} title="DMR time slot and colour code" />}
    </>
  );

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
          <div className="flex gap-1.5">
            <span
              className={`${BADGE} ${
                rxState === 'rx' ? 'bg-green text-bg' : rxState === 'hold' ? 'bg-amber text-bg' : 'border border-edge text-ink-3'
              }`}
            >
              {rxState === 'rx' ? 'RX' : rxState === 'hold' ? 'HOLD' : 'IDLE'}
            </span>
            {modeText && <span className={`${BADGE} border border-edge text-cyan`}>{modeText}</span>}
            {icons?.signalType && icons.signalTypeName !== modeText ? (
              <span className={`${BADGE} border border-edge text-ink-2`}>{icons.signalTypeName}</span>
            ) : null}
            {objectLine?.type && <span className={`${BADGE} border border-edge text-ink-2`}>{objectLine.type}</span>}
            {status && !objectLine && <span className={`${BADGE} border border-edge text-ink-3`}>{status.modeName}</span>}
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

      <div className="mt-3 h-[3.9rem] overflow-hidden border-t border-edge pt-2">
        {licences.length > 0 ? (
          <div className="grid grid-cols-[auto_1fr] items-baseline gap-x-3">
            <span className="text-[10px] font-semibold uppercase tracking-widest text-ink-3">Licensed</span>
            <ul className="min-w-0 space-y-0.5 font-mono text-[11.5px] leading-tight">
              {licences.slice(0, 3).map((l, i) => (
                <li key={l.id} className="flex min-w-0 gap-2" title={`${l.product} · ${l.emission || 'emission unknown'} · ${l.ngr || 'no grid ref'}${l.direction === 'R' ? ' · base receives here (mobiles transmit)' : ''}`}>
                  <span className={`truncate text-ink${i === 0 ? ' font-bold' : ''}`}>{l.licensee}</span>
                  <span className="shrink-0 text-ink-3">
                    {l.distanceKm !== null ? `${l.distanceKm < 10 ? l.distanceKm.toFixed(1) : Math.round(l.distanceKm)} km` : '—'}
                    {l.mode ? ` · ${l.mode}` : ''}
                    {l.direction === 'R' ? ' · mob' : l.direction === 'T' ? ' · base' : ''}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        ) : (
          <p className="pt-0.5 text-[10px] font-semibold uppercase tracking-widest text-ink-3/60">
            {online ? 'No Ofcom licence on this frequency' : ''}
          </p>
        )}
      </div>
      <div className="mt-2 flex h-12 gap-x-7 overflow-hidden border-t border-edge pt-3">
        {h ? (
          <>
            <Param label="Type" value={h.recordingType === 1 ? `${h.recordingTypeName} · ${h.tsysTypeName}` : h.recordingTypeName} />
            {ids}
            {h.siteName && <Param label="Site" value={h.siteName} />}
            <Param label="Squelch" value={h.squelchText} title="Programmed on the object" />
            {detected && <Param label="Detected" value={detected} title="Tone found by the scanner's tone lookup" />}
            {info && <Param label="Info" value={info} />}
            <Param label="Started" value={h.startTime.iso?.slice(11) ?? null} title={h.startTime.iso?.replace('T', ' ')} />
            {h.controlFrequencyHz > 0 && h.controlFrequencyHz !== h.voiceFrequencyHz && (
              <Param label="Control" value={(h.controlFrequencyHz / 1e6).toFixed(6)} />
            )}
          </>
        ) : (
          <>
            <Param label="Squelch" value={status ? (status.squelch.rf ? 'Open' : 'Closed') : null} minCh={6} />
            <Param label="Audio" value={status ? (status.squelch.unmuted ? 'Unmuted' : 'Muted') : null} minCh={7} />
            <Param label="ZeroMatic" value={status ? String(status.zeromatic) : null} minCh={3} />
            {ids}
            {detected && <Param label="Detected" value={detected} />}
          </>
        )}
      </div>
    </section>
  );
}
