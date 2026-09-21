import { useEffect, useState } from 'react';
import BandChart from './BandChart';
import DebugPanel from './LcdPanel';
import LogTable from './LogTable';
import { useUi } from '../store/ui';

/** The scanner's display used to be a tab here ('display'); it now lives over the keypad, and the raw bytes moved to Debug. */
type Tab = 'log' | 'band' | 'debug';
const KEY = 'trx.mainTab';

function loadTab(): Tab {
  try {
    const v = localStorage.getItem(KEY);
    return v === 'band' || v === 'debug' ? v : 'log';
  } catch {
    return 'log';
  }
}

export default function MainPanel() {
  const [stored, setTab] = useState<Tab>(loadTab);
  const diagnostics = useUi((s) => s.diagnostics);
  // Debug is only there while diagnostics is on (Ctrl+Shift+D); switching it off drops back to the log.
  const tab: Tab = stored === 'debug' && !diagnostics ? 'log' : stored;
  useEffect(() => {
    try {
      localStorage.setItem(KEY, tab);
    } catch {
      /* ignore */
    }
  }, [tab]);

  const btn = (t: Tab, label: string) => (
    <button
      className={`rounded-md px-3 py-1 text-[11px] font-bold uppercase tracking-widest ${
        tab === t ? 'bg-panel-2 text-ink' : 'text-ink-2 hover:text-ink'
      }`}
      onClick={() => setTab(t)}
    >
      {label}
    </button>
  );

  return (
    <section className="flex min-h-0 flex-1 flex-col rounded-xl border border-edge bg-panel p-4">
      <div className="mb-3 flex items-center gap-1">
        {btn('log', 'Log')}
        {btn('band', 'Band')}
        {diagnostics && btn('debug', 'Debug')}
      </div>
      <div className={`min-h-0 flex-1 ${tab === 'debug' ? 'overflow-y-auto' : ''}`}>
        {tab === 'log' ? <LogTable /> : tab === 'band' ? <BandChart /> : <DebugPanel />}
      </div>
    </section>
  );
}
