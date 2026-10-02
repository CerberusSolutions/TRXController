import { useEffect } from 'react';
import { useUi } from '../store/ui';

const PUBLISHER = 'Cerberus Systems';
const REPO_URL = 'https://github.com/CerberusSolutions/TRXController';
/** The public page: downloads, install steps, user guide, FAQ. */
const SITE_URL = 'https://cerberussolutions.github.io/TRXController/';

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
    gives: 'Turns a DMR radio ID into a callsign and name on amateur DMR transmissions. A radio ID with an alpha tag on the scanner\'s own Radio ID list shows that tag instead.',
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
                replaces Whistler's own remote-control program: live display, keypad, log and band occupancy over the USB serial link.
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
                  {IS_MAC && (
                    <>
                      {' '}
                      <b className="text-amber">On a Mac no port will appear.</b> The TRX presents its serial interface in a single-interface form that
                      Windows and Linux drivers accept and Apple's does not, so macOS never creates a <span className="font-mono text-ink">/dev/cu.usbmodem</span>{' '}
                      port and this app has nothing to open; no lead, setting or driver changes that. The working route on a Mac is a Linux virtual
                      machine (UTM) with the scanner's USB device passed through, running the Linux arm64 AppImage. Details on the website's FAQ.
                    </>
                  )}
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
                <li>
                  The scanner's clock is set from this PC each time it connects, so recordings and the log agree on the time. Untick that under Data ›{' '}
                  <b className="text-ink">Scanner clock</b> if you would rather it were left alone; <b className="text-ink">Set clock now</b> sends it on demand. The
                  next transmission confirms the scanner took it.
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
                Downloads, install steps, the user guide and the FAQ:{' '}
                <a className="text-cyan underline decoration-cyan/40 underline-offset-2" href={SITE_URL} target="_blank" rel="noreferrer">
                  cerberussolutions.github.io/TRXController
                </a>
                . All releases: <a className="underline decoration-ink-3/40 underline-offset-2" href={`${REPO_URL}/releases`} target="_blank" rel="noreferrer">github.com/CerberusSolutions/TRXController/releases</a>.
              </p>
            </Section>

            <Section title="Keyboard and tuning">
              <p>
                The keypad follows the keyboard while the scanner is connected: arrow keys, <kbd className="font-mono text-ink">Enter</kbd> for SEL,{' '}
                <kbd className="font-mono text-ink">Esc</kbd> for MENU, <kbd className="font-mono text-ink">0-9</kbd> and{' '}
                <kbd className="font-mono text-ink">.</kbd>. Hover a key for its shortcut. The amber screen above the keys is the scanner's own display, drawn as
                it draws it; it goes dark when no scanner is connected or the scanner is off.
              </p>
              <p className="mt-2">
                Click a bar on the Band tab, a frequency in the log, or type one into the Tune box under the keypad, and the app walks the
                scanner's own menus (Searches › Tune Mode) to tune there. The scanner snaps the entry to its band plan, so an airband channel
                such as 126.595 lands on its carrier, 126.5917; the app accepts that and says so. <b className="text-ink">Scan</b> takes it back to scanning.
              </p>
            </Section>

            <Section title="Map">
              <p>
                The <b className="text-ink">map</b> button beside Listed, or beside any placed candidate in a log entry, opens a second window: you (your
                location from the Data dialog) and every candidate pinned on OpenStreetMap, with a line to the one the log chose and its
                distance and bearing. It follows the scanner, moving to each station it stops on and staying put while it sweeps, or stays on the entry it
                was opened from; F toggles between the two. Dock (or D) parks it beside
                the main window and keeps it there as that moves. Keys: + and − zoom, arrows pan, A fits everything in, Z centres on you; ? in the map's bar lists them. A WTR pin is the Ofcom licence holder, often a reseller's address
                rather than the transmitter; the card under each pin says what it marks. Tiles need an internet connection; the pins do not.
              </p>
              <p>
                The log's <b className="text-ink">Map</b> button, or L in the map, is the <b className="text-ink">Log view</b>: one day of the log, every placed entry as a pin at its
                placement with the number of entries on it and a card listing them. The bar picks the day ([ and ] step it) and filters as the log does; Live goes
                back to following the scanner. Only entries with a position appear; the bar counts the rest.
              </p>
            </Section>

            <Section title="Log export for EZ Scan">
              <p>
                The log's <b className="text-ink">CSV</b> button writes a file Whistler's EZ Scan imports as conventional objects (its CSV import):
                one object per frequency and tone or colour code, named from the log (16 characters, EZ Scan's limit), with the mode, tone or
                NAC, colour code and slot filled in, so a session's finds go into the scanner without retyping. The scanlist column is left empty, so EZ Scan
              files them under its default import scanlist (normally scanlist 1, and you can change that in EZ Scan). The log's
                own columns (times, sources, distance, candidates) follow EZ Scan's and are ignored by its importer. <b className="text-ink">Entries</b> beside it
                writes one line per entry with every column the table and the Detail view have, for a spreadsheet.
              </p>
            </Section>
          </div>
          <div className="space-y-4">
            <Section title="Optional data files">
              <p className="mb-3">
                Three free downloads make the log far more useful, and a RadioReference UK or RadioReference.com account adds names from those databases. Save each file anywhere, then load it with the{' '}
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
                    <span className="font-semibold text-ink">Your own radio names</span>
                    <span className="shrink-0 font-mono text-[11px] text-ink-3">DSDPlus.radios · optional</span>
                  </div>
                  <p className="mt-1 text-ink-3">
                    The scanner's own Radio ID list is cut to 16 characters and radioid.net knows only amateurs, so a radio ID can be given a name of your
                    own: ✎ beside the hero's Radio ID, or unfold a log entry and name the radio there (click a radio ID in its traffic list to name
                    that one). On a trunked system the name is keyed to the system; on a conventional channel it applies everywhere. It is shown ahead of
                    the scanner's alpha tag and radioid.net in the hero, the log and the traffic list.
                  </p>
                  <p className="mt-2">
                    <span className="text-ink-3">Then: </span>
                    Already named radios in DSD+? Data › Confirmed identities › <b className="text-ink">Import DSD+ radio list</b> reads its DSDPlus.radios file (in the DSD+
                    folder) and names every radio it has an alias for. Data › Confirmed identities lists them with a remove link.
                  </p>
                </li>
                <li className="rounded-lg border border-edge bg-panel-2 p-3">
                  <div className="flex items-baseline justify-between gap-3">
                    <span className="font-semibold text-ink">Your own talkgroup names</span>
                    <span className="shrink-0 font-mono text-[11px] text-ink-3">DSDPlus.groups · optional</span>
                  </div>
                  <p className="mt-1 text-ink-3">
                    The scanner shows UNID for a talkgroup its wildcard object caught and cuts its own alpha tags to 16 characters, so a talkgroup can be
                    given a name of your own: ✎ beside the hero's TGID, or unfold a log entry and name the talkgroup there. It is keyed to the trunked system
                    and outranks the scanner's alpha tag (a green TG pill); a confirmed identity still outranks it.
                  </p>
                  <p className="mt-2">
                    <span className="text-ink-3">Then: </span>
                    With the DSD+ link set up, the aliases in its DSDPlus.groups file come in by themselves and stand in wherever the scanner shows UNID (a
                    violet DSD pill), in the hero, the log and the System window. Data › Confirmed identities lists them.
                  </p>
                </li>
                <li className="rounded-lg border border-edge bg-panel-2 p-3">
                  <div className="flex items-baseline justify-between gap-3">
                    <span className="font-semibold text-ink">DSD+ link</span>
                    <a className="shrink-0 font-mono text-[11px] text-cyan underline decoration-cyan/40 underline-offset-2" href="https://www.dsdplus.com/" target="_blank" rel="noreferrer">
                      dsdplus.com
                    </a>
                  </div>
                  <p className="mt-1 text-ink-3">
                    DSD+ on a trunked system's control channel sees every call; the TRX follows one. Point the app at the DSD+ folder (Data › DSD+ link) and it
                    reads DSDPlus.event, .radios and .groups as DSD+ writes them: a DSD+ pill appears in the top bar, green while events arrive, and opens the
                    System window, every call on the system with its talkgroup, radio, channel and encryption, the one the TRX is on marked. Radio and talkgroup
                    aliases DSD+ learns go into the log as it learns them, no import needed. On a site DSD+ has no frequencies for it prints channel numbers; the app
                    learns what they are from the scanner's squelch openings, and Channel map (C) builds the Tier III channel plan from every anchor it has (neighbour
                    lists, the scanner's matches, your own), with a calculator and the lines for DSDPlus.frequencies, and a clear link for a channel learned from a
                    coincidence. Every
                    transmission, registration and affiliation is recorded; History (H) in the System window is the network map: a day, a week, a month or
                    everything, as calls per hour, the sites with their control channel, code and neighbours, the talkgroups with their radios and
                    airtime, the radios with their talkgroups, and CSVs of the map and the events.
                  </p>
                  <p className="mt-2">
                    <span className="text-ink-3">Then: </span>
                    Run DSD+ as usual. Feed it from an SDR dongle on the control channel rather than the TRX's IF output, so the TRX keeps its audio and DSD+ keeps the
                    whole system in view. Nothing is sent to DSD+; the link only reads its files.
                  </p>
                </li>
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
                    Generate an API key in your RRUK account dashboard and enter it under Data › RadioReference UK, then press Test: lookups run only once the key has passed a test. Lookups need a
                    location (or a postcode) under Data, and use the radius as the search range. The key is yours alone and is stored encrypted.
                  </p>
                </li>
                <li className="rounded-lg border border-edge bg-panel-2 p-3">
                  <div className="flex items-baseline justify-between gap-3">
                    <span className="font-semibold text-ink">RadioReference.com (online)</span>
                    <a className="shrink-0 font-mono text-[11px] text-cyan underline decoration-cyan/40 underline-offset-2" href="https://www.radioreference.com/" target="_blank" rel="noreferrer">
                      radioreference.com
                    </a>
                  </div>
                  <p className="mt-1 text-ink-3">
                    Names trunked systems, sites and talkgroups, and conventional channels, from the RadioReference database as frequencies are
                    heard. Results are cached, so each frequency is asked about once a month.
                  </p>
                  <p className="mt-2">
                    <span className="text-ink-3">Then: </span>
                    Data › RadioReference.com: enter your username and password (a premium subscription is required for API access)
                    and pick your country and region. The password is stored encrypted for your account only.
                  </p>
                </li>
              </ul>
            </Section>
          </div>
        </div>

        <p className="mt-4 border-t border-edge pt-3 text-[11px] text-ink-3">
          Log and imported data live in {DATA_DIR}. Open this screen again any time with the ? button in the top bar.
          {MOD_KEY}+Shift+D shows diagnostics: a Debug tab beside Log and Band with the display's raw bytes to copy into a report.
        </p>
      </div>
    </div>
  );
}
