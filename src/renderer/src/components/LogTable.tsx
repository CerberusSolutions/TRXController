import { memo, useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import type { ReceptionRow, TrafficGroup } from "../../../shared/ipc";
import { formatPlace, type Units } from "../../../shared/geo";
import { pickConfirmation, type Confirmation, type NewConfirmation } from "../../../shared/confirm";
import { MAX_ROWS, rowMatches, useLog } from "../store/log";
import { useIdentities } from "../store/identities";
import { useScanner } from "../store/scanner";
import { logToCsv } from "../lib/csv";
import { SOURCE_NAME, SOURCE_PILL, rowSource } from "../lib/sources";

function fmtTime(ms: number): string {
  const d = new Date(ms);
  return d.toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  });
}

function fmtDate(ms: number): string {
  const d = new Date(ms);
  const today = new Date();
  return d.toDateString() === today.toDateString()
    ? ""
    : d.toLocaleDateString([], { day: "2-digit", month: "short" });
}

function fmtDuration(r: ReceptionRow, now: number): string {
  const end = r.endedAt ?? now;
  const s = Math.max(0, end - r.startedAt) / 1000;
  if (s < 60) return `${s.toFixed(s < 10 ? 1 : 0)}s`;
  const m = Math.floor(s / 60);
  const sec = Math.floor(s - m * 60);
  if (m < 60) return `${m}:${String(sec).padStart(2, '0')}`;
  const h = Math.floor(m / 60);
  return `${h}h${String(m - h * 60).padStart(2, '0')}`;
}

/** Simple is the everyday table; Detail shows what every source said, one column each. */
type View = "simple" | "detail";
const VIEW_KEY = "trx.logView";
const WIDTHS_KEY = "trx.logColumns";

interface RenderCtx {
  now: number;
  canTune: boolean;
  tuning: boolean;
  tune: (hz: number) => void;
  units: Units;
  /** Rows whose candidate list is unfolded beneath them. */
  /** Whether this row's candidate list is unfolded beneath it. */
  unfolded: boolean;
  toggle: (id: number) => void;
}

interface Column {
  key: string;
  label: string;
  /** Header tooltip. */
  title?: string;
  /** Default grid track (fixed rem, or minmax + fr for the ones that take spare width). */
  track: string;
  /** Narrowest the user may drag it, px. */
  minPx: number;
  align?: "right";
  /** Extra classes on the header cell. */
  headClass?: string;
  render: (r: ReceptionRow, ctx: RenderCtx) => ReactNode;
}

const dash = <span className="text-ink-3">—</span>;
const REM = 16;

// ---- cell renderers shared by both views -------------------------------------------------

/** "+" on rows that have candidates to unfold: everything the lookups offered for the frequency. */
const moreCell: Column = {
  key: "more",
  label: "",
  title: "Click + on a row to see every candidate the lookups offered for its frequency",
  track: "1.1rem",
  minPx: 1.1 * REM,
  render: (r, { unfolded: open, toggle }) => {
    const n = r.candidates?.length ?? 0;
    return (
      <button
        type="button"
        className={`w-full text-center leading-none ${open ? "text-ink" : "text-ink-3 hover:text-ink"}`}
        title={open ? "Fold away" : `${n ? `${n} candidate${n === 1 ? "" : "s"} from the lookups` : "No lookup offered a name"}, and the traffic heard on the frequency by code: click to show, then confirm the right one`}
        onClick={() => toggle(r.id)}
      >
        {open ? "−" : "+"}
      </button>
    );
  },
};

const distCell: Column = {
  key: "dist",
  label: "Dist",
  title: "Distance and bearing from your location (Data menu) to the row's licensee, repeater or listed site",
  track: "5.75rem",
  minPx: 4 * REM,
  render: (r, { units }) => <span className="text-ink-2">{formatPlace(r, units)}</span>,
};

const timeCell: Column = {
  key: "time",
  label: "Time",
  track: "4.25rem",
  minPx: 3.5 * REM,
  render: (r) => {
    const open = r.endedAt === null;
    return (
      <span className="whitespace-nowrap">
        {open && <span className="mr-1 inline-block h-1.5 w-1.5 animate-pulse rounded-full bg-green align-middle" />}
        {fmtTime(r.startedAt)}
        {fmtDate(r.startedAt) && <span className="ml-1 text-[10px] text-ink-3">{fmtDate(r.startedAt)}</span>}
      </span>
    );
  },
};

const durCell: Column = {
  key: "dur",
  label: "Dur",
  track: "4.25rem",
  minPx: 3 * REM,
  render: (r, { now }) => (
    <span
      className="text-ink-3"
      title={`First heard ${fmtTime(r.startedAt)}${r.endedAt ? `, last heard ${fmtTime(r.endedAt)}` : ""}${r.calls > 1 ? `, ${r.calls} calls` : ""}`}
    >
      {fmtDuration(r, now)}
      {r.calls > 1 && <span className="ml-1 text-ink-2">×{r.calls}</span>}
    </span>
  ),
};

const freqCell: Column = {
  key: "freq",
  label: "Frequency",
  track: "5.5rem",
  minPx: 5 * REM,
  render: (r, { canTune, tuning, tune }) => (
    <button
      type="button"
      className={`text-left text-amber-2 ${canTune && !tuning ? "cursor-pointer hover:underline hover:decoration-amber-2/60 hover:underline-offset-2" : "cursor-default"}`}
      disabled={!canTune || tuning}
      title={canTune ? `Tune to ${(r.frequencyHz / 1e6).toFixed(4)} MHz (Searches › Tune Mode)` : undefined}
      onClick={() => {
        if (canTune && !tuning) tune(r.frequencyHz);
      }}
    >
      {(r.frequencyHz / 1e6).toFixed(6)}
    </button>
  ),
};

const modeCell: Column = {
  key: "mode",
  label: "Mode",
  track: "2.75rem",
  minPx: 2.5 * REM,
  render: (r) => <span className="text-cyan">{r.signalType || r.mode}</span>,
};

const typeCell: Column = {
  key: "type",
  label: "Type",
  track: "minmax(5rem,0.6fr)",
  minPx: 3 * REM,
  render: (r) => (
    <span className="truncate text-ink-3" title={r.objectType}>
      {r.objectType}
    </span>
  ),
};

const idsCell: Column = {
  key: "ids",
  label: "TGID/RID · Tone",
  track: "minmax(6.75rem,0.7fr)",
  minPx: 4 * REM,
  headClass: "whitespace-nowrap",
  render: (r) => (
    <span
      className="truncate text-ink-3"
      title={
        r.tgid !== null || r.radioId !== null
          ? `TGID ${r.tgid ?? "—"} · RID ${r.radioId ?? "—"}${r.radioCallsign ? ` (${r.radioCallsign}${r.radioName ? ", " + r.radioName : ""})` : ""}${r.tone ? ` · ${r.tone}` : ""}`
          : r.tone
            ? `Detected ${r.tone}${r.squelch ? ` (programmed ${r.squelch})` : ""}`
            : undefined
      }
    >
      {r.tgid !== null ? r.tgid : ""}
      {r.tgid !== null && r.radioId !== null ? "/" : ""}
      {r.radioId !== null ? (
        // The callsign goes in the Name column when the row has no channel name, so show the number here;
        // a row with a real channel name has nowhere else for the callsign.
        r.radioCallsign && r.name ? (
          <span className="text-ink-2">{r.radioCallsign}</span>
        ) : (
          r.radioId
        )
      ) : (
        ""
      )}
      {r.tgid === null && r.radioId === null && r.tone ? (
        <span className="text-ink-2">{r.tone.replace("CTCSS ", "CT ").replace("DCS ", "DCS ")}</span>
      ) : (
        ""
      )}
    </span>
  ),
};

const rssiCell: Column = {
  key: "rssi",
  label: "RSSI",
  track: "3rem",
  minPx: 2.5 * REM,
  align: "right",
  render: (r) => <span className="text-right">{r.rssiPeak}</span>,
};

const hitsCell: Column = {
  key: "hits",
  label: "Hits",
  track: "2.5rem",
  minPx: 2.5 * REM,
  align: "right",
  render: (r) => <span className="text-right text-ink-3">{r.hits}</span>,
};

// ---- Simple view -------------------------------------------------------------------------

const nameCell: Column = {
  key: "name",
  label: "Name",
  track: "minmax(6rem,1.4fr)",
  minPx: 4 * REM,
  render: (r) => (
    <span
      className="truncate font-sans text-[13px] text-ink"
      title={r.name || !r.radioCallsign ? (r.licensee ? `Licensed: ${r.licensee}` : undefined) : `Radio ID ${r.radioId} (radioid.net)`}
    >
      {r.name ||
        (r.radioCallsign ? (
          `${r.radioCallsign}${r.radioName ? " " + r.radioName : ""}`
        ) : r.licensee ? (
          <span className="text-ink-2">{r.licensee}</span>
        ) : (
          dash
        ))}
    </span>
  ),
};

const sysListCell: Column = {
  key: "syslist",
  label: "Sys / list",
  title: "System from the scanner or RadioReference, else the scanlist",
  track: "minmax(5rem,1fr)",
  minPx: 3.5 * REM,
  render: (r) => <span className="truncate font-sans text-ink-2">{r.system || r.scanlist}</span>,
};

const srcCell: Column = {
  key: "src",
  label: "Src",
  title: "Where the name came from: blank for the scanner's own programming, else the lookup that supplied it",
  track: "2.75rem",
  minPx: 2.75 * REM,
  render: (r) => {
    const src = rowSource(r);
    return src ? (
      <span>
        <span className={`rounded px-1 py-px font-sans text-[9px] font-bold uppercase tracking-wider ${SOURCE_PILL[src]}`} title={src === "CONF" ? SOURCE_NAME.CONF : `Name from the ${SOURCE_NAME[src]}`}>
          {src}
        </span>
      </span>
    ) : (
      <span />
    );
  },
};

// ---- Detail view: one column per source --------------------------------------------------

/** Rows logged before the per-source fields existed only know the chosen name and its source. */
const fromLegacy = (r: ReceptionRow, source: ReceptionRow["source"]): string => (r.source === source ? (source === "" ? r.name : r.licensee) : "");

const scannerCell: Column = {
  key: "scanner",
  label: "Scanner",
  title: "The object name programmed in the scanner (dimmed when remembered from an earlier log entry on the frequency)",
  track: "minmax(6rem,1.2fr)",
  minPx: 4 * REM,
  render: (r) => {
    const remembered = r.source === "MEM";
    const v = r.scannerName || (remembered ? r.name : fromLegacy(r, ""));
    return (
      <span className={`truncate font-sans text-[13px] ${remembered ? "text-ink-2" : "text-ink"}`} title={v ? (remembered ? `${v} · ${SOURCE_NAME.MEM}` : v) : undefined}>
        {v || dash}
      </span>
    );
  },
};

const listCell: Column = {
  key: "list",
  label: "List",
  title: "The scanlist the object is in (or the search)",
  track: "minmax(5rem,0.8fr)",
  minPx: 3 * REM,
  render: (r) => (
    <span className="truncate font-sans text-ink-2" title={r.scanlist || undefined}>
      {r.scanlist}
    </span>
  ),
};

function lookupCell(key: "wtr" | "rrdb" | "rruk" | "ukr", label: string, title: string, track: string, value: (r: ReceptionRow) => string, extra?: (r: ReceptionRow) => string): Column {
  const pill = key === "wtr" ? "WTR" : key === "rrdb" ? "RRDB" : key === "rruk" ? "RRUK" : "UKR";
  return {
    key,
    label,
    title,
    track,
    minPx: 4 * REM,
    render: (r) => {
      const v = value(r);
      const more = extra?.(r) ?? "";
      const chosen = rowSource(r) === pill;
      return (
        <span className={`truncate font-sans ${chosen ? "text-ink" : "text-ink-2"}`} title={[v, more].filter(Boolean).join(" · ") || undefined}>
          {v || (more ? <span className="text-ink-3">{more}</span> : "")}
        </span>
      );
    },
  };
}

const wtrCell = lookupCell("wtr", "WTR", `Nearest licensee in the ${SOURCE_NAME.WTR}`, "minmax(6rem,1.2fr)", (r) => r.wtr || fromLegacy(r, "WTR"));
const rrdbCell = lookupCell(
  "rrdb",
  "RRDB",
  `Talkgroup or channel name from the ${SOURCE_NAME.RRDB} (its system when it has no name)`,
  "minmax(6rem,1.2fr)",
  (r) => r.rrName || fromLegacy(r, "RRDB"),
  (r) => r.rrSystem,
);
const rrukCell = lookupCell("rruk", "RRUK", `Best entry from ${SOURCE_NAME.RRUK}`, "minmax(6rem,1.2fr)", (r) => r.rruk || fromLegacy(r, "RRUK"));
const ukrCell = lookupCell("ukr", "UKR", `Repeater from the ${SOURCE_NAME.UKR}`, "minmax(4.5rem,0.6fr)", (r) => r.rpt || fromLegacy(r, "UKR"));

const sysCell: Column = {
  key: "sys",
  label: "Sys",
  title: "Trunked system, from the scanner or RadioReference",
  track: "minmax(5rem,0.8fr)",
  minPx: 3 * REM,
  render: (r) => (
    <span className="truncate font-sans text-ink-2" title={r.system || undefined}>
      {r.system}
    </span>
  ),
};

const SIMPLE: Column[] = [moreCell, timeCell, durCell, freqCell, modeCell, nameCell, sysListCell, srcCell, distCell, typeCell, idsCell, rssiCell, hitsCell];
const DETAIL: Column[] = [moreCell, timeCell, durCell, freqCell, modeCell, scannerCell, listCell, wtrCell, rrukCell, rrdbCell, ukrCell, sysCell, distCell, typeCell, idsCell, rssiCell, hitsCell];

function fmtStamp(ms: number): string {
  return `${fmtDate(ms) ? fmtDate(ms) + " " : ""}${fmtTime(ms)}`;
}

/**
 * What has been heard on the row's frequency, by tone / colour code and talkgroup: the users sharing
 * a channel tell apart by code, so this is what to confirm against.
 */
function Traffic({ r }: { r: ReceptionRow }) {
  const [groups, setGroups] = useState<TrafficGroup[] | null>(null);
  const rows = useLog((s) => s.rows);
  // Refetched when the log changes (a new reception on the frequency), cheaply: one grouped query.
  const version = useMemo(() => rows.filter((x) => x.frequencyHz === r.frequencyHz).map((x) => `${x.id}:${x.calls}:${x.endedAt}:${x.name}`).join(), [rows, r.frequencyHz]);
  useEffect(() => {
    let live = true;
    void window.trx?.logTraffic?.(r.frequencyHz).then((g) => {
      if (live) setGroups(g);
    });
    return () => {
      live = false;
    };
  }, [r.frequencyHz, version]);
  if (!groups || groups.length === 0) return null;
  const mine = (g: TrafficGroup): boolean => g.tone === r.tone && g.tgid === r.tgid;
  return (
    <ul className="mt-1 border-t border-edge/40 pt-1">
      <li className="flex items-center gap-2 py-px font-sans text-[10px] font-bold uppercase tracking-widest text-ink-2">
        <span className="w-9 shrink-0" />
        Traffic on {(r.frequencyHz / 1e6).toFixed(4)} by code
      </li>
      {groups.map((g, i) => (
        <li key={i} className={`flex min-w-0 items-center gap-2 py-px ${mine(g) ? "text-ink" : "text-ink-2"}`} title={`${g.calls} squelch openings in ${g.receptions} log ${g.receptions === 1 ? "entry" : "entries"}`}>
          <span className="w-9 shrink-0" />
          <span className="w-24 shrink-0 truncate" title="Tone / colour code and talkgroup">
            {[g.tone.replace("CTCSS ", "CT "), g.tgid !== null ? `TG ${g.tgid}` : ""].filter(Boolean).join(" · ") || <span className="text-ink-3">no code</span>}
          </span>
          <span className="w-16 shrink-0 text-right">{g.receptions} {g.receptions === 1 ? "entry" : "entries"}</span>
          <span className="w-32 shrink-0 truncate text-ink-3" title="First heard">
            {fmtStamp(g.firstAt)}
          </span>
          <span className="w-32 shrink-0 truncate text-ink-3" title="Last heard">
            {fmtStamp(g.lastAt)}
          </span>
          <span className="min-w-0 flex-1 truncate text-ink-3" title={g.radioCount ? `${g.radioCount} radio ID${g.radioCount === 1 ? "" : "s"}` : undefined}>
            {g.radioCount > 0 && (
              <>
                RID {g.radioIds.join(", ")}
                {g.radioCount > g.radioIds.length ? ` +${g.radioCount - g.radioIds.length}` : ""}
              </>
            )}
          </span>
          <span className="min-w-0 max-w-[16rem] shrink truncate font-sans text-[11.5px]" title={g.names.join(" · ") || undefined}>
            {g.names.join(" · ")}
          </span>
        </li>
      ))}
    </ul>
  );
}

/** The key a confirmation made from this row applies to: its tone (colour code, CTCSS, NAC) and, on a trunked object, its talkgroup. */
function confirmationKey(r: ReceptionRow): Pick<NewConfirmation, "frequencyHz" | "tone" | "tgid"> {
  const trunked = /^(TGRP|Talkgroup)$/i.test(r.objectType) || r.system !== "";
  return { frequencyHz: r.frequencyHz, tone: r.tone, tgid: trunked ? r.tgid : null };
}

function keyText(k: { tone: string; tgid: number | null }): string {
  return [k.tone, k.tgid !== null ? `TG ${k.tgid}` : ""].filter(Boolean).join(" · ") || "any tone";
}

/**
 * The unfolded candidate list under a row: one line per lookup answer, ranked as the hero listed them
 * at the time, each with a Confirm button; the confirmed one is marked and can be withdrawn; a name
 * none of them offer can be typed in.
 */
function Candidates({ r, units }: { r: ReceptionRow; units: Units }) {
  const confirmations = useLog((s) => s.confirmations);
  const confirm = useLog((s) => s.confirm);
  const unconfirm = useLog((s) => s.unconfirm);
  const [other, setOther] = useState("");
  const [busy, setBusy] = useState(false);
  const key = confirmationKey(r);
  const current: Confirmation | null = pickConfirmation(confirmations, r.frequencyHz, r.tone, r.tgid);
  const isCurrent = (source: string, name: string): boolean => current !== null && current.source === source && current.name === name;
  const run = async (task: Promise<void>): Promise<void> => {
    setBusy(true);
    try {
      await task;
    } finally {
      setBusy(false);
    }
  };
  const btn = "shrink-0 rounded border border-edge px-1.5 py-px font-sans text-[10px] text-ink-3 hover:text-ink disabled:opacity-40";
  const keyHint = `Applies to ${(r.frequencyHz / 1e6).toFixed(4)} MHz with ${keyText(key)}; renames every log entry it fits and names new ones, over the scanner's own programming`;
  const confirmedMark = (
    <span className="shrink-0 font-sans text-[10px] font-bold text-green" title={current ? `Confirmed ${new Date(current.confirmedAt).toLocaleString()} for ${keyText(current)}` : undefined}>
      ✓ confirmed
    </span>
  );
  const withdraw = current && (
    <button type="button" className={btn} disabled={busy} title="Withdraw this confirmation: the rows go back to the scanner's name, else the licensee" onClick={() => void run(unconfirm(current.id))}>
      remove
    </button>
  );
  return (
    <ul className="border-b border-edge/60 bg-panel-2/40 py-1 pr-2 pl-9 font-mono text-[12px] leading-snug">
      {current && current.source === "USER" && (
        <li className="flex min-w-0 items-center gap-2 py-px">
          <span className={`w-9 shrink-0 rounded px-1 py-px text-center font-sans text-[9px] font-bold uppercase tracking-wider ${SOURCE_PILL.CONF}`} title={SOURCE_NAME.CONF}>
            CONF
          </span>
          <span className="shrink-0 truncate font-sans text-[12.5px] text-ink">{current.name}</span>
          <span className="min-w-0 flex-1 truncate text-ink-3">{current.detail || "typed in by you"}</span>
          {r.lat !== null && r.lon !== null && (
            <button type="button" className={btn} title="Show this entry on the map" onClick={() => void window.trx.mapOpen?.({ kind: "row", row: r })}>
              map
            </button>
          )}
          {confirmedMark}
          {withdraw}
        </li>
      )}
      {r.candidates.map((c, i) => {
        const mine = isCurrent(c.source, c.name);
        return (
          <li key={i} className="flex min-w-0 items-center gap-2 py-px">
            <span className={`w-9 shrink-0 rounded px-1 py-px text-center font-sans text-[9px] font-bold uppercase tracking-wider ${SOURCE_PILL[c.source]}`} title={SOURCE_NAME[c.source]}>
              {c.source}
            </span>
            <span className={`shrink-0 truncate font-sans text-[12.5px] ${i === 0 || mine ? "text-ink" : "text-ink-2"}`}>{c.name}</span>
            {c.pills && <span className="shrink-0 text-[10px] text-ink-3">{c.pills}</span>}
            <span className="min-w-0 flex-1 truncate text-ink-3" title={c.detail || undefined}>
              {c.detail}
              {c.match === true && !c.detail.includes("✓") ? " ✓" : ""}
            </span>
            <span className="shrink-0 text-ink-2">{formatPlace(c, units) || <span className="text-ink-3">not placed</span>}</span>
            {c.lat !== null && c.lat !== undefined && c.lon !== null && c.lon !== undefined && (
              <button
                type="button"
                className={btn}
                title="Open the map window with every candidate pinned and the line drawn to this one"
                onClick={() => void window.trx.mapOpen?.({ kind: "row", row: r, pick: i })}
              >
                map
              </button>
            )}
            {mine ? (
              <>
                {confirmedMark}
                {withdraw}
              </>
            ) : (
              <button
                type="button"
                className={btn}
                disabled={busy}
                title={`This is the one. ${keyHint}`}
                onClick={() => void run(confirm({ ...key, name: c.name, system: c.source === "RRDB" && r.rrSystem ? r.rrSystem : "", source: c.source, detail: c.detail, distanceKm: c.distanceKm, bearingDeg: c.bearingDeg, lat: c.lat ?? null, lon: c.lon ?? null }))}
              >
                confirm
              </button>
            )}
          </li>
        );
      })}
      <li className="flex min-w-0 items-center gap-2 py-px">
        <span className="w-9 shrink-0" />
        <input
          className="w-56 rounded border border-edge bg-panel px-1.5 py-px font-sans text-[11px] text-ink placeholder:text-ink-3 outline-none focus:border-cyan"
          placeholder="Something else…"
          value={other}
          disabled={busy}
          onChange={(e) => setOther(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && other.trim()) void run(confirm({ ...key, name: other.trim(), system: "", source: "USER", detail: "", distanceKm: null, bearingDeg: null, lat: null, lon: null })).then(() => setOther(""));
          }}
        />
        <button
          type="button"
          className={btn}
          disabled={busy || !other.trim()}
          title={`Confirm a name none of the lookups offer. ${keyHint}`}
          onClick={() => void run(confirm({ ...key, name: other.trim(), system: "", source: "USER", detail: "", distanceKm: null, bearingDeg: null, lat: null, lon: null })).then(() => setOther(""))}
        >
          confirm
        </button>
        <span className="min-w-0 flex-1 truncate font-sans text-[10px] text-ink-3">{keyText(key)}</span>
      </li>
      <Traffic r={r} />
    </ul>
  );
}

// ---- persistence (per machine; a convenience, never state that matters) ------------------

type Widths = Record<string, number>;

function loadJson<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}

function saveJson(key: string, value: unknown): void {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* private mode etc. */
  }
}

/** Estimated row height for the virtual list, px; measured once rendered (unfolded rows are taller). */
const ROW_PX = 25;

interface RowProps {
  r: ReceptionRow;
  columns: readonly Column[];
  template: string;
  /** The clock for an open row's duration; 0 for a closed row, so the per-second tick leaves it alone. */
  now: number;
  canTune: boolean;
  tuning: boolean;
  tune: (hz: number) => void;
  units: Units;
  unfolded: boolean;
  toggle: (id: number) => void;
}

/** One log row (and its unfolded candidates). Memoised: only rows whose props change re-render. */
const Row = memo(function Row({ r, columns, template, now, canTune, tuning, tune, units, unfolded, toggle }: RowProps) {
  const open = r.endedAt === null;
  const ctx: RenderCtx = { now, canTune, tuning, tune, units, unfolded, toggle };
  return (
    <>
      <div
        className={`grid items-center gap-x-2 whitespace-nowrap border-b border-edge/60 px-2 py-1 ${open ? "bg-green/10 text-ink" : "text-ink-2 hover:bg-panel-2"}`}
        style={{ gridTemplateColumns: template }}
      >
        {columns.map((c) => (
          <span key={c.key} className={`min-w-0 truncate ${c.align === "right" ? "text-right" : ""}`}>
            {c.render(r, ctx)}
          </span>
        ))}
      </div>
      {unfolded && <Candidates r={r} units={units} />}
    </>
  );
});

export default function LogTable() {
  const rows = useLog((s) => s.rows);
  const filter = useLog((s) => s.filter);
  const setFilter = useLog((s) => s.setFilter);
  const clear = useLog((s) => s.clear);
  const [now, setNow] = useState(Date.now());
  const hasOpen = rows.some((r) => r.endedAt === null);
  // Click a frequency to tune to it, the same Searches › Tune Mode macro as the Band tab.
  const tune = useScanner((s) => s.tune);
  const tuneState = useScanner((s) => s.tuneState);
  const canTune = useScanner(
    (s) => (s.snapshot.link.status === "connected" || s.snapshot.link.status === "unresponsive") && !s.snapshot.link.stall,
  );
  const tuning = tuneState?.phase === "tuning";
  const tuneCb = useCallback((hz: number) => void tune(hz), [tune]);
  const loadMore = useLog((s) => s.loadMore);
  const exhausted = useLog((s) => s.exhausted);
  const loadingMore = useLog((s) => s.loadingMore);
  const capped = useLog((s) => s.capped);
  const units = useIdentities((s) => s.settings.units ?? "km");
  const [expanded, setExpanded] = useState<ReadonlySet<number>>(() => new Set());
  const toggle = useCallback((id: number) => {
    setExpanded((cur) => {
      const next = new Set(cur);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const [view, setView] = useState<View>(() => (loadJson<string>(VIEW_KEY, "simple") === "detail" ? "detail" : "simple"));
  // Column widths the user has dragged, px, keyed by column, kept per view. Untouched columns keep their default track.
  const [widths, setWidths] = useState<Record<View, Widths>>(() => loadJson(WIDTHS_KEY, { simple: {}, detail: {} }));
  const columns = view === "detail" ? DETAIL : SIMPLE;
  const headerRef = useRef<HTMLDivElement>(null);

  const chooseView = (v: View): void => {
    setView(v);
    saveJson(VIEW_KEY, v);
  };
  const setWidth = useCallback(
    (key: string, px: number | null) => {
      setWidths((all) => {
        const mine = { ...all[view] };
        if (px === null) delete mine[key];
        else mine[key] = Math.round(px);
        const next = { ...all, [view]: mine };
        saveJson(WIDTHS_KEY, next);
        return next;
      });
    },
    [view],
  );

  // Drag a header divider to resize the column on its left; double-click it to go back to the default.
  const startResize = (e: React.MouseEvent, col: Column, index: number): void => {
    e.preventDefault();
    const cell = headerRef.current?.children[index] as HTMLElement | undefined;
    if (!cell) return;
    const startX = e.clientX;
    const startW = cell.getBoundingClientRect().width;
    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";
    const onMove = (ev: MouseEvent): void => setWidth(col.key, Math.max(col.minPx, startW + ev.clientX - startX));
    const onUp = (): void => {
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
  };

  const template = columns.map((c) => (widths[view][c.key] ? `${widths[view][c.key]}px` : c.track)).join(" ");
  const minWidth = view === "detail" ? "79rem" : "60rem";

  // Tick once a second only while a reception is open, to grow its duration.
  useEffect(() => {
    if (!hasOpen) return;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [hasOpen]);

  const visible = useMemo(
    () => rows.filter((r) => rowMatches(r, filter)),
    [rows, filter],
  );

  // Only the rows in view (plus a margin) are in the page, however many are loaded; the rest is
  // one tall spacer. Rows are measured once rendered, so unfolded ones take the room they need.
  const scrollRef = useRef<HTMLDivElement>(null);
  // The sticky header sits above the rows in the same scroll box; the virtualiser needs to know by how much.
  const [headerH, setHeaderH] = useState(0);
  useEffect(() => {
    const el = headerRef.current;
    if (!el) return;
    setHeaderH(el.offsetHeight);
    const ro = new ResizeObserver(() => setHeaderH(el.offsetHeight));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  const footer = visible.length > 0 && (loadingMore || capped);
  const virtualizer = useVirtualizer({
    count: visible.length + (footer ? 1 : 0),
    getScrollElement: () => scrollRef.current,
    estimateSize: () => ROW_PX,
    overscan: 12,
    scrollMargin: headerH,
    getItemKey: (i) => (i < visible.length ? visible[i]!.id : "footer"),
  });
  const items = virtualizer.getVirtualItems();
  const lastIndex = items.length ? items[items.length - 1]!.index : -1;
  // Continuous scroll: fetch the next page when the view nears the end of what is loaded. With a
  // filter that matches little, that keeps reaching further back until something matches or the
  // log (or the memory cap) runs out.
  useEffect(() => {
    if (exhausted || loadingMore) return;
    if (visible.length === 0 || lastIndex >= visible.length - 30) void loadMore();
  }, [lastIndex, visible.length, exhausted, loadingMore, loadMore]);

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="mb-2 flex items-center gap-2">
        <input
          className="w-64 rounded-md border border-edge bg-panel-2 px-2 py-1 text-sm text-ink placeholder:text-ink-3 outline-none focus:border-cyan"
          placeholder="Filter (name, system, frequency, TGID…)"
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
        />
        <span className="text-[11px] text-ink-3">
          {visible.length === rows.length
            ? `${rows.length} log ${rows.length === 1 ? "entry" : "entries"}`
            : `${visible.length} of ${rows.length} log entries`}
        </span>
        {tuneState && (
          <span className={`text-[11px] ${tuneState.phase === "error" ? "text-red" : tuneState.phase === "done" ? "text-green" : "text-amber"}`}>
            {tuneState.phase === "tuning"
              ? `Tuning ${(tuneState.hz / 1e6).toFixed(4)} MHz…`
              : tuneState.phase === "done"
                ? `Tuned to ${(tuneState.hz / 1e6).toFixed(4)} MHz`
                : `Tune failed: ${tuneState.message ?? ""}`}
          </span>
        )}
        <div className="ml-auto flex overflow-hidden rounded-md border border-edge text-[11px]" role="radiogroup" aria-label="Log columns">
          {(["simple", "detail"] as const).map((v) => (
            <button
              key={v}
              role="radio"
              aria-checked={view === v}
              className={`px-2 py-1 ${view === v ? "bg-panel-2 text-ink" : "text-ink-3 hover:text-ink"}`}
              title={v === "simple" ? "The name each row was given and where it came from" : "What every source said: scanner, WTR, RadioReference UK, RadioReference, repeater list"}
              onClick={() => chooseView(v)}
            >
              {v === "simple" ? "Simple" : "Detail"}
            </button>
          ))}
        </div>
        <button
          className="rounded-md border border-edge px-2 py-1 text-[11px] text-ink-3 hover:text-ink disabled:opacity-40"
          disabled={visible.length === 0 || !window.trx?.logExportCsv}
          title="Save the frequencies shown (after the filter) as a CSV file EZ Scan can import: one object per frequency and tone or colour code, EZ Scan's columns first, then every source's column"
          onClick={() => {
            const stamp = new Date().toISOString().slice(0, 16).replace("T", "-").replace(":", "");
            void window.trx.logExportCsv(logToCsv(visible), `trx-ezscan-${stamp}.csv`);
          }}
        >
          CSV
        </button>
        <button
          className="rounded-md border border-edge px-2 py-1 text-[11px] text-ink-3 hover:text-red disabled:opacity-40"
          disabled={rows.length === 0}
          onClick={() => {
            if (window.confirm("Delete every log entry?")) void clear();
          }}
        >
          Clear log
        </button>
      </div>

      {/* One scroll container for header and rows: a narrow window scrolls the table sideways
          (header stays aligned and pinned) instead of the fixed columns overflowing the panel. */}
      <div ref={scrollRef} className="min-h-0 flex-1 overflow-auto">
        <div
          ref={headerRef}
          className="sticky top-0 z-10 grid gap-x-2 whitespace-nowrap border-b border-edge bg-panel px-2 pb-1 text-[10px] font-bold uppercase tracking-widest text-ink-2"
          style={{ gridTemplateColumns: template, minWidth }}
        >
          {columns.map((c, i) => (
            <span key={c.key} className={`relative min-w-0 ${c.align === "right" ? "text-right" : ""}`}>
              <span className={`block truncate ${c.headClass ?? ""}`} title={c.title}>
                {c.label}
              </span>
              {/* Divider handle in the column gap: drag to resize this column, double-click to reset it. */}
              <span
                className="absolute top-0 -right-1.5 z-10 h-full w-3 cursor-col-resize"
                onMouseDown={(e) => startResize(e, c, i)}
                onDoubleClick={() => setWidth(c.key, null)}
                title="Drag to resize · double-click to reset"
              >
                <span className="mx-auto block h-full w-px bg-edge" />
              </span>
            </span>
          ))}
        </div>

        <div className="relative select-text font-mono text-[12.5px]" style={{ minWidth, height: visible.length > 0 ? virtualizer.getTotalSize() : undefined }}>
          {visible.length === 0 && (
            <p className="px-2 py-6 text-center font-sans text-sm text-ink-3">
              {rows.length === 0
                ? "No log entries yet. Connect and let the scanner run."
                : loadingMore
                  ? "Nothing matches yet; looking further back…"
                  : "Nothing matches the filter."}
            </p>
          )}
          {items.map((vi) => {
            const r = visible[vi.index];
            return (
              <div key={vi.key} data-index={vi.index} ref={virtualizer.measureElement} className="absolute top-0 left-0 w-full" style={{ transform: `translateY(${vi.start - headerH}px)` }}>
                {r ? (
                  <Row
                    r={r}
                    columns={columns}
                    template={template}
                    now={r.endedAt === null ? now : 0}
                    canTune={canTune}
                    tuning={tuning}
                    tune={tuneCb}
                    units={units}
                    unfolded={expanded.has(r.id)}
                    toggle={toggle}
                  />
                ) : (
                  <p className="px-2 py-2 text-center font-sans text-xs text-ink-3">
                    {capped ? `Showing the newest ${MAX_ROWS.toLocaleString()} entries; narrow the filter or clear the log to go further back.` : "Loading older entries…"}
                  </p>
                )}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
