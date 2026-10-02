import { SOURCE_NAME, SOURCE_PILL } from '../lib/sources';
import { NO_ID, formatId, isPlaceholderName, parseScanObjectLine } from '@trxcontroller/rcip';
import { identify, isChannelScreen, splitFrequency } from '../lib/format';
import { formatPlace } from '../../../shared/geo';
import { candidatesFor } from '../../../shared/listed';
import { detectedCode } from '../../../shared/rr';
import { useIdentities } from '../store/identities';
import { useLog } from '../store/log';
import { useScanner } from '../store/scanner';
import { pickRadioName } from '../../../shared/radioNames';
import { pickTgName } from '../../../shared/tgNames';
import { useDsd } from '../store/dsd';
import { useEffect, useState } from 'react';
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
        <span key={m} className={`rounded px-1 py-px font-sans text-[10px] font-bold uppercase tracking-wider ${MODE_PILL[m] ?? 'bg-panel-2 text-ink-3'}`}>
          {m}
        </span>
      ))}
    </span>
  );
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
      <span className="text-[10px] font-bold uppercase tracking-widest text-ink-2">{label}</span>
      <span className={`font-mono text-sm text-ink-2 ${flex ? 'truncate' : ''}`} style={minCh ? { minWidth: `${minCh}ch` } : undefined}>
        {value}
      </span>
    </div>
  );
}

/**
 * The Radio ID parameter with a pencil: the name the user gave the radio (Data › Confirmed identities › Radios)
 * ahead of the scanner's own alpha tag and radioid.net, and a box to give it one without leaving the hero.
 */
function RadioParam({ radioId, system, alias, user, location }: { radioId: number | null; system: string; alias: string | null; user: { callsign: string; name: string } | null; location: string }) {
  const radioNames = useLog((s) => s.radioNames);
  const nameRadio = useLog((s) => s.nameRadio);
  const named = pickRadioName(radioNames, radioId, system);
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState('');
  // The scanner moving to another radio closes the box: a name typed for one must never land on the next.
  useEffect(() => setEditing(false), [radioId, system]);
  const userText = user ? `${user.callsign}${user.name ? ' ' + user.name : ''}` : null;
  const value = named ? [named.name, alias].filter(Boolean).join(' · ') : alias ? [alias, userText].filter(Boolean).join(' · ') : user ? [userText, location].filter(Boolean).join(' · ') : radioId !== null ? formatId(radioId) : null;
  const title = [
    radioId !== null ? formatId(radioId) : '',
    named ? `${named.name} is your name for this radio${named.system ? ` on ${named.system}` : ''}` : '',
    alias ? `${alias} is the scanner's own alpha tag for it` : '',
    userText ? `radioid.net: ${userText}${location ? ' · ' + location : ''}` : '',
    !named && !alias && !user ? 'Radio ID (import the radioid.net database to resolve callsigns)' : '',
  ]
    .filter(Boolean)
    .join(' · ');
  if (!value) return null;
  const save = (): void => {
    const name = text.trim();
    if (name && radioId !== null) void nameRadio({ radioId, system, name });
    setEditing(false);
  };
  return (
    <div className="flex min-w-[6rem] max-w-[26rem] shrink items-end gap-1 whitespace-nowrap" title={editing ? undefined : title}>
      {editing && radioId !== null ? (
        <div className="flex min-w-0 flex-col">
          <span className="text-[10px] font-bold uppercase tracking-widest text-ink-2">Radio ID {formatId(radioId)}{system ? ` on ${system}` : ''}</span>
          <input
            autoFocus
            className="w-56 rounded border border-edge bg-panel px-1.5 py-px font-sans text-[12px] text-ink placeholder:text-ink-3 outline-none focus:border-cyan"
            placeholder="Name this radio…"
            value={text}
            onFocus={(e) => e.target.select()}
            onChange={(e) => setText(e.target.value)}
            onBlur={() => setEditing(false)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') save();
              if (e.key === 'Escape') setEditing(false);
              e.stopPropagation();
            }}
          />
        </div>
      ) : (
        <>
          <div className="flex min-w-0 flex-col">
            <span className="text-[10px] font-bold uppercase tracking-widest text-ink-2">Radio ID</span>
            <span className="truncate font-mono text-sm text-ink-2">{value}</span>
          </div>
          {radioId !== null && (
            <button
              type="button"
              className="shrink-0 rounded px-1 text-[11px] leading-5 text-ink-3 hover:bg-panel-2 hover:text-ink"
              title={named ? `Change your name for radio ${formatId(radioId)}` : `Give radio ${formatId(radioId)} a name of your own (shown ahead of the scanner's alpha tag and radioid.net)`}
              onClick={() => {
                setText(named?.name ?? '');
                setEditing(true);
              }}
            >
              ✎
            </button>
          )}
        </>
      )}
    </div>
  );
}

/**
 * The TGID parameter with a pencil: a box to give the talkgroup a name of your own without leaving the hero. The name
 * itself shows on the name line (ahead of the scanner's UNID or alpha tag), with a TG or DSD pill after it.
 */
function TgParam({ tgid, system, named }: { tgid: number; system: string; named: { name: string; source: 'USER' | 'DSD' } | null }) {
  const nameTalkgroup = useLog((s) => s.nameTalkgroup);
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState('');
  // The scanner moving to another talkgroup closes the box: a name typed for one must never land on the next.
  useEffect(() => setEditing(false), [tgid, system]);
  const title = [
    `Talkgroup ${formatId(tgid)}${system ? ` on ${system}` : ''}`,
    named ? (named.source === 'USER' ? `${named.name} is your name for it` : `${named.name} is DSD+'s alias for it (DSDPlus.groups)`) : '',
  ]
    .filter(Boolean)
    .join(' · ');
  const save = (): void => {
    const name = text.trim();
    if (name) void nameTalkgroup({ tgid, system, name, source: 'USER' });
    setEditing(false);
  };
  return (
    <div className="flex shrink-0 items-end gap-1 whitespace-nowrap" title={editing ? undefined : title}>
      {editing ? (
        <div className="flex min-w-0 flex-col">
          <span className="text-[10px] font-bold uppercase tracking-widest text-ink-2">TGID {formatId(tgid)}{system ? ` on ${system}` : ''}</span>
          <input
            autoFocus
            className="w-56 rounded border border-edge bg-panel px-1.5 py-px font-sans text-[12px] text-ink placeholder:text-ink-3 outline-none focus:border-cyan"
            placeholder="Name this talkgroup…"
            value={text}
            onFocus={(e) => e.target.select()}
            onChange={(e) => setText(e.target.value)}
            onBlur={() => setEditing(false)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') save();
              if (e.key === 'Escape') setEditing(false);
              e.stopPropagation();
            }}
          />
        </div>
      ) : (
        <>
          <div className="flex flex-col">
            <span className="text-[10px] font-bold uppercase tracking-widest text-ink-2">TGID</span>
            <span className="font-mono text-sm text-ink-2">{formatId(tgid)}</span>
          </div>
          <button
            type="button"
            className="shrink-0 rounded px-1 text-[11px] leading-5 text-ink-3 hover:bg-panel-2 hover:text-ink"
            title={named?.source === 'USER' ? `Change your name for talkgroup ${formatId(tgid)}` : `Give talkgroup ${formatId(tgid)} a name of your own (shown ahead of the scanner's UNID or alpha tag${named ? " and DSD+'s alias" : ''})`}
            onClick={() => {
              setText(named?.name ?? '');
              setEditing(true);
            }}
          >
            ✎
          </button>
        </>
      )}
    </div>
  );
}

export default function FrequencyHero() {
  const { status, lcd, active, link, licences, repeaters, rr, rruk, lookups, confirmed } = useScanner((s) => s.snapshot);
  const tgNames = useLog((s) => s.tgNames);
  // The DSD+ network DSD+ is parked on: its talkgroup aliases are keyed to it until main has matched it to the scanner's system tag.
  const dsdNetwork = useDsd((s) => s.status?.feed.network?.id ?? null);
  const held = useScanner((s) => s.held);
  const units = useIdentities((s) => s.settings.units);
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
  // What the lookups' tones / colour codes are matched against: the tone, else the DMR colour code.
  const code = detectedCode(details);
  // The header carries the IDs on trunked / scanned objects; in Tune Mode and
  // the searches they only appear on the display.
  const tgid = h && h.talkgroupId1 !== NO_ID ? h.talkgroupId1 : (details?.tgid ?? null);
  const radioId = h && h.radioId1 !== NO_ID ? h.radioId1 : (details?.radioId ?? null);
  // The alpha tag the scanner shows for the radio from its own Radio ID list: its word, ahead of radioid.net.
  const radioAlias = details?.radioAlias ?? null;
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
  // Everything that lists this frequency, in one block, ranked as the log stores it: placed
  // entries first, then the user's lookup order (Data menu), repeaters with the one whose CTCSS
  // matches the detected tone first. Each source is filtered to the user's area upstream.
  const listed = candidatesFor({ rr, rruk, licences, repeaters, detectedTone: code }, lookups);
  // An identity the user confirmed for this frequency (and tone / talkgroup) outranks everything shown.
  const conf = confirmed && confirmed.frequencyHz === hz ? confirmed : null;
  const scannerName = (id.source === 'active' || id.source === 'lcd') && id.name !== '—' ? id.name : '';
  // An object the scanner has no name for, or names only by its frequency (with the fingerprint notes a
  // user adds while identifying it, "453.0625 CC15"), takes the highest-ranked listing's name here, as
  // the log does; the scanner's text stays beneath so the two can be compared.
  const unnamed = (id.source === 'active' || id.source === 'lcd') && isPlaceholderName(scannerName);
  // The talkgroup's name: the user's own stands in for the scanner's alpha tag (short of a confirmation); DSD+'s
  // alias only where the scanner shows UNID or nothing. Keyed to the system tag on a trunked object, '' elsewhere.
  const tgSystem = h && h.recordingType === 1 ? h.systemTag : '';
  const tgNamed = pickTgName(tgNames, tgid, [tgSystem, dsdNetwork]);
  const tg = !conf && tgNamed && (id.source === 'active' || id.source === 'lcd') && (tgNamed.source === 'USER' || unnamed) ? tgNamed : null;
  const top = !conf && !tg && unnamed && listed.length > 0 ? listed[0]! : null;
  const ids = (
    <>
      {tgid !== null && <TgParam tgid={tgid} system={tgSystem} named={tgNamed} />}
      {(radioId !== null || radioAlias) && (
        // Radio IDs are local to a trunked system, so a name is keyed to the system tag there and to nothing on a conventional object.
        <RadioParam radioId={radioId} system={h && h.recordingType === 1 ? h.systemTag : ''} alias={radioAlias} user={radioUser} location={location} />
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
        {id.source === 'none' && !conf ? (
          <p className="text-xl text-ink-3">{online ? status.modeName : link.status === 'disconnected' ? 'Not connected' : 'Waiting for scanner'}</p>
        ) : conf && id.source !== 'scanning' ? (
          <>
            <p className="flex min-w-0 items-center gap-2 text-3xl font-semibold tracking-tight text-ink" title={`${SOURCE_NAME.CONF}${conf.detail ? ` · ${conf.detail}` : ''}`}>
              {/* Pill after the name, so the name stays put as the scanner moves between confirmed and unconfirmed channels. */}
              <span className="truncate">{conf.name}</span>
              <span className={`shrink-0 rounded px-1.5 py-0.5 font-sans text-[10px] font-bold uppercase tracking-wider ${SOURCE_PILL.CONF}`}>CONF</span>
            </p>
            <p className="mt-0.5 truncate text-base text-ink-2">
              {scannerName && scannerName !== conf.name ? <span className="text-ink-3">Scanner: {scannerName} · </span> : null}
              {conf.system || id.system || id.detail}
              {(conf.system || id.system) && id.detail ? <span className="text-ink-3"> · {id.detail}</span> : null}
            </p>
          </>
        ) : tg ? (
          <>
            <p className="flex min-w-0 items-center gap-2 text-3xl font-semibold tracking-tight text-ink" title={tg.source === 'USER' ? SOURCE_NAME.TG : SOURCE_NAME.DSD}>
              <span className="truncate">{tg.name}</span>
              <span className={`shrink-0 rounded px-1.5 py-0.5 font-sans text-[10px] font-bold uppercase tracking-wider ${SOURCE_PILL[tg.source === 'USER' ? 'TG' : 'DSD']}`}>{tg.source === 'USER' ? 'TG' : 'DSD'}</span>
            </p>
            <p className="mt-0.5 truncate text-base text-ink-2">
              {scannerName && scannerName !== tg.name ? <span className="text-ink-3">Scanner: {scannerName} · </span> : null}
              {id.system || id.detail}
              {id.system && id.detail ? <span className="text-ink-3"> · {id.detail}</span> : null}
            </p>
          </>
        ) : top ? (
          <>
            <p className="flex min-w-0 items-center gap-2 text-3xl font-semibold tracking-tight text-ink" title={top.title}>
              <span className="truncate">{top.name}</span>
              <span className={`shrink-0 rounded px-1.5 py-0.5 font-sans text-[10px] font-bold uppercase tracking-wider ${SOURCE_PILL[top.source]}`} title={SOURCE_NAME[top.source]}>
                {top.source}
              </span>
            </p>
            <p className="mt-0.5 truncate text-base text-ink-2">
              {scannerName ? <span className="text-ink-3">Scanner: {scannerName} · </span> : null}
              {id.system || id.detail}
              {id.system && id.detail ? <span className="text-ink-3"> · {id.detail}</span> : null}
            </p>
          </>
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

      <div className="mt-3 h-[4.6rem] overflow-hidden border-t border-edge pt-2">
        {listed.length > 0 ? (
          <div className="grid grid-cols-[auto_1fr] items-baseline gap-x-3">
            <span className="flex items-center gap-2 text-[10px] font-bold uppercase tracking-widest text-ink-2" title="RadioReference UK, RadioReference, the Ofcom WTR and the ETCC repeater list, in the lookup order set in the Data menu">
              Listed
              <button
                type="button"
                className="rounded border border-edge px-1 py-px font-sans text-[9px] font-bold uppercase tracking-wider text-ink-3 hover:text-ink"
                title="Open the map window: you and every listing pinned, following the scanner"
                onClick={() => void window.trx.mapOpen?.({ kind: 'follow' })}
              >
                map
              </button>
            </span>
            <ul className="min-w-0 space-y-0.5 font-mono text-[13.5px] leading-tight">
              {listed.slice(0, 3).map((row, i) => (
                <li key={row.key} className="flex min-w-0 items-center gap-2" title={row.title}>
                  <span className={`shrink-0 rounded px-1 py-px font-sans text-[10px] font-bold uppercase tracking-wider ${SOURCE_PILL[row.source]}`} title={SOURCE_NAME[row.source]}>
                    {row.source}
                  </span>
                  <span className={`shrink-0 truncate text-ink${i === 0 ? ' font-bold' : ''}`}>{row.name}</span>
                  {row.pills && <ModePills modes={row.pills} />}
                  <span className="min-w-0 flex-1 truncate text-ink-3">{row.detail}</span>
                  <span className="shrink-0 text-ink-2" title={row.distanceKm === null ? undefined : 'Distance and bearing from your location (Data menu)'}>
                    {formatPlace(row, units)}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        ) : (
          <p className="pt-0.5 text-[10px] font-bold uppercase tracking-widest text-ink-3/70">
            {!online
              ? ''
              : rruk?.pending
                ? 'Asking RadioReference UK…'
                : rr?.pending
                  ? 'Asking RadioReference…'
                  : rruk?.error
                    ? `RadioReference UK: ${rruk.error}`
                    : rr?.error
                      ? `RadioReference: ${rr.error}`
                      : 'Not listed by RadioReference UK, RadioReference, Ofcom or the repeater list'}
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
