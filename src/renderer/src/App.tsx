import { useEffect } from 'react';
import FrequencyHero from './components/FrequencyHero';
import Keypad from './components/Keypad';
import LcdPanel from './components/LcdPanel';
import StatusBar from './components/StatusBar';
import TopBar from './components/TopBar';
import { attachScannerEvents } from './store/scanner';

export default function App() {
  useEffect(() => attachScannerEvents(), []);

  if (!window.trx) {
    return (
      <main className="flex h-full items-center justify-center text-ink-2">
        This page must be opened inside the TRXController Electron app.
      </main>
    );
  }

  return (
    <div className="flex h-full flex-col">
      <TopBar />
      <main className="grid flex-1 grid-cols-[minmax(0,1fr)_260px] gap-4 overflow-auto p-4">
        <div className="flex min-w-0 flex-col gap-4">
          <FrequencyHero />
          <LcdPanel />
        </div>
        <Keypad />
      </main>
      <StatusBar />
    </div>
  );
}
