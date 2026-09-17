import { SOURCE_NAME, SOURCE_PILL } from '../lib/sources';
import { lookupRank, type LookupPref } from '../../../shared/sources';
import { NO_ID, formatId, parseScanObjectLine } from '@trxcontroller/rcip';
import { identify, isChannelScreen, splitFrequency } from '../lib/format';
import { ctcssHz, rankRepeaters, toneMatches } from '../../../shared/repeaters';
import { conventionalLabel, rrToneMatches } from '../../../shared/rr';
import { useScanner } from '../store/scanner';
import type { RepeaterMatch, RrInfo, WtrMatch } from '../../../shared/ipc';
import SignalMeter from './SignalMeter';

/** One size for every hero badge (RX state, mode, object type): fixed minimum width so AM / NFM or Scan / Search do not shift the row. */
const BADGE = 'inline-flex min-w-[4.25rem] justify-center rounded-md px-2.5 py-1 text-xs font-bold uppercase tracking-widest';

/** Colour-coded capability pills for a repeater: FM, DMR, D-STAR, Fusion. */
const MODE_PILL: Readonly<Record<string, string>> = {
  FM: 'bg-mode-fm/15 text-mode-fm',
  DMR: 'bg-mode-dmr/15 text-mode-dmr',
  'D-STAR': 'bg-mode-dstar/15 text-mode-dstar',
  Fusion: 'bg-mode-fusion/15 text-mode-fusion',
};

function ModePills({ modes }: { modes: string }) {
  const list = modes.split(' · ').filter(Boolean);
  if (list.length === 0) return null;
  return (
    <span className="inline-flex shrink-0 gap-1 align-middle">
      {list.map((m) => (
        <span key={m} className={`rounded px-1 py-px font-sans text-[9px] font-bold uppercase tracking-wider ${MODE_PILL[m] ?? 'bg-panel-2 text-ink-3'}`}>
          {m}
        </span>
      ))}
    </span>
  );
}

type Source = 'RRDB' | 'WTR' | 'UKR';

interface ListedRow {
  key: string;
  source: Source;
  name: string;
  detail: string;
  title: string;
  pills?: string;
}

const km = (d: number | null): string => (d === null ? '' : d < 10 ? `${d.toFixed(1)} km` : `${Math.round(d)} km`);

function listedRows(rr: RrInfo | null, licences: WtrMatch[], repeaters: RepeaterMatch[], detected: string | null, detectedHz: number | null, prefs: readonly LookupPref[]): ListedRow[] {
  const out: ListedRow[] = [];
  for (const sys of rr?.systems ?? []) {
    const tg = sys.talkgroup;
    out.push({
      key: `rr-s${sys.sid}`,
      source: 'RRDB',
      name: sys.name,
      detail: [sys.site?.descr, tg ? `${tg.descr || tg.alpha}${tg.category ? ` (${tg.category})` : ''}${tg.enc ? ' · enc' : ''}` : '', km(sys.distanceKm)].filter(Boolean).join(' · '),
      title: `RadioReference system ${sys.sid}${sys.city ? ` · ${sys.city}` : ''}${sys.site ? ` · site ${sys.site.descr} (${sys.site.location}) NAC ${sys.site.nac}` : ''}${tg ? ` · TG ${tg.tgDec} ${tg.alpha}` : ''}`,
    });
  }
  (rr?.conventional ?? []).forEach((c, i) => {
    const match = rrToneMatches(c.tone, detected);
    out.push({
      key: `rr-c${i}`,
      source: 'RRDB',
      name: c.descr || c.alpha,
      detail: [c.county, km(c.distanceKm), c.tone ? `${c.tone}${match === true ? ' ✓' : ''}` : '', c.mode, c.tags[0]].filter(Boolean).join(' · '),
      title: `${conventionalLabel(c)}${c.callsign ? ` · ${c.callsign}` : ''}${c.tags.length ? ` · ${c.tags.join(', ')}` : ''}${match === false ? ' · tone differs from the detected one' : ''}`,
    });
  });
  for (const l of licences) {
    out.push({
      key: `wtr-${l.id}`,
      source: 'WTR',
      name: l.licensee,
      detail: [km(l.distanceKm), l.mode, l.direction === 'R' ? 'mob' : l.direction === 'T' ? 'base' : ''].filter(Boolean).join(' · '),
      title: `${l.product} · ${l.emission || 'emission unknown'} · ${l.ngr || 'no grid ref'}${l.direction === 'R' ? ' · base receives here (mobiles transmit)' : ''}`,
    });
  }
  for (const r of repeaters) {
    const match = toneMatches(r, detectedHz);
    out.push({
      key: `rpt-${r.id}`,
      source: 'UKR',
      name: r.callsign,
      pills: r.modes,
      detail: [r.where ? r.where.charAt(0) + r.where.slice(1).toLowerCase() : '', km(r.distanceKm), r.ctcss !== null ? `${r.ctcss.toFixed(1)} Hz${match ? ' ✓' : ''}` : '', r.side === 'input' ? 'input' : '']
        .filter(Boolean)
        .join(' · '),
      title: `${r.channel || r.band}${r.inputHz ? ` · input ${(r.inputHz / 1e6).toFixed(4)}` : ''} · ${r.locator || 'no locator'}${r.side === 'input' ? ' · you are hearing its input (a mobile)' : ''}${
        match ? ' · CTCSS matches the detected tone' : detectedHz !== null && r.ctcss !== null ? ' · CTCSS differs from the detected tone' : ''
      }`,
    });
  }
  // The user's lookup order decides which comes first; within a lookup, nearest / best match first as built.
  return out
    .map((row, i) => ({ row, i, rank: lookupRank(prefs, row.source) }))
    .filter((x) => x.rank !== Infinity)
    .sort((a, b) => a.rank - b.rank || a.i - b.i)
    .map((x) => x.row);
}

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
  const { status, lcd, active, link, licences, repeaters, rr, lookups } = useScanner((s) => s.snapshot);
  const held = useScanner((s) => s.held);
  const snapshotUser = useScanner((s) => s.snapshot.radioUser);

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

  // Main resolves the user from the current poll only; the held copy keeps the
  // name on screen on the polls where the display shows the TGID line instead.
  const radioUser = snapshotUser && snapshotUser.id === radioId ? snapshotUser : held?.radioUser && held.radioUser.id === radioId ? held.radioUser : null;
  const location = radioUser ? [radioUser.city, radioUser.state, radioUser.country].filter(Boolean).join(', ') : '';
  // Everything that lists this frequency, in one block, in the user's lookup order (Data menu);
  // repeaters with the one whose CTCSS matches the detected tone first, since several share a
  // channel. Each source is filtered to the user's area upstream.
  const detectedHz = ctcssHz(detected);
  const listed = listedRows(rr, licences, rankRepeaters(repeaters, detected), detected, detectedHz, lookups);
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
        {listed.length > 0 ? (
          <div className="grid grid-cols-[auto_1fr] items-baseline gap-x-3">
            <span className="text-[10px] font-semibold uppercase tracking-widest text-ink-3" title="RadioReference, the Ofcom WTR and the ETCC repeater list, in the lookup order set in the Data menu">
              Listed
            </span>
            <ul className="min-w-0 space-y-0.5 font-mono text-[11.5px] leading-tight">
              {listed.slice(0, 3).map((row, i) => (
                <li key={row.key} className="flex min-w-0 items-center gap-2" title={row.title}>
                  <span className={`shrink-0 rounded px-1 py-px font-sans text-[9px] font-bold uppercase tracking-wider ${SOURCE_PILL[row.source]}`} title={SOURCE_NAME[row.source]}>
                    {row.source}
                  </span>
                  <span className={`shrink-0 truncate text-ink${i === 0 ? ' font-bold' : ''}`}>{row.name}</span>
                  {row.pills && <ModePills modes={row.pills} />}
                  <span className="min-w-0 truncate text-ink-3">{row.detail}</span>
                </li>
              ))}
            </ul>
          </div>
        ) : (
          <p className="pt-0.5 text-[10px] font-semibold uppercase tracking-widest text-ink-3/60">
            {!online ? '' : rr?.pending ? 'Asking RadioReference…' : rr?.error ? `RadioReference: ${rr.error}` : 'Not listed by RadioReference, Ofcom or the repeater list'}
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
