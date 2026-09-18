import { useEffect, useState } from 'react';
import type { RrRegion } from '../../../shared/ipc';
import { useIdentities } from '../store/identities';
import { useLog } from '../store/log';
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
  const short: Record<LookupPref['id'], string> = { WTR: 'Ofcom licence register', RRDB: 'RadioReference', UKR: 'RSGB repeater list' };
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

/** What the user has confirmed by hand, with a way to withdraw one or all. */
function ConfirmedList() {
  const confirmations = useLog((s) => s.confirmations);
  const unconfirm = useLog((s) => s.unconfirm);
  if (confirmations.length === 0) return <p className="mt-1 text-[11px] text-ink-3">None yet. Unfold a log row with + and confirm the right candidate, or type a name.</p>;
  return (
    <div className="mt-1">
      <ul className="max-h-28 space-y-0.5 overflow-y-auto font-mono text-[11px] text-ink-2">
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
        {confirmations.length} confirmed. A confirmation outranks every lookup and the scanner's own programming for its frequency and tone.
      </p>
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
        className="relative max-h-[88vh] w-full max-w-[52rem] overflow-y-auto rounded-xl border border-edge bg-panel p-6 text-sm text-ink-2 shadow-2xl"
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

            <Section title="Confirmed identities">
              <ConfirmedList />
            </Section>

            <Section title="Scan timeout">
              <ScanTimeoutForm />
            </Section>

            <Section title="Your location (for nearest licensee and repeater)">
              <LocationForm />
              <p className="mt-1 text-[11px] text-ink-3">Decimal degrees. Leave blank to sort by name only.</p>
            </Section>

            <Section title="RadioReference (online)">
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
          </div>
        </div>

        {error && <p className="mt-3 text-xs text-red">{error}</p>}
      </div>
    </div>
  );
}
