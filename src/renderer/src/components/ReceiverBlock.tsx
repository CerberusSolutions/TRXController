import { useCallback, useEffect, useState } from 'react';
import FrequencyHero from './FrequencyHero';
import Keypad from './Keypad';
import { RxContext } from '../lib/rx';
import { useScannerKeys } from '../lib/useScannerKeys';
import { useUi } from '../store/ui';

/** The keyboard shortcuts for a receiver whose drawer is closed: the listener alone, nothing rendered. */
function KeyboardOnly({ rx }: { rx: number }) {
  useScannerKeys(rx, useUi((s) => s.activeRx) === rx);
  return null;
}

/**
 * How a receiver's display and keys are shown in its column: `closed` (an edge tab and the hero's Keys button open
 * it), `open` (slid in over the hero until closed), `pinned` (in the flow beside the hero, which makes room).
 * Pinned is remembered per receiver on this machine; an unpinned drawer starts closed.
 */
type Drawer = 'closed' | 'open' | 'pinned';
const DRAWER_KEY = (rx: number): string => `trx.drawer.rx${rx}`;

function loadDrawer(rx: number): Drawer {
  try {
    return localStorage.getItem(DRAWER_KEY(rx)) === 'pinned' ? 'pinned' : 'closed';
  } catch {
    return 'closed';
  }
}

/** The ring that says which scanner the keyboard shortcuts go to, in the receiver's own colour. */
const ACTIVE_RING = ['ring-1 ring-rx1', 'ring-1 ring-rx2'];

/**
 * One receiver's column in a twin-scanner window: its hero (frequency, signal, name, details) with the display
 * and keypad in a drawer that slides in from the right edge. A click anywhere in the block makes it the one
 * the keyboard drives.
 */
export default function ReceiverBlock({ rx }: { rx: number }) {
  const [drawer, setDrawer] = useState<Drawer>(() => loadDrawer(rx));
  const activeRx = useUi((s) => s.activeRx);
  const setActiveRx = useUi((s) => s.setActiveRx);
  useEffect(() => {
    try {
      localStorage.setItem(DRAWER_KEY(rx), drawer === 'pinned' ? 'pinned' : 'closed');
    } catch {
      /* ignore */
    }
  }, [drawer, rx]);
  const open = useCallback(() => setDrawer((d) => (d === 'closed' ? 'open' : d)), []);
  const close = useCallback(() => setDrawer('closed'), []);
  const pin = useCallback(() => setDrawer((d) => (d === 'pinned' ? 'open' : 'pinned')), []);
  const active = activeRx === rx;
  const drawerProps = { pinned: drawer === 'pinned', onPin: pin, onClose: close };

  return (
    <RxContext.Provider value={rx}>
      <section
        className={`relative flex min-w-0 overflow-hidden rounded-xl border border-edge bg-panel ${active ? ACTIVE_RING[rx] ?? '' : ''}`}
        title={active ? undefined : 'Click to send the keyboard shortcuts to this scanner'}
        onMouseDownCapture={() => {
          if (!active) setActiveRx(rx);
        }}
      >
        <div className="min-w-0 flex-1">
          <FrequencyHero compact onKeys={drawer === 'closed' ? open : undefined} />
        </div>
        {drawer === 'pinned' && (
          <div className="w-[300px] shrink-0">
            <Keypad drawer={drawerProps} />
          </div>
        )}
        {drawer === 'open' && (
          <div className="absolute inset-y-0 right-0 w-[300px] shadow-[-8px_0_16px_rgba(0,0,0,0.35)]">
            <Keypad drawer={drawerProps} />
          </div>
        )}
        {drawer === 'closed' && (
          <>
            <button
              type="button"
              className="absolute top-1/2 right-0 flex h-16 w-3.5 -translate-y-1/2 items-center justify-center rounded-l-md border border-r-0 border-edge bg-panel-2 text-[10px] text-ink-3 hover:text-ink"
              title="Open this scanner's display and keys"
              aria-label="Open the display and keys"
              onClick={open}
            >
              ‹
            </button>
            {/* The keyboard shortcuts still reach this scanner while its block is the active one. */}
            <KeyboardOnly rx={rx} />
          </>
        )}
      </section>
    </RxContext.Provider>
  );
}
