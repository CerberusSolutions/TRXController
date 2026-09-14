import { useEffect, useRef, useState } from 'react';
import { useIdentities } from '../store/identities';

/** Small "Data" dropdown in the top bar: identity database import and status. */
export default function DataMenu() {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const { stats, importing, lastResult, error, refresh, importFile } = useIdentities();

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

  const n = stats.dmrUsers;
  return (
    <div className="relative" ref={ref}>
      <button
        className={`rounded-md border border-edge px-2.5 py-1.5 text-sm ${open ? 'bg-panel-2 text-ink' : 'text-ink-2 hover:text-ink'}`}
        onClick={() => setOpen((v) => !v)}
        title="Identity databases"
      >
        Data
      </button>
      {open && (
        <div className="absolute right-0 z-20 mt-1 w-80 rounded-lg border border-edge bg-panel p-3 text-sm shadow-xl">
          <p className="text-[11px] font-semibold uppercase tracking-widest text-ink-3">DMR user database</p>
          <p className="mt-1 text-ink-2">
            {n > 0 ? (
              <>
                <span className="font-mono text-ink">{n.toLocaleString()}</span> radio IDs
                {stats.importedAt && <span className="text-ink-3"> · {new Date(stats.importedAt).toLocaleDateString()}</span>}
                {stats.source && <span className="text-ink-3"> · {stats.source}</span>}
              </>
            ) : (
              'Not imported. Radio IDs will show as numbers.'
            )}
          </p>
          <button
            className="mt-2 w-full rounded-md bg-cyan px-3 py-1.5 text-sm font-semibold text-bg hover:brightness-110 disabled:opacity-50"
            disabled={importing}
            onClick={() => void importFile()}
          >
            {importing ? 'Importing…' : 'Import radioid.net CSV or JSON…'}
          </button>
          {lastResult && !importing && (
            <p className="mt-2 text-xs text-green">
              Imported {lastResult.imported.toLocaleString()} from {lastResult.file}
              {lastResult.skipped ? `, ${lastResult.skipped} rows skipped` : ''}.
            </p>
          )}
          {error && <p className="mt-2 text-xs text-red">{error}</p>}
          <p className="mt-2 text-[11px] leading-snug text-ink-3">
            Download the user export from radioid.net. Only amateur DMR IDs are covered; commercial and P25 IDs stay as numbers.
          </p>
        </div>
      )}
    </div>
  );
}
