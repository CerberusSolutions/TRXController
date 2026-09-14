import { useConnectionStore } from './store/connection';

// Placeholder shell. The live LCD, keypad and polling loop are session 2.
export default function App() {
  const status = useConnectionStore((s) => s.status);
  const v = window.trx?.versions;
  return (
    <main className="min-h-screen p-6 font-sans">
      <h1 className="text-2xl font-semibold tracking-tight">TRXController</h1>
      <p className="mt-2 text-slate-400">Whistler TRX-1 / TRX-1E / TRX-2 remote control</p>
      <p className="mt-6 text-sm text-slate-500">
        Scanner: <span className="text-slate-300">{status}</span>
      </p>
      {v && (
        <p className="mt-1 text-xs text-slate-600">
          Electron {v.electron} · Node {v.node} · Chrome {v.chrome}
        </p>
      )}
    </main>
  );
}
