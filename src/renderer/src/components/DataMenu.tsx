import { useEffect, useRef, useState } from 'react';
import { useIdentities } from '../store/identities';

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="border-t border-edge pt-3 first:border-t-0 first:pt-0">
      <p className="text-[11px] font-semibold uppercase tracking-widest text-ink-3">{title}</p>
      {children}
    </div>
  );
}

function LocationForm() {
  const { settings, saveSettings } = useIdentities();
  const [lat, setLat] = useState(settings.lat?.toString() ?? '');
  const [lon, setLon] = useState(settings.lon?.toString() ?? '');
  const [radius, setRadius] = useState(settings.radiusKm?.toString() ?? '');
  useEffect(() => {
    setLat(settings.lat?.toString() ?? '');
    setLon(settings.lon?.toString() ?? '');
    setRadius(settings.radiusKm?.toString() ?? '');
  }, [settings]);
  const inp = 'w-full rounded-md border border-edge bg-panel-2 px-2 py-1 font-mono text-xs text-ink outline-none focus:border-cyan';
  const save = (): void => {
    const n = (s: string): number | null => (s.trim() === '' ? null : Number(s));
    void saveSettings({ lat: n(lat), lon: n(lon), radiusKm: n(radius) });
  };
  return (
    <div className="mt-1 grid grid-cols-[1fr_1fr_4.5rem_auto] items-end gap-2">
      <label className="text-[10px] text-ink-3">
        Latitude
        <input className={inp} value={lat} placeholder="51.5074" onChange={(e) => setLat(e.target.value)} />
      </label>
      <label className="text-[10px] text-ink-3">
        Longitude
        <input className={inp} value={lon} placeholder="-0.1278" onChange={(e) => setLon(e.target.value)} />
      </label>
      <label className="text-[10px] text-ink-3">
        km
        <input className={inp} value={radius} placeholder="60" onChange={(e) => setRadius(e.target.value)} />
      </label>
      <button className="rounded-md border border-edge px-2 py-1 text-xs text-ink-2 hover:text-ink" onClick={save}>
        Save
      </button>
    </div>
  );
}

/** "Data" dropdown in the top bar: identity databases, location, import status. */
export default function DataMenu() {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const { stats, importing, lastResult, wtrImporting, wtrResult, error, refresh, importFile, importWtr } = useIdentities();

  useEffect(() => {
    void refresh();
  }, [refresh]);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent): void => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    window.addEventListener('mousedown', onDown);
    return () => window.removeEventListener('mousedown', onDown);
  }, [open]);

  const when = (at: number | null, src: string | null): string =>
    [at ? new Date(at).toLocaleDateString() : '', src ?? ''].filter(Boolean).join(' · ');

  return (
    <div className="relative" ref={ref}>
      <button
        className={`rounded-md border border-edge px-2.5 py-1.5 text-sm ${open ? 'bg-panel-2 text-ink' : 'text-ink-2 hover:text-ink'}`}
        onClick={() => setOpen((v) => !v)}
        title="Identity databases and location"
      >
        Data
      </button>
      {open && (
        <div className="absolute right-0 z-20 mt-1 w-[22rem] space-y-3 rounded-lg border border-edge bg-panel p-3 text-sm shadow-xl">
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

          <Section title="Your location (for nearest licensee)">
            <LocationForm />
            <p className="mt-1 text-[11px] text-ink-3">Decimal degrees. Leave blank to sort by name only.</p>
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

          {error && <p className="text-xs text-red">{error}</p>}
        </div>
      )}
    </div>
  );
}
