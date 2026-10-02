import { useEffect, useState } from 'react';
import type { RrRegion } from '../../../shared/ipc';
import { useIdentities } from '../store/identities';
import { useLog } from '../store/log';
import { useDsd } from '../store/dsd';
import { useScanner } from '../store/scanner';
import { useUi } from '../store/ui';
import { SOURCE_NAME, SOURCE_PILL } from '../lib/sources';
import { normaliseLookups, type LookupPref } from '../../../shared/sources';
import { KM_PER_MILE, type Units } from '../../../shared/geo';

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="border-t border-edge pt-3 first:border-t-0 first:pt-0">
      <p className="text-[11px] font-bold uppercase tracking-widest text-ink-2">{title}</p>
      {children}
    </div>
  );
}

function LocationForm() {
  const { settings, saveSettings } = useIdentities();
  const units: Units = settings.units ?? 'km';
  // The radius is stored in km and shown in the chosen units.
  const radiusShown = (km: number | null): string => (km === null ? '' : units === 'mi' ? String(Math.round((km / KM_PER_MILE) * 10) / 10) : String(km));
  const [lat, setLat] = useState(settings.lat?.toString() ?? '');
  const [lon, setLon] = useState(settings.lon?.toString() ?? '');
  const [radius, setRadius] = useState(radiusShown(settings.radiusKm));
  useEffect(() => {
    setLat(settings.lat?.toString() ?? '');
    setLon(settings.lon?.toString() ?? '');
    setRadius(radiusShown(settings.radiusKm));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [settings]);
  const inp = 'w-full rounded-md border border-edge bg-panel-2 px-2 py-1 font-mono text-xs text-ink outline-none focus:border-cyan';
  const save = (): void => {
    const n = (s: string): number | null => (s.trim() === '' ? null : Number(s));
    const r = n(radius);
    void saveSettings({ lat: n(lat), lon: n(lon), radiusKm: r === null ? null : units === 'mi' ? Math.round(r * KM_PER_MILE * 10) / 10 : r });
  };
  const chooseUnits = (u: Units): void => {
    if (u !== units) void saveSettings({ units: u });
  };
  return (
    <div className="mt-1 grid grid-cols-[1fr_1fr_4.5rem_auto_auto] items-end gap-2">
      <label className="text-[10px] text-ink-3">
        Latitude
        <input className={inp} value={lat} placeholder="51.5074" onChange={(e) => setLat(e.target.value)} />
      </label>
      <label className="text-[10px] text-ink-3">
        Longitude
        <input className={inp} value={lon} placeholder="-0.1278" onChange={(e) => setLon(e.target.value)} />
      </label>
      <label className="text-[10px] text-ink-3">
        Radius
        <input className={inp} value={radius} placeholder={units === 'mi' ? '37' : '60'} onChange={(e) => setRadius(e.target.value)} />
      </label>
      <div className="flex overflow-hidden rounded-md border border-edge text-[11px]" role="radiogroup" aria-label="Distance units" title="How distances and the radius are shown">
        {(['km', 'mi'] as const).map((u) => (
          <button key={u} role="radio" aria-checked={units === u} className={`px-2 py-1 ${units === u ? 'bg-panel-2 text-ink' : 'text-ink-3 hover:text-ink'}`} onClick={() => chooseUnits(u)}>
            {u === 'km' ? 'km' : 'miles'}
          </button>
        ))}
      </div>
      <button className="rounded-md border border-edge px-2 py-1 text-xs text-ink-2 hover:text-ink" onClick={save}>
        Save
      </button>
    </div>
  );
}

/**
 * The order in which lookups fill a name the scanner did not have, with a tick to switch one
 * off (it is then neither queried nor shown) when it is offline or returning junk.
 */
function LookupOrder() {
  const { settings, saveSettings } = useIdentities();
  const prefs = normaliseLookups(settings.lookups);
  const save = (next: LookupPref[]): void => void saveSettings({ lookups: next });
  const move = (i: number, d: -1 | 1): void => {
    const next = prefs.slice();
    const [p] = next.splice(i, 1);
    next.splice(i + d, 0, p!);
    save(next);
  };
  const short: Record<LookupPref['id'], string> = { WTR: 'Ofcom licence register', RRUK: 'RadioReference UK', RRDB: 'RadioReference.com', UKR: 'RSGB repeater list' };
  const btn = 'rounded border border-edge px-1 text-[10px] leading-4 text-ink-3 hover:text-ink disabled:opacity-30 disabled:hover:text-ink-3';
  return (
    <ol className="mt-1 space-y-1 text-xs">
      <li className="flex items-center gap-2 text-ink-2">
        <span className="w-4 text-right font-mono text-ink-3">1</span>
        <span className="w-8" />
        <span className="flex-1">Scanner's own programming</span>
        <span className="text-[10px] text-ink-3">always first</span>
      </li>
      {prefs.map((p, i) => (
        <li key={p.id} className={`flex items-center gap-2 ${p.enabled ? 'text-ink-2' : 'text-ink-3'}`}>
          <span className="w-4 text-right font-mono text-ink-3">{i + 2}</span>
          <span className={`w-8 rounded px-1 py-px text-center font-sans text-[9px] font-bold uppercase tracking-wider ${p.enabled ? SOURCE_PILL[p.id] : 'bg-panel-2 text-ink-3'}`}>{p.id}</span>
          <label className="flex flex-1 cursor-pointer items-center gap-2">
            <input
              type="checkbox"
              className="accent-cyan"
              checked={p.enabled}
              title={p.enabled ? 'Untick to ignore this lookup (it is neither queried nor shown)' : 'Tick to use this lookup again'}
              onChange={(e) => save(prefs.map((q, j) => (j === i ? { ...q, enabled: e.target.checked } : q)))}
            />
            <span className={p.enabled ? '' : 'line-through'} title={SOURCE_NAME[p.id]}>
              {short[p.id]}
            </span>
          </label>
          <button className={btn} disabled={i === 0} title="Move up" onClick={() => move(i, -1)}>
            ▲
          </button>
          <button className={btn} disabled={i === prefs.length - 1} title="Move down" onClick={() => move(i, 1)}>
            ▼
          </button>
        </li>
      ))}
    </ol>
  );
}

/** A time in the user's own format (12- or 24-hour as their system has it); `iso` is the scanner's local time as the header gives it. */
const hms = (t: number | string): string => new Date(t).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit', second: '2-digit' });
const whenIso = (iso: string): string => new Date(iso).toLocaleString(undefined, { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' });

/** The scanner's clock from this PC: on every connect (the tick) or now (the button); the next transmission confirms it. */
function ClockForm() {
  const { settings, saveSettings } = useIdentities();
  const snapshot = useScanner((s) => s.snapshot);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const connected = snapshot.link.status === 'connected' || snapshot.link.status === 'unresponsive';
  const clock = snapshot.clock ?? { sentAt: null, order: 'le', verified: null, scannerTime: null, offsetS: null };
  const setNow = async (): Promise<void> => {
    setBusy(true);
    setError(null);
    try {
      await window.trx?.clockSet?.();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  const order = clock.order === 'be' ? 'big-endian' : 'little-endian';
  return (
    <div className="mt-1 space-y-1.5 text-[11px] text-ink-3">
      <label className="flex items-center gap-2 text-[12px] text-ink-2">
        <input type="checkbox" className="h-3.5 w-3.5 accent-cyan" checked={settings.clockSync !== false} onChange={(e) => void saveSettings({ clockSync: e.target.checked })} />
        Set the scanner's clock from this PC when it connects
      </label>
      <div className="flex flex-wrap items-center gap-2">
        <button className="rounded-md border border-edge px-2 py-1 text-[11px] text-ink-2 hover:text-ink disabled:opacity-40" disabled={!connected || busy} onClick={() => void setNow()} title="Send the PC's date and time to the scanner now">
          Set clock now
        </button>
        <span>
          {!connected
            ? 'Connect the scanner to set its clock.'
            : clock.sentAt === null
              ? 'Not set yet this connection.'
              : clock.verified === null
                ? `Sent at ${hms(clock.sentAt)} (${order}). The next transmission's time stamp will confirm it.`
                : clock.verified
                  ? `Set at ${hms(clock.sentAt)}; a transmission at ${clock.scannerTime ? hms(clock.scannerTime) : '?'} confirmed the scanner's clock (${Math.abs(Math.round(clock.offsetS ?? 0))} s from this PC).`
                  : `Sent at ${hms(clock.sentAt)}, but the scanner's clock read ${clock.scannerTime ? whenIso(clock.scannerTime) : '?'}, ${Math.round(Math.abs(clock.offsetS ?? 0) / 60)} min out, with both byte orders tried. Please report it.`}
        </span>
      </div>
      {error && <p className="text-red">{error}</p>}
    </div>
  );
}

/** How long the scanner may sit on one carrier in Scan mode before the app presses ► for it. */
function ScanTimeoutForm() {
  const { settings, saveSettings } = useIdentities();
  const value = settings.scanTimeoutS ?? 0;
  const choices: [number, string][] = [
    [0, 'Off'],
    [10, '10 s'],
    [20, '20 s'],
    [30, '30 s'],
    [60, '1 min'],
    [120, '2 min'],
  ];
  return (
    <div className="mt-1 flex flex-wrap items-center gap-2">
      <div className="flex overflow-hidden rounded-md border border-edge text-[11px]" role="radiogroup" aria-label="Scan timeout">
        {choices.map(([secs, label]) => (
          <button
            key={secs}
            role="radio"
            aria-checked={value === secs}
            className={`px-2 py-1 ${value === secs ? 'bg-panel-2 text-ink' : 'text-ink-3 hover:text-ink'}`}
            onClick={() => void saveSettings({ scanTimeoutS: secs === 0 ? null : secs })}
          >
            {label}
          </button>
        ))}
      </div>
      <p className="text-[11px] text-ink-3">
        {value === 0
          ? 'The scanner stays on a carrier as long as its own delay settings allow.'
          : `After ${value} s on one carrier in Scan mode the app presses ► so scanning resumes; a dead carrier or a stuck beacon then costs ${value} s, not the session.`}
      </p>
    </div>
  );
}

/** The DSD+ link: the folder DSD+ runs in, and what the watcher finds there. */
function DsdForm() {
  const status = useDsd((s) => s.status);
  const chooseFolder = useDsd((s) => s.chooseFolder);
  const clearFolder = useDsd((s) => s.clearFolder);
  const open = useDsd((s) => s.open);
  const when = (t: number | null): string => (t ? new Date(t).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false }) : '');
  return (
    <div className="mt-1">
      <p className="text-[11px] text-ink-3">
        DSD+ decodes a trunked system's control channel and sees every call; the TRX follows one. With its folder set, the app reads DSDPlus.event, .radios and .groups as DSD+
        writes them: calls in the System window, radio aliases into the log as DSD+ learns them.
      </p>
      <div className="mt-2 flex items-center gap-2">
        <span className="min-w-0 flex-1 truncate font-mono text-[11px] text-ink" title={status?.folder ?? undefined}>
          {status?.folder ?? <span className="text-ink-3">No folder set</span>}
        </span>
        <button className="shrink-0 rounded-md border border-edge px-2.5 py-1 text-[12px] text-ink-2 hover:text-ink" onClick={() => void chooseFolder()}>
          {status?.folder ? 'Change…' : 'Choose folder…'}
        </button>
        {status?.folder && (
          <button className="shrink-0 rounded-md border border-edge px-2.5 py-1 text-[12px] text-ink-2 hover:text-red" title="Switch the link off" onClick={() => void clearFolder()}>
            Off
          </button>
        )}
      </div>
      {status?.folder && (
        <ul className="mt-2 space-y-0.5 text-[11px] text-ink-2">
          <li>
            {status.error ? (
              <span className="text-red">{status.error}</span>
            ) : status.event.found ? (
              <>
                <span className={status.alive ? 'text-green' : 'text-amber'}>{status.alive ? '● DSD+ live' : '● DSD+ quiet'}</span>
                {status.feed.network && <span className="text-ink-3"> · {status.feed.network.name || status.feed.network.id}</span>}
                {status.feed.lastEventAt && <span className="text-ink-3"> · last event {when(status.feed.lastEventAt)}</span>}
              </>
            ) : (
              <span className="text-amber">No DSDPlus.event in that folder yet. DSD+ writes it as it runs.</span>
            )}
          </li>
          <li className="text-ink-3">
            {status.radios.found ? `Radios: ${status.radios.named} named from DSDPlus.radios${status.radios.importedAt ? ` at ${when(status.radios.importedAt)}` : ''}` : 'No DSDPlus.radios yet'}
            {' · '}
            {status.groups.found ? `${status.groups.count} talkgroups in DSDPlus.groups` : 'no DSDPlus.groups yet'}
          </li>
          <li className="text-ink-3" title="Every transmission, registration, affiliation and alias return goes into the log database; the System window's History view reads it">
            {status.recorded.toLocaleString()} events recorded this session
          </li>
        </ul>
      )}
      {status?.folder && (
        <button className="mt-2 w-full rounded-md border border-edge px-3 py-1.5 text-sm text-ink-2 hover:text-ink" onClick={open}>
          Open the System window
        </button>
      )}
    </div>
  );
}

/** What the user has confirmed by hand, with a way to withdraw one or all. */
function ConfirmedList() {
  const confirmations = useLog((s) => s.confirmations);
  const unconfirm = useLog((s) => s.unconfirm);
  const radioNames = useLog((s) => s.radioNames);
  const unnameRadio = useLog((s) => s.unnameRadio);
  const tgNames = useLog((s) => s.tgNames);
  const unnameTalkgroup = useLog((s) => s.unnameTalkgroup);
  const radioImport = useLog((s) => s.radioImport);
  const importRadios = useLog((s) => s.importRadios);
  const dsd = (
    <div className="mt-2">
      <button className="w-full rounded-md border border-edge px-3 py-1.5 text-sm text-ink-2 hover:text-ink disabled:opacity-50" disabled={radioImport.busy} title="Name every radio DSD+ has an alias for, from its DSDPlus.radios file (in the DSD+ folder); the names apply on any system" onClick={() => void importRadios()}>
        {radioImport.busy ? 'Importing…' : 'Import DSD+ radio list…'}
      </button>
      {radioImport.result && !radioImport.busy && (
        <p className="mt-1 text-xs text-green">
          Named {radioImport.result.imported.toLocaleString()} radios from {radioImport.result.file}
          {radioImport.result.skipped ? `, ${radioImport.result.skipped} lines without an alias skipped` : ''}.
        </p>
      )}
      {radioImport.error && <p className="mt-1 text-xs text-red">{radioImport.error}</p>}
    </div>
  );
  if (confirmations.length === 0 && radioNames.length === 0 && tgNames.length === 0)
    return (
      <>
        <p className="mt-1 text-[11px] text-ink-3">None yet. Unfold a log row with + and confirm the right candidate, type a name, or name a talkgroup or radio ID (there, or with ✎ beside the hero's TGID and Radio ID).</p>
        {dsd}
      </>
    );
  return (
    <div className="mt-1">
      {radioNames.length > 0 && (
        <>
          <p className="mb-0.5 text-[10px] font-bold uppercase tracking-widest text-ink-3">Radios</p>
          <ul className="mb-2 max-h-32 space-y-0.5 overflow-y-auto font-mono text-[11px] text-ink-2">
            {radioNames.map((n) => (
              <li key={n.id} className="flex items-center gap-2">
                <span className="text-amber-2" title="Radio ID">{n.radioId}</span>
                <span className="w-24 shrink-0 truncate text-ink-3" title={n.system || 'Any system'}>{n.system || 'any system'}</span>
                <span className="min-w-0 flex-1 truncate font-sans text-ink" title={`Named ${new Date(n.namedAt).toLocaleString()}`}>{n.name}</span>
                <button className="shrink-0 text-[10px] text-ink-3 underline decoration-ink-3/40 underline-offset-2 hover:text-red" title="Forget this name: the entries go back to the scanner's alpha tag, else radioid.net" onClick={() => void unnameRadio(n.id)}>
                  remove
                </button>
              </li>
            ))}
          </ul>
        </>
      )}
      {tgNames.length > 0 && (
        <>
          <p className="mb-0.5 text-[10px] font-bold uppercase tracking-widest text-ink-3">Talkgroups</p>
          <ul className="mb-2 max-h-32 space-y-0.5 overflow-y-auto font-mono text-[11px] text-ink-2">
            {tgNames.map((n) => (
              <li key={n.id} className="flex items-center gap-2">
                <span className="text-amber-2" title="Talkgroup ID">{n.tgid}</span>
                <span className="w-24 shrink-0 truncate text-ink-3" title={n.system || 'Any system'}>{n.system || 'any system'}</span>
                <span className="min-w-0 flex-1 truncate font-sans text-ink" title={`${n.source === 'USER' ? 'Named' : 'From DSDPlus.groups'} ${new Date(n.namedAt).toLocaleString()}`}>{n.name}</span>
                <span className={`shrink-0 rounded px-1 py-px font-sans text-[9px] font-bold uppercase tracking-wider ${n.source === 'USER' ? 'bg-panel-2 text-ink-3' : SOURCE_PILL.DSD}`} title={n.source === 'USER' ? 'A name you typed' : "DSD+'s alias, read from its groups file whenever DSD+ rewrites it"}>{n.source === 'USER' ? 'typed' : 'DSD'}</span>
                {n.source === 'USER' && (
                  <button className="shrink-0 text-[10px] text-ink-3 underline decoration-ink-3/40 underline-offset-2 hover:text-red" title="Forget this name: the entries go back to the scanner's word, else DSD+'s alias, else the lookups" onClick={() => void unnameTalkgroup(n.id)}>
                    remove
                  </button>
                )}
              </li>
            ))}
          </ul>
        </>
      )}
      {confirmations.length > 0 && (radioNames.length > 0 || tgNames.length > 0) && <p className="mb-0.5 text-[10px] font-bold uppercase tracking-widest text-ink-3">Channels</p>}
      <ul className="max-h-48 space-y-0.5 overflow-y-auto font-mono text-[11px] text-ink-2">
        {confirmations.map((c) => (
          <li key={c.id} className="flex items-center gap-2">
            <span className="text-amber-2">{(c.frequencyHz / 1e6).toFixed(4)}</span>
            <span className="w-16 shrink-0 truncate text-ink-3" title={c.tone || 'any tone'}>{[c.tone, c.tgid !== null ? `TG ${c.tgid}` : ''].filter(Boolean).join(' · ') || 'any'}</span>
            <span className="min-w-0 flex-1 truncate font-sans text-ink" title={c.detail || undefined}>{c.name}</span>
            <span className={`shrink-0 rounded px-1 py-px font-sans text-[9px] font-bold uppercase tracking-wider ${c.source === 'USER' ? 'bg-panel-2 text-ink-3' : SOURCE_PILL[c.source]}`}>{c.source === 'USER' ? 'typed' : c.source}</span>
            <button className="shrink-0 text-[10px] text-ink-3 underline decoration-ink-3/40 underline-offset-2 hover:text-red" title="Withdraw" onClick={() => void unconfirm(c.id)}>
              remove
            </button>
          </li>
        ))}
      </ul>
      <p className="mt-1 text-[11px] text-ink-3">
        {[confirmations.length ? `${confirmations.length} channel${confirmations.length === 1 ? '' : 's'}` : '', radioNames.length ? `${radioNames.length} radio${radioNames.length === 1 ? '' : 's'}` : '', tgNames.length ? `${tgNames.length} talkgroup${tgNames.length === 1 ? '' : 's'}` : ''].filter(Boolean).join(', ')} confirmed. A confirmation outranks every lookup and the scanner's own programming for its frequency and tone; a radio name outranks the scanner's alpha tag and radioid.net; a talkgroup name you type outranks the scanner's alpha tag, and DSD+'s alias stands in where the scanner shows UNID.
      </p>
      {dsd}
    </div>
  );
}

/** RadioReference UK: the user's own API key, an optional postcode, and the cache. */
function RrukForm() {
  const { rruk, rrukBusy, rrukMessage, setRrukKey, testRruk, clearRrukCache, settings, saveSettings } = useIdentities();
  const [key, setKey] = useState('');
  const [postcode, setPostcode] = useState(settings.rruk?.postcode ?? '');
  useEffect(() => {
    setPostcode(settings.rruk?.postcode ?? '');
  }, [settings.rruk?.postcode]);
  const inp = 'w-full rounded-md border border-edge bg-panel-2 px-2 py-1 font-mono text-xs text-ink outline-none focus:border-cyan';
  const btn = 'rounded-md border border-edge px-2 py-1 text-xs text-ink-2 hover:text-ink disabled:opacity-50';
  if (!rruk) return <p className="mt-1 text-ink-3">Not available.</p>;
  return (
    <div className="mt-1 space-y-2">
      <p className="text-[11px] text-ink-3">
        UK-centric, Ofcom-backed lookups filtered to your area. Needs your own API key from your account dashboard at{' '}
        <a className="text-cyan underline decoration-cyan/40 underline-offset-2" href="https://radioreferenceuk.co.uk/" target="_blank" rel="noreferrer">
          radioreferenceuk.co.uk
        </a>
        . The key is stored encrypted and used only for lookups from this app.
      </p>
      <div className="grid grid-cols-[1fr_auto_auto] items-end gap-2">
        <label className="text-[10px] text-ink-3">
          API key
          <input className={inp} type="password" value={key} placeholder={rruk.hasKey ? '(saved)' : rruk.devKey ? '(development key from RRUK_KEY)' : ''} onChange={(e) => setKey(e.target.value)} />
        </label>
        <button
          className={btn}
          disabled={rrukBusy || (!key.trim() && !rruk.hasKey)}
          title={key.trim() ? 'Store the key' : 'Clear the stored key'}
          onClick={() => {
            void setRrukKey(key.trim()).then(() => setKey(''));
          }}
        >
          {key.trim() || !rruk.hasKey ? 'Save' : 'Clear'}
        </button>
        <button className={btn} disabled={rrukBusy || (!rruk.hasKey && !rruk.devKey)} onClick={() => void testRruk()} title="Ask RRUK about PMR446 channel 1 with this key">
          Test
        </button>
      </div>
      <div className="grid grid-cols-[8rem_auto_1fr] items-end gap-2">
        <label className="text-[10px] text-ink-3">
          Postcode (optional)
          <input className={inp} value={postcode} placeholder="LS1 or LS1 4AP" onChange={(e) => setPostcode(e.target.value.toUpperCase())} />
        </label>
        <button className={btn} onClick={() => void saveSettings({ rruk: { ...settings.rruk, postcode: postcode.trim() } })}>
          Save
        </button>
        <span className="pb-1 text-[10px] text-ink-3">{postcode.trim() ? 'Searches from this postcode.' : 'Blank: searches from the latitude and longitude above, within the radius (RRUK caps it at 50 miles).'}</span>
      </div>
      <p className="text-[11px] text-ink-3">
        {rruk.enabled ? (
          <>
            <span className="text-green">✓ Key tested.</span> Lookups on. Cached: <span className="font-mono text-ink-2">{rruk.cachedFreqs}</span> frequencies.{' '}
            <button className="underline decoration-ink-3/40 underline-offset-2" onClick={() => void clearRrukCache()}>
              clear
            </button>
          </>
        ) : !rruk.hasKey && !rruk.devKey ? (
          'Lookups run once a key is saved and tested.'
        ) : !rruk.tested ? (
          <span className="text-amber">Key not tested yet: press Test. Lookups stay off until the key gets a tick.</span>
        ) : (
          'Lookups run once a postcode or a location is set.'
        )}
      </p>
      {rruk.halted ? (
        <p className="rounded-md border border-red/40 bg-red/10 px-2 py-1 text-xs text-red">
          <span className="font-bold">RRUK refused the last request: {rruk.halted.message}.</span>{' '}
          {rruk.halted.kind === 'key'
            ? 'Lookups are paused until you enter the correct API key (from your RRUK dashboard) and Test it.'
            : rruk.halted.kind === 'offline'
              ? 'RRUK could not be reached; lookups pause for a minute.'
              : `Lookups pause until ${rruk.halted.until ? new Date(rruk.halted.until).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' }) : 'later'}. Users cannot clear this themselves: contact RRUK support with the message above, then Test to resume sooner once they have.`}
        </p>
      ) : (
        rruk.lastError && <p className="text-xs text-red">Last lookup failed: {rruk.lastError}</p>
      )}
      {rrukMessage && <p className={`text-xs ${rrukMessage.ok ? 'text-green' : 'text-red'}`}>{rrukMessage.text}</p>}
    </div>
  );
}

/** RadioReference login, region and cache state. */
function RadioReferenceForm() {
  const { rr, rrBusy, rrMessage, setRrAccount, testRr, rrCountries, rrStates, setRrRegion, clearRrCache } = useIdentities();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [countries, setCountries] = useState<RrRegion[] | null>(null);
  const [states, setStates] = useState<RrRegion[]>([]);
  const [coid, setCoid] = useState<number | null>(null);
  const [stid, setStid] = useState<number | null>(null);
  useEffect(() => {
    setUsername(rr?.username ?? '');
  }, [rr?.username]);
  const inp = 'w-full rounded-md border border-edge bg-panel-2 px-2 py-1 font-mono text-xs text-ink outline-none focus:border-cyan';
  const btn = 'rounded-md border border-edge px-2 py-1 text-xs text-ink-2 hover:text-ink disabled:opacity-50';
  if (!rr) return <p className="mt-1 text-ink-3">Not available.</p>;
  if (!rr.appKey) return <p className="mt-1 text-ink-3">This build was made without a RadioReference application key, so lookups are off.</p>;

  const chooseRegion = async (): Promise<void> => {
    const list = await rrCountries();
    setCountries(list);
    const uk = list.find((c) => /united kingdom/i.test(c.name)) ?? list[0];
    if (uk) {
      setCoid(uk.id);
      setStates(await rrStates(uk.id));
    }
  };
  const pickCountry = async (id: number): Promise<void> => {
    setCoid(id);
    setStid(null);
    setStates(await rrStates(id));
  };
  const saveRegion = async (): Promise<void> => {
    const c = countries?.find((x) => x.id === coid);
    const st = states.find((x) => x.id === stid);
    if (!c || !st) return;
    await setRrRegion({ coid: c.id, stid: st.id, countryName: c.name, stateName: st.name });
    setCountries(null);
  };

  return (
    <div className="mt-1 space-y-2">
      <div className="grid grid-cols-[1fr_1fr_auto_auto] items-end gap-2">
        <label className="text-[10px] text-ink-3">
          Username
          <input className={inp} value={username} placeholder="radioreference.com" onChange={(e) => setUsername(e.target.value)} />
        </label>
        <label className="text-[10px] text-ink-3">
          Password
          <input className={inp} type="password" value={password} placeholder={rr.hasPassword ? '(unchanged)' : ''} onChange={(e) => setPassword(e.target.value)} />
        </label>
        <button
          className={btn}
          disabled={rrBusy}
          onClick={() => {
            void setRrAccount(username, password).then(() => setPassword(''));
          }}
        >
          Save
        </button>
        <button className={btn} disabled={rrBusy || !rr.hasPassword} onClick={() => void testRr()} title="Ask RadioReference who you are">
          Test
        </button>
      </div>
      {countries ? (
        <div className="grid grid-cols-[1fr_1fr_auto] items-end gap-2">
          <label className="text-[10px] text-ink-3">
            Country
            <select className={inp} value={coid ?? ''} onChange={(e) => void pickCountry(Number(e.target.value))}>
              {countries.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </label>
          <label className="text-[10px] text-ink-3">
            Region
            <select className={inp} value={stid ?? ''} onChange={(e) => setStid(Number(e.target.value))}>
              <option value="">Choose…</option>
              {states.map((st) => (
                <option key={st.id} value={st.id}>
                  {st.name}
                </option>
              ))}
            </select>
          </label>
          <button className={btn} disabled={stid === null} onClick={() => void saveRegion()}>
            Set
          </button>
        </div>
      ) : (
        <p className="text-ink-2">
          Region:{' '}
          {rr.stid !== null ? (
            <span className="text-ink">
              {rr.stateName}, {rr.countryName}
            </span>
          ) : (
            <span className="text-ink-3">not set</span>
          )}{' '}
          <button className="text-cyan underline decoration-cyan/40 underline-offset-2 disabled:opacity-50" disabled={!rr.hasPassword} onClick={() => void chooseRegion()}>
            {rr.stid !== null ? 'change' : 'choose'}
          </button>
        </p>
      )}
      <p className="text-[11px] text-ink-3">
        {rr.enabled ? (
          <>
            Lookups on. Cached: <span className="font-mono text-ink-2">{rr.cachedFreqs}</span> frequencies,{' '}
            <span className="font-mono text-ink-2">{rr.cachedSystems}</span> systems, <span className="font-mono text-ink-2">{rr.cachedTalkgroups.toLocaleString()}</span> talkgroups.{' '}
            <button className="underline decoration-ink-3/40 underline-offset-2" onClick={() => void clearRrCache()}>
              clear
            </button>
          </>
        ) : (
          'Lookups run once the login is saved and a region is set. A premium subscription is required for API access.'
        )}
      </p>
      {rr.passwordStore === 'basic_text' && (
        <p className="text-[11px] text-amber">
          No keyring found, so the password is stored obfuscated rather than encrypted. Install GNOME Keyring or KWallet and save it again for proper encryption.
        </p>
      )}
      {rr.lastError && <p className="text-xs text-red">Last lookup failed: {rr.lastError}</p>}
      {rrMessage && <p className={`text-xs ${rrMessage.ok ? 'text-green' : 'text-red'}`}>{rrMessage.text}</p>}
    </div>
  );
}

/** The "Data" button in the top bar: opens the Data dialog. */
export function DataButton() {
  const open = useUi((s) => s.dataOpen);
  const openData = useUi((s) => s.openData);
  const refresh = useIdentities((s) => s.refresh);
  // Settings and import counts are wanted before the dialog opens (the hero and forms read them).
  useEffect(() => {
    void refresh();
  }, [refresh]);
  return (
    <button
      className={`rounded-md border border-edge px-2.5 py-1.5 text-sm ${open ? 'bg-panel-2 text-ink' : 'text-ink-2 hover:text-ink'}`}
      onClick={openData}
      title="Lookups, identity databases and location"
    >
      Data
    </button>
  );
}

/**
 * The Data dialog: lookup order and location on the left, the data files and RadioReference on the
 * right. Same chrome as the help screen: Esc or a click outside closes it; the keypad ignores
 * shortcuts while it is open.
 */
export default function DataDialog() {
  const open = useUi((s) => s.dataOpen);
  const close = useUi((s) => s.closeData);
  const { stats, importing, lastResult, wtrImporting, wtrResult, repeatersImporting, repeatersResult, error, refresh, importFile, importWtr, importRepeaters } =
    useIdentities();

  useEffect(() => {
    if (!open) return;
    void refresh();
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') {
        e.preventDefault();
        close();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, close, refresh]);

  if (!open) return null;

  const when = (at: number | null, src: string | null): string =>
    [at ? new Date(at).toLocaleDateString() : '', src ?? ''].filter(Boolean).join(' · ');

  return (
    <div
      className="no-drag fixed inset-0 z-50 flex items-center justify-center bg-bg/70 p-6 backdrop-blur-sm"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) close();
      }}
      role="presentation"
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="data-title"
        className="relative max-h-[88vh] w-full max-w-[58rem] overflow-y-auto rounded-xl border border-edge bg-panel p-6 text-sm text-ink-2 shadow-2xl"
      >
        <button
          className="absolute top-3 right-3 flex h-8 w-8 items-center justify-center rounded-md text-lg text-ink-3 hover:bg-panel-2 hover:text-ink"
          onClick={close}
          title="Close (Esc)"
          aria-label="Close"
        >
          ×
        </button>

        <div className="mb-5 flex items-baseline gap-3 pr-10">
          <h2 id="data-title" className="text-xl font-semibold tracking-tight text-ink">
            Data
          </h2>
          <span className="text-xs text-ink-3">Lookups, identity databases and your location</span>
        </div>

        <div className="grid gap-x-8 gap-y-3 md:grid-cols-2">
          <div className="space-y-3">
            <Section title="Lookup order">
              <LookupOrder />
              <p className="mt-1 text-[11px] text-ink-3">The first lookup with a match names a channel the scanner left blank. Untick one to ignore it.</p>
            </Section>

            <Section title="Your location (for nearest licensee and repeater)">
              <LocationForm />
              <p className="mt-1 text-[11px] text-ink-3">Decimal degrees. Leave blank to sort by name only.</p>
            </Section>

            <Section title="RadioReference UK (online)">
              <RrukForm />
            </Section>

            <Section title="RadioReference.com (online)">
              <RadioReferenceForm />
            </Section>
          </div>

          <div className="space-y-3 md:border-l md:border-edge md:pl-8">
            <Section title="Ofcom Wireless Telegraphy Register">
              <p className="mt-1 text-ink-2">
                {stats.wtrLicences > 0 ? (
                  <>
                    <span className="font-mono text-ink">{stats.wtrLicences.toLocaleString()}</span> licences
                    <span className="text-ink-3"> · {when(stats.wtrImportedAt, stats.wtrSource)}</span>
                  </>
                ) : (
                  'Not imported. Frequencies will not show a licensee.'
                )}
              </p>
              <button
                className="mt-2 w-full rounded-md bg-cyan px-3 py-1.5 text-sm font-semibold text-bg hover:brightness-110 disabled:opacity-50"
                disabled={wtrImporting}
                onClick={() => void importWtr()}
              >
                {wtrImporting ? 'Importing… (this takes a few seconds)' : 'Import WTR CSV…'}
              </button>
              {wtrResult && !wtrImporting && (
                <p className="mt-1 text-xs text-green">
                  Kept {wtrResult.imported.toLocaleString()} licences from {wtrResult.file} ({wtrResult.skipped.toLocaleString()} rows outside 25–1300 MHz or too wide).
                </p>
              )}
            </Section>

            <Section title="UK amateur repeaters (RSGB ETCC)">
              <p className="mt-1 text-ink-2">
                {stats.repeaters > 0 ? (
                  <>
                    <span className="font-mono text-ink">{stats.repeaters.toLocaleString()}</span> repeaters
                    <span className="text-ink-3"> · {when(stats.repeatersImportedAt, stats.repeatersSource)}</span>
                  </>
                ) : (
                  'Not imported. Amateur repeater outputs will not be named.'
                )}
              </p>
              <button
                className="mt-2 w-full rounded-md border border-edge px-3 py-1.5 text-sm text-ink-2 hover:text-ink disabled:opacity-50"
                disabled={repeatersImporting}
                onClick={() => void importRepeaters()}
              >
                {repeatersImporting ? 'Importing…' : 'Import repeater list CSV…'}
              </button>
              {repeatersResult && !repeatersImporting && (
                <p className="mt-1 text-xs text-green">
                  Loaded {repeatersResult.imported.toLocaleString()} repeaters from {repeatersResult.file}
                  {repeatersResult.skipped > 0 ? ` (${repeatersResult.skipped} rows skipped)` : ''}.
                </p>
              )}
            </Section>

            <Section title="DMR user database (radioid.net)">
              <p className="mt-1 text-ink-2">
                {stats.dmrUsers > 0 ? (
                  <>
                    <span className="font-mono text-ink">{stats.dmrUsers.toLocaleString()}</span> radio IDs
                    <span className="text-ink-3"> · {when(stats.importedAt, stats.source)}</span>
                  </>
                ) : (
                  'Not imported. Radio IDs will show as numbers.'
                )}
              </p>
              <button
                className="mt-2 w-full rounded-md border border-edge px-3 py-1.5 text-sm text-ink-2 hover:text-ink disabled:opacity-50"
                disabled={importing}
                onClick={() => void importFile()}
              >
                {importing ? 'Importing…' : 'Import radioid.net CSV or JSON…'}
              </button>
              {lastResult && !importing && (
                <p className="mt-1 text-xs text-green">
                  Imported {lastResult.imported.toLocaleString()} from {lastResult.file}
                  {lastResult.skipped ? `, ${lastResult.skipped} rows skipped` : ''}.
                </p>
              )}
            </Section>

            <p className="border-t border-edge pt-2 text-[11px] text-ink-3">Download links and what to do with the files are under the ? button.</p>

            <Section title="DSD+ link">
              <DsdForm />
            </Section>

            <Section title="Confirmed identities">
              <ConfirmedList />
            </Section>

            <Section title="Scan timeout">
              <ScanTimeoutForm />
            </Section>

            <Section title="Scanner clock">
              <ClockForm />
            </Section>
          </div>
        </div>

        {error && <p className="mt-3 text-xs text-red">{error}</p>}
      </div>
    </div>
  );
}
