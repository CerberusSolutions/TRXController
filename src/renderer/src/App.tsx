import { useEffect } from 'react';
import FrequencyHero from './components/FrequencyHero';
import HelpDialog from './components/HelpDialog';
import DataDialog from './components/DataMenu';
import Keypad from './components/Keypad';
import MainPanel from './components/MainPanel';
import ReceiverBlock from './components/ReceiverBlock';
import { useIdentities } from './store/identities';
import StatusBar from './components/StatusBar';
import TopBar from './components/TopBar';
import { attachDsdEvents } from './store/dsd';
import { attachLogEvents } from './store/log';
import { attachScannerEvents } from './store/scanner';
import { initTheme } from './store/theme';
import { isFirstRun, useUi } from './store/ui';

export default function App() {
  // Two scanners: a column per receiver over the shared log; one: the hero and the keypad column, as always.
  const twin = useIdentities((s) => s.settings.rx2 !== null);
  // Back to one scanner: the keyboard goes to RX1 again, whichever column had it.
  useEffect(() => {
    if (!twin) useUi.getState().setActiveRx(0);
  }, [twin]);
  useEffect(() => {
    const offTheme = initTheme();
    const offScanner = attachScannerEvents();
    const offLog = attachLogEvents();
    const offDsd = attachDsdEvents();
    void useUi.getState().loadAppInfo();
    const offUpdate = window.trx?.onUpdate ? window.trx.onUpdate((u) => useUi.getState().setUpdate(u)) : () => undefined;
    if (isFirstRun()) useUi.getState().openHelp();
    const onKey = (e: KeyboardEvent): void => {
      if ((e.ctrlKey || e.metaKey) && e.shiftKey && e.key.toLowerCase() === 'd') {
        e.preventDefault();
        useUi.getState().toggleDiagnostics();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => {
      offUpdate();
      window.removeEventListener('keydown', onKey);
      offTheme();
      offScanner();
      offLog();
      offDsd();
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
      {twin ? (
        <main className="flex min-h-0 flex-1 flex-col gap-4 p-4">
          <div className="grid shrink-0 grid-cols-2 gap-4">
            <ReceiverBlock rx={0} />
            <ReceiverBlock rx={1} />
          </div>
          <MainPanel />
        </main>
      ) : (
        <main className="grid min-h-0 flex-1 grid-cols-[minmax(0,1fr)_260px] gap-4 p-4">
          <div className="flex min-h-0 min-w-0 flex-col gap-4">
            <FrequencyHero />
            <MainPanel />
          </div>
          <Keypad />
        </main>
      )}
      <StatusBar />
      <HelpDialog />
      <DataDialog />
    </div>
  );
}
