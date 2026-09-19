import { useEffect } from 'react';
import { useUi } from '../store/ui';

const PUBLISHER = 'Cerberus Systems';
const REPO_URL = 'https://github.com/CerberusSolutions/TRXController';

const IS_MAC = typeof window !== 'undefined' && window.trx?.platform === 'darwin';
const IS_LINUX = typeof window !== 'undefined' && window.trx?.platform === 'linux';
/** Where the log, settings and imported data live, as the user would type it. */
const DATA_DIR = IS_MAC ? '~/Library/Application Support/TRXController' : IS_LINUX ? '~/.config/TRXController' : '%APPDATA%\\TRXController';
const MOD_KEY = IS_MAC ? 'Cmd' : 'Ctrl';

/** Where the two optional data files come from. Shown verbatim so they can be copied. */
const DATA_SOURCES = [
  {
    title: 'Ofcom Wireless Telegraphy Register',
    file: 'WTR.csv',
    size: 'about 55 MB',
    url: 'https://static.ofcom.org.uk/static/radiolicensing/html/register/WTR.csv',
    then: 'Data › Import WTR CSV…, then enter your latitude and longitude under Data so the nearest licensees are listed first.',
    gives: 'Names the business-radio licensee on a heard frequency (hero, log and Band tab).',
  },
  {
    title: 'UK amateur repeater list (RSGB ETCC)',
    file: 'repeaterlist_all.csv',
    size: 'about 60 KB',
    url: 'https://ukrepeater.net/csvfiles.html',
    then: 'On that page pick the "all" repeater list, save it, then Data › Import repeater list CSV….',
    gives: 'Names the amateur repeater on 10 m, 6 m, 2 m, 70 cm and 23 cm, with its CTCSS tone and mode capabilities (FM, DMR, D-STAR, Fusion).',
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
      <h3 className="mb-2 text-[11px] font-bold uppercase tracking-widest text-ink-2">{title}</h3>
      {children}
    </section>
  );
}

/** Modal help screen: what the app is, how to connect, where the data files come from. */
export default function HelpDialog() {
  const open = useUi((s) => s.helpOpen);
  const close = useUi((s) => s.closeHelp);
  const app = useUi((s) => s.app);
  const update = useUi((s) => s.update);

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
        className="relative max-h-[88vh] w-full max-w-[64rem] overflow-y-auto rounded-xl border border-edge bg-panel p-6 text-sm text-ink-2 shadow-2xl"
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

        {/* Two columns, balanced so neither needs much scrolling: the data files, the long one, on the right. */}
        <div className="grid gap-x-8 gap-y-4 md:grid-cols-2">
          <div className="space-y-4">
            <Section title="About">
              <p>
                Beta software from {PUBLISHER} for the Whistler TRX-1, TRX-1E and TRX-2 scanners (and the WS-1080 / 1088 / 1095 / 1098). It
                replaces Whistler's own remote-control program: live display, keypad, reception log and band occupancy over the USB serial link.
              </p>
              <p className="mt-2 text-ink-3">
                Provided as is, with no warranty or guarantee of any kind, express or implied. Use at your own risk. Not affiliated with Whistler,
                Ofcom, RadioID or the RSGB. Repeater data is published by the RSGB Emerging Technology Coordination Committee at ukrepeater.net.
              </p>
              <p className="mt-2 text-ink-3">
                Copyright © 2026 {PUBLISHER}. All rights reserved. Free for personal, non-commercial use; the source is published to be read, not
                reused. Terms in the{' '}
                <a className="text-cyan underline decoration-cyan/40 underline-offset-2" href={`${REPO_URL}/blob/main/LICENSE`} target="_blank" rel="noreferrer">
                  LICENSE
                </a>{' '}
                file.
              </p>
            </Section>

            <Section title="Getting connected">
              <ol className="list-decimal space-y-1 pl-5">
                <li>Connect the scanner by USB and switch it on.</li>
                <li>
                  Pick its serial port in the top bar. The Whistler port is chosen automatically when it can be told apart; use ⟳ to rescan after plugging
                  in.
                  {IS_LINUX && (
                    <>
                      {' '}
                      On Linux it appears as <span className="font-mono text-ink">/dev/ttyUSB0</span> or <span className="font-mono text-ink">/dev/ttyACM0</span>, and your
                      user must be in the <span className="font-mono text-ink">dialout</span> group to open it (<span className="font-mono text-ink">sudo usermod -aG dialout $USER</span>,
                      then log in again).
                    </>
                  )}
                </li>
                <li>
                  Press <b className="text-ink">Connect</b>. The port is remembered and reopened next time the app starts, and again if the scanner is
                  unplugged and plugged back in. <b className="text-ink">Disconnect</b> switches that off until you connect again.
                </li>
              </ol>
            </Section>

            <Section title="Updates">
              {update ? (
                update.newer ? (
                  <p>
                    <b className="text-green">Version {update.latest} is available</b> (you have {update.current}). Download the new{' '}
                    {IS_LINUX ? 'AppImage (or the .deb from the release page)' : 'installer'} and run it; settings, log and imported data are kept.{' '}
                    <a className="text-cyan underline decoration-cyan/40 underline-offset-2" href={update.downloadUrl ?? update.url} target="_blank" rel="noreferrer">
                      {update.downloadUrl ? 'Download ' + (update.downloadUrl.split('/').pop() ?? 'the installer') : 'Open the release page'}
                    </a>
                  </p>
                ) : (
                  <p>
                    You have the latest version, {update.current}.
                    <span className="text-ink-3"> Checked {new Date(update.checkedAt).toLocaleTimeString()}.</span>
                  </p>
                )
              ) : (
                <p className="text-ink-3">Not checked yet, or GitHub could not be reached. The app looks shortly after launch and every six hours.</p>
              )}
              <p className="mt-1 text-ink-3">
                All releases:{' '}
                <a className="underline decoration-ink-3/40 underline-offset-2" href="https://github.com/CerberusSolutions/TRXController/releases" target="_blank" rel="noreferrer">
                  github.com/CerberusSolutions/TRXController/releases
                </a>
              </p>
            </Section>

            <Section title="Keyboard and tuning">
              <p>
                The keypad follows the keyboard while the scanner is connected: arrow keys, <kbd className="font-mono text-ink">Enter</kbd> for SEL,{' '}
                <kbd className="font-mono text-ink">Esc</kbd> for MENU, <kbd className="font-mono text-ink">0-9</kbd> and{' '}
                <kbd className="font-mono text-ink">.</kbd>. Hover a key for its shortcut.
              </p>
              <p className="mt-2">
                Click a bar on the Band tab, a frequency in the log, or type one into the Tune box under the keypad, and the app walks the
                scanner's own menus (Searches › Tune Mode) to tune there. <b className="text-ink">Scan</b> takes it back to scanning.
              </p>
            </Section>

            <Section title="Log export for EZ Scan">
              <p>
                The log's <b className="text-ink">CSV</b> button writes a file Whistler's EZ Scan imports as conventional objects (its CSV import):
                one object per frequency and tone or colour code, named from the log (16 characters, EZ Scan's limit), with the mode, tone or
                NAC, colour code and slot filled in and no scanlist ticked, so a session's finds go into the scanner without retyping. The log's
                own columns (times, sources, distance, candidates) follow EZ Scan's and are ignored by its importer.
              </p>
            </Section>
          </div>
          <div className="space-y-4">
            <Section title="Optional data files">
              <p className="mb-3">
                Three free downloads make the log far more useful, and a RadioReference UK or RadioReference account adds names from those databases. Save each file anywhere, then load it with the{' '}
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
                <li className="rounded-lg border border-edge bg-panel-2 p-3">
                  <div className="flex items-baseline justify-between gap-3">
                    <span className="font-semibold text-ink">RadioReference UK (online)</span>
                    <a className="shrink-0 font-mono text-[11px] text-cyan underline decoration-cyan/40 underline-offset-2" href="https://radioreferenceuk.co.uk/" target="_blank" rel="noreferrer">
                      radioreferenceuk.co.uk
                    </a>
                  </div>
                  <p className="mt-1 text-ink-3">
                    The UK-centric, Ofcom-backed database: licensee, place, distance and the colour code or tone for business channels near you, as
                    frequencies are heard. Results are cached, so each frequency is asked about once a month.
                  </p>
                  <p className="mt-2">
                    <span className="text-ink-3">Then: </span>
                    Generate an API key in your RRUK account dashboard and enter it under Data › RadioReference UK, then press Test. Lookups need a
                    location (or a postcode) under Data, and use the radius as the search range. The key is yours alone and is stored encrypted.
                  </p>
                </li>
                <li className="rounded-lg border border-edge bg-panel-2 p-3">
                  <div className="flex items-baseline justify-between gap-3">
                    <span className="font-semibold text-ink">RadioReference (online)</span>
                    <span className="shrink-0 font-mono text-[11px] text-ink-3">premium account</span>
                  </div>
                  <p className="mt-1 text-ink-3">
                    Names trunked systems, sites and talkgroups, and conventional channels, from the RadioReference database as frequencies are
                    heard. Results are cached, so each frequency is asked about once a month.
                  </p>
                  <p className="mt-2">
                    <span className="text-ink-3">Then: </span>
                    Data › RadioReference: enter your radioreference.com username and password (a premium subscription is required for API access)
                    and pick your country and region. The password is stored encrypted for your account only.
                  </p>
                </li>
              </ul>
            </Section>
          </div>
        </div>

        <p className="mt-4 border-t border-edge pt-3 text-[11px] text-ink-3">
          Log and imported data live in {DATA_DIR}. Open this screen again any time with the ? button in the top bar.
          {MOD_KEY}+Shift+D shows diagnostics (the raw display bytes on the Scanner display tab).
        </p>
      </div>
    </div>
  );
}
