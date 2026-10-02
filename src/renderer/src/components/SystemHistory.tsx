/**
 * The System window's History view: one network's recorded day (`dsd_events`, written by main as DSD+'s event
 * file grows), as talkgroups, radios and sites with counts, airtime, busy hours and who talks on what. A
 * talkgroup or radio clicked narrows the other list to its partners: the first form of the network map.
 */
import { useEffect, useMemo, useState } from 'react';
import { dayKey, shiftDay } from '../../../shared/dayMap';
import { dsdEventsCsv, type DsdDaySummary, type DsdRadioSummary, type DsdTgSummary } from '../../../shared/dsdEvents';
import { useDsd } from '../store/dsd';

const hm = (t: number): string =>
  new Date(t).toLocaleTimeString([], {
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });
const PILL = 'shrink-0 rounded px-1 py-px font-sans text-[9px] font-bold uppercase tracking-wider';
const CHIP = 'inline-block max-w-[11rem] truncate rounded border px-1 py-px align-middle font-sans text-[11px] leading-4';
/** How often today's summary is refetched while on show. */
const REFRESH_MS = 15_000;
/** Radios shown before the list is cut, the filter box reaching the rest. */
const RADIO_ROWS = 300;

/** Seconds of airtime as "2 h 05 min", "12 min", "45 s". */
export function airtime(s: number): string {
  if (s >= 3600) return `${Math.floor(s / 3600)} h ${String(Math.round((s % 3600) / 60)).padStart(2, '0')} min`;
  if (s >= 60) return `${Math.round(s / 60)} min`;
  return `${s} s`;
}

interface Props {
  /** The network on show: DSD+'s current one, else the most recently recorded. */
  network: string | null;
  /** Names for the chips and the CSV: the user's, DSD+'s alias, else blank. */
  tgName: (tgid: number) => string;
  radioName: (rid: number, alias: string | null) => string;
}

export default function SystemHistory({ network, tgName, radioName }: Props) {
  const day = useDsd((s) => s.day);
  const dayBusy = useDsd((s) => s.dayBusy);
  const loadDay = useDsd((s) => s.loadDay);
  const [date, setDate] = useState(dayKey(new Date()));
  const [selTg, setSelTg] = useState<number | null>(null);
  const [selRid, setSelRid] = useState<number | null>(null);
  const [filter, setFilter] = useState('');
  const [saved, setSaved] = useState<string | null>(null);
  const today = dayKey(new Date());
  const isToday = date === today;

  // The day on show, refetched while it is today so the lists grow with the control channel.
  useEffect(() => {
    if (!network) return;
    void loadDay(network, date);
    if (!isToday) return;
    const t = setInterval(() => void loadDay(network, date), REFRESH_MS);
    return () => clearInterval(t);
  }, [network, date, isToday, loadDay]);

  // [ and ] step the day, never past today; Esc in an input only blurs it.
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      const input = (e.target as HTMLElement)?.tagName === 'INPUT';
      if (input) {
        if (e.key === 'Escape') (e.target as HTMLElement).blur();
        return;
      }
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      if (e.key === '[') setDate((d) => shiftDay(d, -1));
      if (e.key === ']') setDate((d) => (d < today ? shiftDay(d, 1) : d));
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [today]);

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

  const exportCsv = (): void => {
    if (!network || !window.trx?.dsdEvents || !window.trx.logExportCsv) return;
    void window.trx.dsdEvents(network, date).then(async (rows) => {
      const csv = dsdEventsCsv(rows, {
        tg: tgName,
        radio: (rid) => radioName(rid, null),
      });
      const path = await window.trx!.logExportCsv(csv, `dsd-${network.replace(/[^\w.-]+/g, '_')}-${date}.csv`);
      if (path) {
        setSaved(path);
        setTimeout(() => setSaved(null), 4000);
      }
    });
  };

  const tgLabel = (tgid: number): string => tgName(tgid) || `TG ${tgid}`;
  // The chips name a radio from the day's own rows when DSD+ printed an alias for it.
  const aliasOf = useMemo(() => new Map((summary?.radios ?? []).map((r) => [r.rid, r.alias])), [summary]);
  const ridLabel = (rid: number, alias: string | null = aliasOf.get(rid) ?? null): string => radioName(rid, alias) || String(rid);

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex shrink-0 flex-wrap items-baseline gap-x-2 gap-y-1 border-b border-edge bg-panel px-4 py-2 text-[12px] text-ink-2">
        <span className="text-[10px] font-bold uppercase tracking-widest text-ink-2">History</span>
        <button type="button" className="rounded border border-edge px-1.5 text-[11px] text-ink-3 hover:text-ink" title="The day before ([)" onClick={() => setDate((d) => shiftDay(d, -1))}>
          ◀
        </button>
        <input
          type="date"
          className="rounded border border-edge bg-bg px-1.5 py-px font-mono text-[12px] text-ink outline-none focus:border-cyan"
          value={date}
          max={today}
          onChange={(e) => {
            if (e.target.value && e.target.value <= today) setDate(e.target.value);
          }}
        />
        <button type="button" className="rounded border border-edge px-1.5 text-[11px] text-ink-3 hover:text-ink disabled:opacity-40" disabled={isToday} title="The day after (])" onClick={() => setDate((d) => shiftDay(d, 1))}>
          ▶
        </button>
        {summary ? (
          <span className="min-w-0 flex-1 truncate text-ink-3" title={summary.sites.map((s) => `${s.site}: ${s.calls} calls, ${hm(s.firstAt)} to ${hm(s.lastAt)}`).join('\n')}>
            {summary.calls.toLocaleString()} calls
            {summary.privateCalls ? ` (${summary.privateCalls} private)` : ''} · {summary.talkgroups.length} talkgroups · {summary.radios.length.toLocaleString()}
            {summary.radiosTruncated ? '+' : ''} radios · {summary.sites.length} site{summary.sites.length === 1 ? '' : 's'} · {summary.events.toLocaleString()} events
          </span>
        ) : (
          <span className="min-w-0 flex-1 truncate text-ink-3">{!network ? 'Nothing recorded yet' : dayBusy ? 'Loading…' : 'Nothing recorded for this day'}</span>
        )}
        <input
          className="w-32 rounded border border-edge bg-bg px-1.5 py-px font-sans text-[11px] text-ink placeholder:text-ink-3 outline-none focus:border-cyan"
          placeholder="Filter…"
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
        />
        <button
          type="button"
          className="rounded border border-edge px-2 py-0.5 text-[11px] text-ink-3 hover:text-ink disabled:opacity-40"
          disabled={!summary || summary.events === 0}
          title="Save the day's recorded events as CSV"
          onClick={exportCsv}
        >
          CSV
        </button>
        {saved && <span className="basis-full truncate font-mono text-[10px] text-green">Saved {saved}</span>}
      </div>

      {summary && summary.calls > 0 && (
        <div className="flex shrink-0 items-end gap-px border-b border-edge/50 px-4 pb-1 pt-2" title="Calls per hour">
          {summary.hours.map((n, h) => (
            <div key={h} className="flex flex-1 flex-col items-center gap-0.5" title={`${String(h).padStart(2, '0')}:00 · ${n} call${n === 1 ? '' : 's'}`}>
              <div
                className="w-full rounded-sm bg-cyan/60"
                style={{
                  height: `${Math.max(n > 0 ? 2 : 0, Math.round((n / maxHour) * 28))}px`,
                }}
              />
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
            className="rounded border border-edge px-1.5 text-[10px] text-ink-3 hover:text-ink"
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
        {summary && summary.talkgroups.length > 0 && (
          <table className="w-full border-collapse font-mono text-[12px]">
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
                  <tr
                    key={t.tgid}
                    className={`cursor-pointer border-t border-edge/50 ${sel ? 'bg-cyan/10' : 'hover:bg-panel'}`}
                    onClick={() => setSelTg(sel ? null : t.tgid)}
                    title={`Busiest at ${String(busiest).padStart(2, '0')}:00 · click to list the radios heard on it`}
                  >
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
                      {hm(t.firstAt)}–{hm(t.lastAt)}
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
                    <td className="whitespace-nowrap px-2 py-1 text-ink-3">{hm(r.lastAt)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
        {summary && radios.length > RADIO_ROWS && <p className="px-3 py-2 text-[11px] text-ink-3">{radios.length - RADIO_ROWS} more radios: narrow them with the filter.</p>}
        {summary && summary.events === 0 && <p className="p-6 text-sm text-ink-3">Nothing recorded for this day on {network}. Events are recorded as DSD+ writes them while the link is on.</p>}
      </div>
    </div>
  );
}
