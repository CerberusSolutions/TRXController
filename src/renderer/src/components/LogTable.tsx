import { useEffect, useMemo, useState } from "react";
import type { ReceptionRow } from "../../../shared/ipc";
import { rowMatches, useLog } from "../store/log";

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

const COLS =
  "grid-cols-[4.5rem_4.75rem_6.5rem_2.75rem_minmax(7rem,1.4fr)_minmax(5rem,1fr)_minmax(4rem,0.5fr)_minmax(6.5rem,0.9fr)_3rem_2.5rem]";

export default function LogTable() {
  const rows = useLog((s) => s.rows);
  const filter = useLog((s) => s.filter);
  const setFilter = useLog((s) => s.setFilter);
  const clear = useLog((s) => s.clear);
  const [now, setNow] = useState(Date.now());
  const hasOpen = rows.some((r) => r.endedAt === null);

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
            ? `${rows.length} receptions`
            : `${visible.length} of ${rows.length}`}
        </span>
        <button
          className="ml-auto rounded-md border border-edge px-2 py-1 text-[11px] text-ink-3 hover:text-red disabled:opacity-40"
          disabled={rows.length === 0}
          onClick={() => {
            if (window.confirm("Delete the whole reception log?")) void clear();
          }}
        >
          Clear log
        </button>
      </div>

      {/* One scroll container for header and rows: a narrow window scrolls the table sideways
          (header stays aligned and pinned) instead of the fixed columns overflowing the panel. */}
      <div className="min-h-0 flex-1 overflow-auto">
        <div
          className={`sticky top-0 z-10 grid ${COLS} min-w-[50rem] gap-x-2 whitespace-nowrap border-b border-edge bg-panel px-2 pb-1 text-[10px] font-semibold uppercase tracking-widest text-ink-3`}
        >
          <span>Time</span>
          <span>Dur</span>
          <span>Frequency</span>
          <span>Mode</span>
          <span className="truncate">Name</span>
          <span className="truncate">System / list</span>
          <span className="truncate">Type</span>
          <span className="whitespace-nowrap">TGID/RID · Tone</span>
          <span className="text-right">RSSI</span>
          <span className="text-right">Hits</span>
        </div>

        <div className="min-w-[50rem] select-text font-mono text-[12.5px]">
          {visible.length === 0 && (
            <p className="px-2 py-6 text-center font-sans text-sm text-ink-3">
              {rows.length === 0
                ? "No receptions logged yet. Connect and let the scanner run."
                : "Nothing matches the filter."}
            </p>
          )}
          {visible.map((r) => {
            const open = r.endedAt === null;
            return (
              <div
                key={r.id}
                className={`grid ${COLS} items-center gap-x-2 whitespace-nowrap border-b border-edge/60 px-2 py-1 ${open ? "bg-green/10 text-ink" : "text-ink-2 hover:bg-panel-2"}`}
              >
                <span className="whitespace-nowrap">
                  {open && (
                    <span className="mr-1 inline-block h-1.5 w-1.5 animate-pulse rounded-full bg-green align-middle" />
                  )}
                  {fmtTime(r.startedAt)}
                  {fmtDate(r.startedAt) && (
                    <span className="ml-1 text-[10px] text-ink-3">
                      {fmtDate(r.startedAt)}
                    </span>
                  )}
                </span>
                <span
                  className="text-ink-3"
                  title={`First heard ${fmtTime(r.startedAt)}${r.endedAt ? `, last heard ${fmtTime(r.endedAt)}` : ""}${r.calls > 1 ? `, ${r.calls} calls` : ""}`}
                >
                  {fmtDuration(r, now)}
                  {r.calls > 1 && (
                    <span className="ml-1 text-ink-2">×{r.calls}</span>
                  )}
                </span>
                <span className="text-amber-2">
                  {(r.frequencyHz / 1e6).toFixed(6)}
                </span>
                <span className="text-cyan">{r.signalType || r.mode}</span>
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
                    <span className="text-ink-3">—</span>
                  ))}
              </span>
                <span className="truncate font-sans text-ink-2">
                  {r.system || r.scanlist}
                </span>
                <span className="truncate text-ink-3" title={r.objectType}>{r.objectType}</span>
                <span
                  className="truncate text-ink-3"
                  title={
                    r.tgid !== null || r.radioId !== null
                      ? `TGID ${r.tgid ?? "—"} · RID ${r.radioId ?? "—"}${r.radioCallsign ? ` (${r.radioCallsign}${r.radioName ? ", " + r.radioName : ""})` : ""}`
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
                    <span className="text-ink-2">
                      {r.tone.replace("CTCSS ", "CT ").replace("DCS ", "DCS ")}
                    </span>
                  ) : (
                    ""
                  )}
                </span>
                <span className="text-right">{r.rssiPeak}</span>
                <span className="text-right text-ink-3">{r.hits}</span>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
