/**
 * The System window's History view, the network map: one network's recorded period (`dsd_events`, written by
 * main as DSD+'s event file grows) as sites (control channel, code, neighbours), talkgroups and radios with
 * counts, airtime, busy hours and who talks on what. A talkgroup or radio clicked narrows the other list to
 * its partners. A day, a week, a month or everything recorded; two CSVs, the map and the events.
 */
import { useEffect, useMemo, useState } from 'react';
import { dayKey, dayRange, shiftDay } from '../../../shared/dayMap';
import { dsdEventsCsv, dsdMapCsv, type DsdDaySummary, type DsdRadioSummary, type DsdTgSummary } from '../../../shared/dsdEvents';
import { useDsd } from '../store/dsd';

const PILL = 'shrink-0 rounded px-1 py-px font-sans text-[9px] font-bold uppercase tracking-wider';
const CHIP = 'inline-block max-w-[11rem] truncate rounded border px-1 py-px align-middle font-sans text-[11px] leading-4';
const BTN = 'rounded border px-1.5 text-[11px] disabled:opacity-40';
/** How often today's summary is refetched while on show. */
const REFRESH_MS = 15_000;
/** Radios shown before the list is cut, the filter box reaching the rest. */
const RADIO_ROWS = 300;

type Range = 'day' | 'week' | 'month' | 'all';
const RANGES: { id: Range; label: string; days: number }[] = [
  { id: 'day', label: 'Day', days: 1 },
  { id: 'week', label: 'Week', days: 7 },
  { id: 'month', label: 'Month', days: 30 },
  { id: 'all', label: 'All', days: 0 },
];

/** Seconds of airtime as "2 h 05 min", "12 min", "45 s". */
export function airtime(s: number): string {
  if (s >= 3600) return `${Math.floor(s / 3600)} h ${String(Math.round((s % 3600) / 60)).padStart(2, '0')} min`;
  if (s >= 60) return `${Math.round(s / 60)} min`;
  return `${s} s`;
}

/** The period a range ending on `date` covers (`to` exclusive); "all" runs from the first recording. */
export function periodOf(range: Range, date: string): { from: number; to: number } {
  const { from, to } = dayRange(date);
  const days = RANGES.find((r) => r.id === range)!.days;
  if (range === 'all') return { from: 0, to };
  return { from: days === 1 ? from : dayRange(shiftDay(date, -(days - 1))).from, to };
}

interface Props {
  /** The network on show unless one is picked: DSD+'s current one, else the most recently recorded. */
  network: string | null;
  /** Every network recorded, newest activity first, for the picker. */
  networks: string[];
  /** Names for the chips and the CSV: the user's, DSD+'s alias, else blank. */
  tgName: (tgid: number) => string;
  radioName: (rid: number, alias: string | null) => string;
}

export default function SystemHistory({ network: current, networks, tgName, radioName }: Props) {
  const day = useDsd((s) => s.day);
  const dayBusy = useDsd((s) => s.dayBusy);
  const loadDay = useDsd((s) => s.loadDay);
  const [range, setRange] = useState<Range>('day');
  // A network picked by hand stays on show as DSD+ moves; otherwise the view follows DSD+.
  const [picked, setPicked] = useState<string | null>(null);
  const network = picked ?? current;
  const choices = [...new Set([...(current ? [current] : []), ...networks])];
  const [date, setDate] = useState(dayKey(new Date()));
  const [selTg, setSelTg] = useState<number | null>(null);
  const [selRid, setSelRid] = useState<number | null>(null);
  const [filter, setFilter] = useState('');
  const [saved, setSaved] = useState<string | null>(null);
  const today = dayKey(new Date());
  const isToday = date === today;
  const period = useMemo(() => periodOf(range, date), [range, date]);
  const stepDays = RANGES.find((r) => r.id === range)!.days;
  const step = (n: number): void => setDate((d) => (n > 0 && d >= today ? d : shiftDay(d, n)));
  // Times carry the date outside a single day.
  const when = (t: number): string =>
    range === 'day'
      ? new Date(t).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: false })
      : new Date(t).toLocaleString([], { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false });

  // The period on show, refetched while it ends today so the lists grow with the control channel.
  useEffect(() => {
    if (!network) return;
    void loadDay(network, period.from, period.to);
    if (!isToday) return;
    const t = setInterval(() => void loadDay(network, period.from, period.to), REFRESH_MS);
    return () => clearInterval(t);
  }, [network, period, isToday, loadDay]);

  // [ and ] step the period, never past today; Esc in an input only blurs it.
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      const input = (e.target as HTMLElement)?.tagName === 'INPUT';
      if (input) {
        if (e.key === 'Escape') (e.target as HTMLElement).blur();
        return;
      }
      if (e.ctrlKey || e.metaKey || e.altKey || stepDays === 0) return;
      if (e.key === '[') step(-stepDays);
      if (e.key === ']') step(stepDays);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [today, stepDays]);

  const summary: DsdDaySummary | null = day && day.network === network ? day : null;
  const q = filter.trim().toLowerCase();
  const tgText = (t: DsdTgSummary): string => `${t.tgid} ${tgName(t.tgid)}`.toLowerCase();
  const ridText = (r: DsdRadioSummary): string => `${r.rid} ${radioName(r.rid, r.alias)}`.toLowerCase();
  // A talkgroup picked narrows the radios to the ones heard on it (either side's top list knows the pair), and the other way about.
  const talkgroups = useMemo(() => {
    if (!summary) return [];
    const radio = selRid !== null ? summary.radios.find((r) => r.rid === selRid) : null;
    return summary.talkgroups.filter((t) => (q === '' || tgText(t).includes(q)) && (selRid === null || t.topRadios.some((r) => r.rid === selRid) || !!radio?.topTalkgroups.some((x) => x.tgid === t.tgid)));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [summary, q, selRid]);
  const radios = useMemo(() => {
    if (!summary) return [];
    const tg = selTg !== null ? summary.talkgroups.find((t) => t.tgid === selTg) : null;
    return summary.radios.filter((r) => (q === '' || ridText(r).includes(q)) && (selTg === null || r.topTalkgroups.some((x) => x.tgid === selTg) || !!tg?.topRadios.some((x) => x.rid === r.rid)));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [summary, q, selTg]);
  const maxHour = summary ? Math.max(1, ...summary.hours) : 1;

  const tgLabel = (tgid: number): string => tgName(tgid) || `TG ${tgid}`;
  // The chips name a radio from the period's own rows when DSD+ printed an alias for it.
  const aliasOf = useMemo(() => new Map((summary?.radios ?? []).map((r) => [r.rid, r.alias])), [summary]);
  const ridLabel = (rid: number, alias: string | null = aliasOf.get(rid) ?? null): string => radioName(rid, alias) || String(rid);
  const names = { tg: tgName, radio: (rid: number): string => radioName(rid, aliasOf.get(rid) ?? null) };
  const stamp = range === 'all' ? 'all' : range === 'day' ? date : `${range}-to-${date}`;
  const save = (csv: string, what: string): void => {
    if (!network || !window.trx?.logExportCsv) return;
    void window.trx.logExportCsv(csv, `dsd-${what}-${network.replace(/[^\w.-]+/g, '_')}-${stamp}.csv`).then((path) => {
      if (path) {
        setSaved(path);
        setTimeout(() => setSaved(null), 4000);
      }
    });
  };
  const exportMap = (): void => {
    if (summary) save(dsdMapCsv(summary, names), 'map');
  };
  const exportEvents = (): void => {
    if (!network || !window.trx?.dsdEvents) return;
    void window.trx.dsdEvents(network, period.from, period.to).then((rows) => save(dsdEventsCsv(rows, names), 'events'));
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex shrink-0 flex-wrap items-baseline gap-x-2 gap-y-1 border-b border-edge bg-panel px-4 py-2 text-[12px] text-ink-2">
        {choices.length > 1 && (
          <select
            className="max-w-[12rem] truncate rounded border border-edge bg-bg px-1 py-px font-sans text-[11px] text-ink outline-none focus:border-cyan"
            value={network ?? ''}
            title="The network on show; DSD+'s current one unless another is picked"
            onChange={(e) => setPicked(e.target.value === current ? null : e.target.value)}
          >
            {choices.map((n) => (
              <option key={n} value={n}>
                {n}
              </option>
            ))}
          </select>
        )}
        <span className="inline-flex overflow-hidden rounded border border-edge" title="History: the period on show">
          {RANGES.map((r) => (
            <button key={r.id} type="button" className={`px-1.5 text-[11px] ${range === r.id ? 'bg-cyan/15 text-cyan' : 'text-ink-3 hover:text-ink'}`} title={r.id === 'all' ? 'Everything recorded for the network' : `The ${r.label.toLowerCase()} ending on the date`} onClick={() => setRange(r.id)}>
              {r.label}
            </button>
          ))}
        </span>
        <button type="button" className={`${BTN} border-edge text-ink-3 hover:text-ink`} disabled={stepDays === 0} title="Back ([)" onClick={() => step(-stepDays)}>
          ◀
        </button>
        <input
          type="date"
          className="rounded border border-edge bg-bg px-1.5 py-px font-mono text-[12px] text-ink outline-none focus:border-cyan disabled:opacity-40"
          value={date}
          max={today}
          disabled={range === 'all'}
          onChange={(e) => {
            if (e.target.value && e.target.value <= today) setDate(e.target.value);
          }}
        />
        <button type="button" className={`${BTN} border-edge text-ink-3 hover:text-ink`} disabled={isToday || stepDays === 0} title="Forward (])" onClick={() => step(stepDays)}>
          ▶
        </button>
        <input className="ml-auto w-28 rounded border border-edge bg-bg px-1.5 py-px font-sans text-[11px] text-ink placeholder:text-ink-3 outline-none focus:border-cyan" placeholder="Filter…" value={filter} onChange={(e) => setFilter(e.target.value)} />
        <button type="button" className={`${BTN} border-edge py-0.5 text-ink-3 hover:text-ink`} disabled={!summary || summary.events === 0} title="Save the map as CSV: a line per site, talkgroup and radio with its partners" onClick={exportMap}>
          Map CSV
        </button>
        <button type="button" className={`${BTN} border-edge py-0.5 text-ink-3 hover:text-ink`} disabled={!summary || summary.events === 0} title="Save the period's recorded events as CSV" onClick={exportEvents}>
          Events CSV
        </button>
        {summary ? (
          <span className="basis-full truncate text-[11px] text-ink-3">
            {summary.calls.toLocaleString()} calls{summary.privateCalls ? ` (${summary.privateCalls} private)` : ''} · {summary.talkgroups.length} talkgroups · {summary.radios.length.toLocaleString()}
            {summary.radiosTruncated ? '+' : ''} radios · {summary.sites.length} site{summary.sites.length === 1 ? '' : 's'} · {summary.events.toLocaleString()} events recorded
          </span>
        ) : (
          <span className="basis-full truncate text-[11px] text-ink-3">{!network ? 'Nothing recorded yet' : dayBusy ? 'Loading…' : 'Nothing recorded for this period'}</span>
        )}
        {saved && <span className="basis-full truncate font-mono text-[10px] text-green">Saved {saved}</span>}
      </div>

      {summary && summary.calls > 0 && (
        <div className="flex shrink-0 items-end gap-px border-b border-edge/50 px-4 pb-1 pt-2" title="Calls per hour of the day">
          {summary.hours.map((n, h) => (
            <div key={h} className="flex flex-1 flex-col items-center gap-0.5" title={`${String(h).padStart(2, '0')}:00 · ${n} call${n === 1 ? '' : 's'}`}>
              <div className="w-full rounded-sm bg-cyan/60" style={{ height: `${Math.max(n > 0 ? 2 : 0, Math.round((n / maxHour) * 28))}px` }} />
              <span className="h-2.5 font-mono text-[8px] leading-none text-ink-3">{h % 6 === 0 ? String(h).padStart(2, '0') : ''}</span>
            </div>
          ))}
        </div>
      )}

      {(selTg !== null || selRid !== null) && (
        <div className="flex shrink-0 items-baseline gap-2 border-b border-edge/50 bg-panel px-4 py-1 text-[11px] text-ink-2">
          {selTg !== null && (
            <span>
              Radios on <b className="text-ink">{tgLabel(selTg)}</b>
            </span>
          )}
          {selRid !== null && (
            <span>
              Talkgroups used by <b className="text-ink">{ridLabel(selRid)}</b>
            </span>
          )}
          <button
            type="button"
            className={`${BTN} border-edge text-[10px] text-ink-3 hover:text-ink`}
            onClick={() => {
              setSelTg(null);
              setSelRid(null);
            }}
          >
            clear
          </button>
        </div>
      )}

      <div className="min-h-0 flex-1 overflow-auto">
        {summary && summary.sites.length > 0 && (
          <table className="w-full border-collapse font-mono text-[12px]">
            <thead className="sticky top-0 bg-bg">
              <tr className="text-left text-[10px] font-bold uppercase tracking-widest text-ink-2">
                <th className="px-3 py-1.5 font-bold">Site</th>
                <th className="px-2 py-1.5 font-bold">Control</th>
                <th className="px-2 py-1.5 font-bold">Code</th>
                <th className="px-2 py-1.5 font-bold">Neighbours</th>
                <th className="px-2 py-1.5 text-right font-bold">Calls</th>
                <th className="px-2 py-1.5 font-bold">Active</th>
              </tr>
            </thead>
            <tbody>
              {summary.sites.map((s) => (
                <tr key={s.site} className="border-t border-edge/50">
                  <td className="px-3 py-1">
                    <span className="font-sans text-[13px] text-ink">{s.name || s.site}</span>
                    {s.name && <span className="text-ink-3"> {s.site}</span>}
                  </td>
                  <td className="whitespace-nowrap px-2 py-1">{s.controlHz !== null ? <span className="text-amber" title="The control channel, from the scanner's header when it and DSD+ were on one call">{(s.controlHz / 1e6).toFixed(4)}</span> : <span className="text-ink-3" title="Known once the scanner and DSD+ have been seen on one call">—</span>}</td>
                  <td className="whitespace-nowrap px-2 py-1 text-ink-2">{s.code ?? ''}</td>
                  <td className="px-2 py-1">
                    {s.neighbours.map((n) => (
                      <span key={n.site} className={`${CHIP} mr-1 border-edge text-ink-2`} title={n.code ? `Site ${n.site}; ${n.code}` : `Site ${n.site}`}>
                        {n.site}
                        {n.code && <span className="text-ink-3"> {n.code.replace(/^CC=/, 'CC ')}</span>}
                      </span>
                    ))}
                  </td>
                  <td className="px-2 py-1 text-right text-ink-2">{s.calls || <span className="text-ink-3">—</span>}</td>
                  <td className="whitespace-nowrap px-2 py-1 text-ink-3">{s.firstAt !== null && s.lastAt !== null ? `${when(s.firstAt)}–${when(s.lastAt)}` : ''}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}

        {summary && summary.talkgroups.length > 0 && (
          <table className="mt-3 w-full border-collapse font-mono text-[12px]">
            <thead className="sticky top-0 bg-bg">
              <tr className="text-left text-[10px] font-bold uppercase tracking-widest text-ink-2">
                <th className="px-3 py-1.5 font-bold">Talkgroup</th>
                <th className="px-2 py-1.5 text-right font-bold">Calls</th>
                <th className="px-2 py-1.5 text-right font-bold">Radios</th>
                <th className="px-2 py-1.5 text-right font-bold">Airtime</th>
                <th className="px-2 py-1.5 font-bold">Active</th>
                <th className="px-2 py-1.5 font-bold">Heard From</th>
              </tr>
            </thead>
            <tbody>
              {talkgroups.map((t) => {
                const busiest = t.hours.indexOf(Math.max(...t.hours));
                const sel = selTg === t.tgid;
                return (
                  <tr key={t.tgid} className={`cursor-pointer border-t border-edge/50 ${sel ? 'bg-cyan/10' : 'hover:bg-panel'}`} onClick={() => setSelTg(sel ? null : t.tgid)} title={`Busiest at ${String(busiest).padStart(2, '0')}:00 · click to list the radios heard on it`}>
                    <td className="px-3 py-1">
                      <span className="font-sans text-[13px] text-ink">{tgLabel(t.tgid)}</span>
                      {tgName(t.tgid) && <span className="text-ink-3"> {t.tgid}</span>}
                      {t.enc > 0 && (
                        <span className={`${PILL} ml-1.5 bg-red/15 text-red`} title={`${t.enc} encrypted call${t.enc === 1 ? '' : 's'}`}>
                          ENC
                        </span>
                      )}
                      {t.emergency > 0 && <span className={`${PILL} ml-1.5 bg-red text-bg`}>Emergency {t.emergency}</span>}
                    </td>
                    <td className="px-2 py-1 text-right text-ink-2">{t.calls}</td>
                    <td className="px-2 py-1 text-right text-ink-2">{t.radios}</td>
                    <td className="whitespace-nowrap px-2 py-1 text-right text-ink-2">{airtime(t.seconds)}</td>
                    <td className="whitespace-nowrap px-2 py-1 text-ink-3">
                      {when(t.firstAt)}–{when(t.lastAt)}
                    </td>
                    <td className="px-2 py-1">
                      {t.topRadios.map((r) => (
                        <button
                          key={r.rid}
                          type="button"
                          className={`${CHIP} mr-1 ${selRid === r.rid ? 'border-cyan/60 text-cyan' : 'border-edge text-ink-2 hover:text-ink'}`}
                          title={`Radio ${r.rid}: ${r.calls} call${r.calls === 1 ? '' : 's'} on this talkgroup · click to list its talkgroups`}
                          onClick={(e) => {
                            e.stopPropagation();
                            setSelRid(selRid === r.rid ? null : r.rid);
                          }}
                        >
                          {ridLabel(r.rid)} <span className="text-ink-3">{r.calls}</span>
                        </button>
                      ))}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}

        {summary && summary.radios.length > 0 && (
          <table className="mt-3 w-full border-collapse font-mono text-[12px]">
            <thead className="sticky top-0 bg-bg">
              <tr className="text-left text-[10px] font-bold uppercase tracking-widest text-ink-2">
                <th className="px-3 py-1.5 font-bold">Radio</th>
                <th className="px-2 py-1.5 text-right font-bold">Calls</th>
                <th className="px-2 py-1.5 text-right font-bold">Airtime</th>
                <th className="px-2 py-1.5 font-bold">Talkgroups</th>
                <th className="px-2 py-1.5 font-bold">Private With</th>
                <th className="px-2 py-1.5 text-right font-bold" title="Registrations / affiliations">
                  Reg / Aff
                </th>
                <th className="px-2 py-1.5 font-bold">Last</th>
              </tr>
            </thead>
            <tbody>
              {radios.slice(0, RADIO_ROWS).map((r) => {
                const sel = selRid === r.rid;
                return (
                  <tr key={r.rid} className={`cursor-pointer border-t border-edge/50 ${sel ? 'bg-cyan/10' : 'hover:bg-panel'}`} onClick={() => setSelRid(sel ? null : r.rid)} title="Click to list the talkgroups it was heard on">
                    <td className="px-3 py-1" title={`Radio ID ${r.rid}${r.affiliatedTg !== null ? ` · affiliated to ${tgLabel(r.affiliatedTg)}` : ''}`}>
                      <span className="font-sans text-[13px] text-ink">{ridLabel(r.rid, r.alias)}</span>
                      {ridLabel(r.rid, r.alias) !== String(r.rid) && <span className="text-ink-3"> {r.rid}</span>}
                    </td>
                    <td className="px-2 py-1 text-right text-ink-2">{r.calls || <span className="text-ink-3">—</span>}</td>
                    <td className="whitespace-nowrap px-2 py-1 text-right text-ink-2">{r.seconds ? airtime(r.seconds) : ''}</td>
                    <td className="px-2 py-1">
                      {r.topTalkgroups.map((t) => (
                        <button
                          key={t.tgid}
                          type="button"
                          className={`${CHIP} mr-1 ${selTg === t.tgid ? 'border-cyan/60 text-cyan' : 'border-edge text-ink-2 hover:text-ink'}`}
                          title={`${t.calls} call${t.calls === 1 ? '' : 's'} on ${tgLabel(t.tgid)} · click to list the radios on it`}
                          onClick={(e) => {
                            e.stopPropagation();
                            setSelTg(selTg === t.tgid ? null : t.tgid);
                          }}
                        >
                          {tgLabel(t.tgid)} <span className="text-ink-3">{t.calls}</span>
                        </button>
                      ))}
                      {r.affiliatedTg !== null && !r.topTalkgroups.some((t) => t.tgid === r.affiliatedTg) && (
                        <span className={`${CHIP} border-dashed border-edge text-ink-3`} title="Affiliated to this talkgroup, not heard talking on it">
                          {tgLabel(r.affiliatedTg)}
                        </span>
                      )}
                    </td>
                    <td className="px-2 py-1">
                      {r.privateWith.map((p) => (
                        <button
                          key={p.rid}
                          type="button"
                          className={`${CHIP} mr-1 ${selRid === p.rid ? 'border-cyan/60 text-cyan' : 'border-edge text-ink-2 hover:text-ink'}`}
                          title={`${p.calls} private call${p.calls === 1 ? '' : 's'} with radio ${p.rid}`}
                          onClick={(e) => {
                            e.stopPropagation();
                            setSelRid(selRid === p.rid ? null : p.rid);
                          }}
                        >
                          {ridLabel(p.rid)} <span className="text-ink-3">{p.calls}</span>
                        </button>
                      ))}
                    </td>
                    <td className="whitespace-nowrap px-2 py-1 text-right text-ink-3">{r.registrations || r.affiliations ? `${r.registrations} / ${r.affiliations}` : ''}</td>
                    <td className="whitespace-nowrap px-2 py-1 text-ink-3">{when(r.lastAt)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
        {summary && radios.length > RADIO_ROWS && <p className="px-3 py-2 text-[11px] text-ink-3">{radios.length - RADIO_ROWS} more radios: narrow them with the filter.</p>}
        {summary && summary.events === 0 && <p className="p-6 text-sm text-ink-3">Nothing recorded for this period on {network}. Events are recorded as DSD+ writes them while the link is on.</p>}
      </div>
    </div>
  );
}
