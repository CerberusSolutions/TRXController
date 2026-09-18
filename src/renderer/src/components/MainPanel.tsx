import { useEffect, useState } from 'react';
import BandChart from './BandChart';
import LcdPanel from './LcdPanel';
import LogTable from './LogTable';

type Tab = 'log' | 'band' | 'display';
const KEY = 'trx.mainTab';

function loadTab(): Tab {
  try {
    const v = localStorage.getItem(KEY);
    return v === 'display' || v === 'band' ? v : 'log';
  } catch {
    return 'log';
  }
}

export default function MainPanel() {
  const [tab, setTab] = useState<Tab>(loadTab);
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
        {btn('display', 'Scanner display')}
      </div>
      <div className={`min-h-0 flex-1 ${tab === 'display' ? 'overflow-y-auto' : ''}`}>
        {tab === 'log' ? <LogTable /> : tab === 'band' ? <BandChart /> : <LcdPanel embedded />}
      </div>
    </section>
  );
}
