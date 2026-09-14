import { useEffect } from 'react';
import { useUi } from '../store/ui';

export const PUBLISHER = 'Cerberus Systems';

/** Where the two optional data files come from. Shown verbatim so they can be copied. */
export const DATA_SOURCES = [
  {
    title: 'Ofcom Wireless Telegraphy Register',
    file: 'WTR.csv',
    size: 'about 55 MB',
    url: 'https://static.ofcom.org.uk/static/radiolicensing/html/register/WTR.csv',
    then: 'Data › Import WTR CSV…, then enter your latitude and longitude under Data so the nearest licensees are listed first.',
    gives: 'Names the business-radio licensee on a heard frequency (hero, log and Band tab).',
  },
  {
    title: 'RadioID DMR user database',
    file: 'user.csv',
    size: 'about 20 MB',
    url: 'https://radioid.net/static/user.csv',
    then: 'Data › Import radioid.net CSV or JSON….',
    gives: 'Turns a DMR radio ID into a callsign and name on amateur DMR receptions.',
  },
] as const;

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="border-t border-edge pt-4 first:border-t-0 first:pt-0">
      <h3 className="mb-2 text-[11px] font-semibold uppercase tracking-widest text-ink-3">{title}</h3>
      {children}
    </section>
  );
}

/** Modal help screen: what the app is, how to connect, where the data files come from. */
export default function HelpDialog() {
  const open = useUi((s) => s.helpOpen);
  const close = useUi((s) => s.closeHelp);
  const app = useUi((s) => s.app);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') {
        e.preventDefault();
        close();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, close]);

  if (!open) return null;

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
        aria-labelledby="help-title"
        className="relative max-h-[88vh] w-full max-w-[38rem] overflow-y-auto rounded-xl border border-edge bg-panel p-6 text-sm text-ink-2 shadow-2xl"
      >
        <button
          className="absolute top-3 right-3 flex h-8 w-8 items-center justify-center rounded-md text-lg text-ink-3 hover:bg-panel-2 hover:text-ink"
          onClick={close}
          title="Close (Esc)"
          aria-label="Close help"
        >
          ×
        </button>

        <div className="mb-5 flex items-baseline gap-2 pr-10">
          <h2 id="help-title" className="text-xl font-semibold tracking-tight text-ink">
            TRX<span className="font-light text-ink-2">Controller</span>
          </h2>
          <span className="rounded border border-amber/60 px-1.5 py-px text-[10px] font-bold tracking-widest text-amber">BETA</span>
          {app && <span className="font-mono text-xs text-ink-3">v{app.version}</span>}
        </div>

        <div className="space-y-4">
          <Section title="About">
            <p>
              Beta software from {PUBLISHER} for the Whistler TRX-1, TRX-1E and TRX-2 scanners (and the WS-1080 / 1088 / 1095 / 1098). It
              replaces Whistler's own remote-control program: live display, keypad, reception log and band occupancy over the USB serial link.
            </p>
            <p className="mt-2 text-ink-3">
              Provided as is, with no warranty or guarantee of any kind, express or implied. Use at your own risk. Not affiliated with Whistler,
              Ofcom or RadioID.
            </p>
          </Section>

          <Section title="Getting connected">
            <ol className="list-decimal space-y-1 pl-5">
              <li>Connect the scanner by USB and switch it on.</li>
              <li>
                Pick its COM port in the top bar. The Whistler port is chosen automatically when it can be told apart; use ⟳ to rescan after plugging
                in.
              </li>
              <li>
                Press <b className="text-ink">Connect</b>. The port is remembered and reopened next time the app starts, and again if the scanner is
                unplugged and plugged back in. <b className="text-ink">Disconnect</b> switches that off until you connect again.
              </li>
            </ol>
          </Section>

          <Section title="Optional data files">
            <p className="mb-3">
              Two free downloads make the log far more useful. Save each file anywhere, then load it with the{' '}
              <b className="rounded border border-edge px-1 py-px text-ink">Data</b> button in the top bar. Importing replaces the previous copy, so
              repeat it whenever you fetch a fresh file.
            </p>
            <ul className="space-y-3">
              {DATA_SOURCES.map((d) => (
                <li key={d.file} className="rounded-lg border border-edge bg-panel-2 p-3">
                  <div className="flex items-baseline justify-between gap-3">
                    <span className="font-semibold text-ink">{d.title}</span>
                    <span className="shrink-0 font-mono text-[11px] text-ink-3">
                      {d.file} · {d.size}
                    </span>
                  </div>
                  <p className="mt-1 text-ink-3">{d.gives}</p>
                  <a
                    className="mt-2 block truncate font-mono text-xs text-cyan underline decoration-cyan/40 underline-offset-2 hover:decoration-cyan"
                    href={d.url}
                    target="_blank"
                    rel="noreferrer"
                    title="Opens in your browser"
                  >
                    {d.url}
                  </a>
                  <p className="mt-2">
                    <span className="text-ink-3">Then: </span>
                    {d.then}
                  </p>
                </li>
              ))}
              <li className="rounded-lg border border-dashed border-edge p-3 text-ink-3">
                <span className="font-semibold text-ink-2">RadioReference</span> · coming soon.
              </li>
            </ul>
          </Section>

          <Section title="Keyboard">
            <p>
              The keypad follows the keyboard while the scanner is connected: arrow keys, <kbd className="font-mono text-ink">Enter</kbd> for SEL,{' '}
              <kbd className="font-mono text-ink">Esc</kbd> for MENU, <kbd className="font-mono text-ink">0-9</kbd> and{' '}
              <kbd className="font-mono text-ink">.</kbd>. Hover a key for its shortcut.
            </p>
          </Section>

          <p className="border-t border-edge pt-3 text-[11px] text-ink-3">
            Log and imported data live in %APPDATA%\TRXController. Open this screen again any time with the ? button in the top bar.
            Ctrl+Shift+D shows diagnostics (the raw display bytes on the Scanner display tab).
          </p>
        </div>
      </div>
    </div>
  );
}
