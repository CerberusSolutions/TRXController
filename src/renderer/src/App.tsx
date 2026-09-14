import { useEffect } from 'react';
import FrequencyHero from './components/FrequencyHero';
import HelpDialog from './components/HelpDialog';
import Keypad from './components/Keypad';
import MainPanel from './components/MainPanel';
import StatusBar from './components/StatusBar';
import TopBar from './components/TopBar';
import { attachLogEvents } from './store/log';
import { attachScannerEvents } from './store/scanner';
import { initTheme } from './store/theme';
import { isFirstRun, useUi } from './store/ui';

export default function App() {
  useEffect(() => {
    const offTheme = initTheme();
    const offScanner = attachScannerEvents();
    const offLog = attachLogEvents();
    void useUi.getState().loadAppInfo();
    if (isFirstRun()) useUi.getState().openHelp();
    return () => {
      offTheme();
      offScanner();
      offLog();
    };
  }, []);

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
      <main className="grid min-h-0 flex-1 grid-cols-[minmax(0,1fr)_260px] gap-4 p-4">
        <div className="flex min-h-0 min-w-0 flex-col gap-4">
          <FrequencyHero />
          <MainPanel />
        </div>
        <Keypad />
      </main>
      <StatusBar />
      <HelpDialog />
    </div>
  );
}
