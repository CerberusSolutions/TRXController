/**
 * Watches a DSD+ folder: tails `DSDPlus.event` into a `DsdFeed`, and re-reads `DSDPlus.radios` and
 * `DSDPlus.groups` when DSD+ rewrites them (every minute or so while it runs), naming radios in the log
 * from the aliases and keeping the talkgroup aliases for the System window. Polls file sizes once a
 * second: DSD+ keeps the files open and appends, and a stat poll is the one method that behaves the
 * same on Windows, macOS and Linux, including a folder on a network share.
 */
import { closeSync, copyFileSync, existsSync, openSync, readFileSync, readSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { ALIVE_MS, EMPTY_FEED, EMPTY_WRITE_BACK, parseDsdEventLine, reduceDsdEvent, type DsdCallEvent, type DsdFeed, type DsdStatus, type WriteBackStatus } from '../../shared/dsd';
import { aliasesOf, applyAliases, followModeOf, setGroupFollow, type FollowMode } from '../../shared/dsdWrite';
import { NoteThrottle, eventRows, type DsdEventRow } from '../../shared/dsdEvents';
import type { LearnedChannel } from '../../shared/dsdChannels';
import { parseDsdGroups, parseDsdRadios } from '../../shared/dsdRadios';
import type { NewRadioName } from '../../shared/radioNames';

export const EVENT_FILE = 'DSDPlus.event';
export const RADIOS_FILE = 'DSDPlus.radios';
export const GROUPS_FILE = 'DSDPlus.groups';
/** How often the files are looked at. */
export const POLL_MS = 1000;
/** How much of the event file's tail is replayed when the folder is set, to seed the site and recent calls. */
export const SEED_BYTES = 256 * 1024;
/** How many seed windows back the network and site lines are looked for (8 MB), when the tail has none. */
export const SEED_WINDOWS = 32;
/** A rewritten radios or groups file is read once it has sat unchanged this long (DSD+ writes them in one go, but be sure). */
export const SETTLE_MS = 1500;
/** Names are written this long after the last change that calls for it (several names typed in a row go in one write). */
export const WRITE_DEBOUNCE_MS = 2000;
/** DSD+ rewrites without our names this many times in a row and writing stops: it is not reading the file, so writing again would only loop. */
export const MAX_LOSSES = 3;
/** The copy taken of each file before the first write of a session, beside it. */
export const BACKUP_SUFFIX = '.trx-backup';

/** The names to write: what the user called a radio or a talkgroup on a DSD+ network, or null for no name of ours. */
export interface NameSource {
  radio: (network: string, radioId: number) => string | null;
  talkgroup: (network: string, tgid: number) => string | null;
}

export interface DsdWatcherOptions {
  /** Name radios from the radios file's aliases; returns how many were written. */
  nameRadios: (list: NewRadioName[]) => number;
  /** Name one DSD+ network's talkgroups from the groups file's aliases (the whole list each time); returns how many were written. */
  nameTalkgroups?: (network: string, list: { tgid: number; name: string }[]) => number;
  /** The scanner's system tag a DSD+ network is known as, if learned. */
  systemOf?: (network: string) => string | null;
  /** The status changed (throttled by the caller). `namesChanged` says the log's radio or talkgroup names moved. */
  onChange: (status: DsdStatus, namesChanged: boolean) => void;
  /** A call line as it lands (not from the seed), with the network key it belongs to: what the channel learner pairs with the TRX. */
  onCall?: (ev: DsdCallEvent, network: string | null) => void;
  /** The channel learner's view of a network, for the status. */
  channels?: (network: string) => Record<string, LearnedChannel>;
  /** Record events (one batch per poll, the seed included); returns how many were written. */
  record?: (rows: DsdEventRow[]) => number;
  /** The names to write back into DSD+'s files (asked for at each write, so they are always current). */
  names?: () => NameSource;
  log?: (msg: string) => void;
  now?: () => number;
}

interface Tracked {
  size: number;
  mtimeMs: number;
  /** When the file was last seen to change; it is read once that is `SETTLE_MS` ago. */
  changedAt: number | null;
  signature: string;
}

export class DsdWatcher {
  private folder: string | null = null;
  private timer: ReturnType<typeof setInterval> | null = null;
  private feed: DsdFeed = EMPTY_FEED;
  private offset = 0;
  private partial = '';
  private eventFound = false;
  private eventSize = 0;
  private radios: Tracked = { size: -1, mtimeMs: -1, changedAt: null, signature: '' };
  private groups: Tracked = { size: -1, mtimeMs: -1, changedAt: null, signature: '' };
  private named = 0;
  private importedAt: number | null = null;
  private groupAliases = new Map<string, string>();
  /** Rows waiting for the end of the poll, when they go to the database in one transaction. */
  private pending: DsdEventRow[] = [];
  private readonly throttle = new NoteThrottle();
  /** Rows recorded since the folder was set. */
  recorded = 0;
  /** A network's protocol as DSD+ last classified it: the protocol of its newest group line (DSD+ reclassified TIII sites in 2.457, so a network can carry both). */
  private networkProtocols = new Map<string, { protocol: string; lastHeard: string }>();
  private groupCount = 0;
  private error: string | null = null;
  /** What the last status pushed out said about liveness, so going quiet (or waking) is announced once. */
  private lastAlive = false;
  /** Each talkgroup's priority / override as the groups file has it, by `network|tgid`. */
  private groupFollow = new Map<string, FollowMode>();
  // --- write-back
  private writeBackOn = false;
  private writeBack: WriteBackStatus = { ...EMPTY_WRITE_BACK };
  private writeTimer: ReturnType<typeof setTimeout> | null = null;
  /** The names last written into each file, by `network|id`, so our own write is not re-imported as DSD+'s and a loss can be seen. */
  private wroteRadios = new Map<string, string>();
  private wroteGroups = new Map<string, string>();
  private backedUp = new Set<string>();
  private losses = 0;
  private readonly now: () => number;

  constructor(private readonly opts: DsdWatcherOptions) {
    this.now = opts.now ?? (() => Date.now());
  }

  /** Point the watcher at a folder (null switches the link off); the event file's tail is replayed to seed the feed. */
  setFolder(folder: string | null): void {
    if (folder === this.folder) return;
    this.stop();
    this.folder = folder;
    this.feed = EMPTY_FEED;
    this.offset = 0;
    this.partial = '';
    this.eventFound = false;
    this.eventSize = 0;
    this.radios = { size: -1, mtimeMs: -1, changedAt: null, signature: '' };
    this.groups = { size: -1, mtimeMs: -1, changedAt: null, signature: '' };
    this.pending = [];
    this.recorded = 0;
    this.throttle.reset();
    this.named = 0;
    this.importedAt = null;
    this.groupAliases.clear();
    this.networkProtocols.clear();
    this.groupCount = 0;
    this.groupFollow.clear();
    this.error = null;
    this.writeBack = { ...EMPTY_WRITE_BACK, enabled: this.writeBackOn };
    this.wroteRadios.clear();
    this.wroteGroups.clear();
    this.backedUp.clear();
    this.losses = 0;
    if (this.writeTimer) clearTimeout(this.writeTimer);
    this.writeTimer = null;
    if (!folder) {
      this.opts.onChange(this.status(), false);
      return;
    }
    this.seed();
    this.timer = setInterval(() => this.poll(), POLL_MS);
    this.poll();
    this.lastAlive = this.status().alive;
    this.opts.onChange(this.status(), false);
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    if (this.writeTimer) clearTimeout(this.writeTimer);
    this.writeTimer = null;
  }

  status(): DsdStatus {
    const tgNames: Record<number, string> = {};
    const net = this.feed.network?.id;
    if (net) {
      for (const [key, alias] of this.groupAliases) {
        const [network, tg] = key.split('|');
        if (network === net) tgNames[Number(tg)] = alias;
      }
    }
    const tgFollow: Record<number, FollowMode> = {};
    if (net) {
      for (const [key, mode] of this.groupFollow) {
        const [network, tg] = key.split('|');
        if (network === net && mode !== 'normal') tgFollow[Number(tg)] = mode;
      }
    }
    return {
      folder: this.folder,
      error: this.error,
      event: { found: this.eventFound, size: this.eventSize, lastEventAt: this.feed.lastEventAt },
      radios: { found: this.radios.size >= 0, named: this.named, importedAt: this.importedAt },
      groups: { found: this.groups.size >= 0, count: this.groupCount },
      tgNames,
      system: net ? (this.opts.systemOf?.(net) ?? null) : null,
      protocol: net ? (this.networkProtocols.get(net)?.protocol ?? null) : null,
      map: null,
      tgFollow,
      writeBack: { ...this.writeBack, enabled: this.writeBackOn },
      // Channels learned under the network's key, with any learned under the bare ID before keys carried names.
      channels: net && this.opts.channels ? { ...this.opts.channels(net), ...this.opts.channels(this.feed.network!.key) } : {},
      feed: this.feed,
      recorded: this.recorded,
      alive: this.folder !== null && this.eventFound && this.feed.lastEventAt !== null && this.now() - this.feed.lastEventAt < ALIVE_MS,
    };
  }

  /** Replay the end of the event file so the window opens with the site and the last few calls, not blank. */
  private seed(): void {
    const path = join(this.folder!, EVENT_FILE);
    try {
      if (!existsSync(path)) return;
      const size = statSync(path).size;
      const from = Math.max(0, size - SEED_BYTES);
      const text = this.read(path, from, size - from);
      // The first line may be a fragment when the window starts mid-file.
      const lines = text.split(/\r?\n/);
      if (from > 0) lines.shift();
      for (const line of lines) this.ingest(line);
      this.offset = size;
      this.eventFound = true;
      this.eventSize = size;
      this.flushPending();
      // A busy DMR site writes 500 registration lines a minute, so the tail may not reach back to the
      // "Current network" line: look further back, a window at a time, for the latest one and its site.
      if (!this.feed.network) this.seedContext(path, from);
    } catch (e) {
      this.error = `Cannot read ${EVENT_FILE}: ${(e as Error).message}`;
    }
  }

  /** Scan backwards from `end` for the most recent network and site lines and fold them in. */
  private seedContext(path: string, end: number): void {
    const NETWORK = /  Current network:  /;
    const SITE = /  Current site:  \S+-/;
    let network: string | null = null;
    let site: string | null = null;
    for (let windows = 0; end > 0 && windows < SEED_WINDOWS && !network; windows++) {
      const from = Math.max(0, end - SEED_BYTES);
      const lines = this.read(path, from, end - from).split(/\r?\n/);
      if (from > 0) lines.shift();
      for (let i = lines.length - 1; i >= 0; i--) {
        const line = lines[i]!;
        if (!site && SITE.test(line)) site = line;
        if (NETWORK.test(line)) {
          network = line;
          break;
        }
      }
      end = from;
    }
    if (network) this.ingest(network);
    if (site) this.ingest(site);
  }

  private poll(): void {
    if (!this.folder) return;
    let changed = false;
    let radiosChanged = false;
    // --- the event file: new bytes since last time
    const path = join(this.folder, EVENT_FILE);
    try {
      if (existsSync(path)) {
        const size = statSync(path).size;
        if (!this.eventFound) changed = true;
        this.eventFound = true;
        if (size < this.offset) {
          // Truncated or replaced: start again from the top.
          this.offset = 0;
          this.partial = '';
        }
        if (size > this.offset) {
          const text = this.partial + this.read(path, this.offset, size - this.offset);
          const lines = text.split(/\r?\n/);
          this.partial = lines.pop() ?? '';
          for (const line of lines) this.ingest(line, true);
          this.offset = size;
          changed = true;
        }
        this.eventSize = size;
        this.error = null;
      } else if (this.eventFound) {
        this.eventFound = false;
        changed = true;
      }
    } catch (e) {
      const msg = `Cannot read ${EVENT_FILE}: ${(e as Error).message}`;
      if (msg !== this.error) {
        this.error = msg;
        changed = true;
      }
    }
    // --- the radios and groups files: re-read once a rewrite has settled
    const now = this.now();
    if (this.track(this.radios, join(this.folder, RADIOS_FILE), now)) {
      changed = true;
      if (this.radios.changedAt === null) radiosChanged = this.importRadios() || radiosChanged;
    }
    if (this.track(this.groups, join(this.folder, GROUPS_FILE), now)) {
      changed = true;
      if (this.groups.changedAt === null) radiosChanged = this.readGroups() || radiosChanged;
    }
    this.flushPending();
    // Going quiet (or coming back) changes the pill without any file changing.
    const alive = this.status().alive;
    if (changed || alive !== this.lastAlive) {
      this.lastAlive = alive;
      this.opts.onChange(this.status(), radiosChanged);
    }
  }

  /** Note a file's size and mtime; true when it changed, or when a pending change has settled (then `changedAt` is null again). */
  private track(t: Tracked, path: string, now: number): boolean {
    let size = -1;
    let mtimeMs = -1;
    try {
      if (existsSync(path)) {
        const st = statSync(path);
        size = st.size;
        mtimeMs = st.mtimeMs;
      }
    } catch {
      return false;
    }
    if (size !== t.size || mtimeMs !== t.mtimeMs) {
      const first = t.size === -1;
      t.size = size;
      t.mtimeMs = mtimeMs;
      t.changedAt = size >= 0 ? now : null;
      // First sight: read at once; later rewrites wait to settle.
      if (first && size >= 0) {
        t.changedAt = null;
        return true;
      }
      return size < 0;
    }
    if (t.changedAt !== null && now - t.changedAt >= SETTLE_MS) {
      t.changedAt = null;
      return true;
    }
    return false;
  }

  /** Name the log's radios from the file's aliases; true when the set of names moved. */
  private importRadios(): boolean {
    try {
      const text = readFileSync(join(this.folder!, RADIOS_FILE), 'utf8');
      const { radios } = parseDsdRadios(text);
      this.noteLosses(text, 'radios');
      // A name we wrote is ours already (keyed to its system); importing it would add a copy keyed to any system.
      const named = radios.filter((r) => r.alias !== '' && this.wroteRadios.get(`${r.network}|${r.radioId}`) !== r.alias);
      const signature = named.map((r) => `${r.radioId}=${r.alias}`).sort().join('\n');
      if (signature === this.radios.signature) return false;
      this.radios.signature = signature;
      // DSD+ keys by its own network ID, not the scanner's system tag, so the names apply on any system.
      this.named = this.opts.nameRadios(named.map((r) => ({ radioId: r.radioId, system: '', name: r.alias })));
      this.importedAt = this.now();
      this.opts.log?.(`[dsd] ${this.named} radio names from ${RADIOS_FILE}`);
      this.scheduleWrite();
      return true;
    } catch (e) {
      this.opts.log?.(`[dsd] ${RADIOS_FILE}: ${(e as Error).message}`);
      return false;
    }
  }

  /** Read the groups file again and hand its aliases over afresh (a network has just been matched to a scanner system tag). */
  reimportGroups(): void {
    if (!this.folder || this.groups.size < 0) return;
    this.groups.signature = '';
    this.readGroups();
  }

  /** Read the groups file: aliases and protocols per network, and the log's talkgroup names when the aliases moved. */
  private readGroups(): boolean {
    try {
      const text = readFileSync(join(this.folder!, GROUPS_FILE), 'utf8');
      const { groups } = parseDsdGroups(text);
      this.noteLosses(text, 'groups');
      this.groupAliases.clear();
      this.groupFollow.clear();
      this.networkProtocols.clear();
      const byNetwork = new Map<string, { tgid: number; name: string }[]>();
      for (const g of groups) {
        this.groupFollow.set(`${g.network}|${g.tgid}`, followModeOf(g.priority, g.override));
        if (g.alias && this.wroteGroups.get(`${g.network}|${g.tgid}`) !== g.alias) {
          this.groupAliases.set(`${g.network}|${g.tgid}`, g.alias);
          const list = byNetwork.get(g.network) ?? [];
          list.push({ tgid: g.tgid, name: g.alias });
          byNetwork.set(g.network, list);
        }
        const known = this.networkProtocols.get(g.network);
        if (!known || g.lastHeard > known.lastHeard) this.networkProtocols.set(g.network, { protocol: g.protocol, lastHeard: g.lastHeard });
      }
      this.groupCount = groups.length;
      this.scheduleWrite();
      const signature = [...this.groupAliases].map(([k, v]) => `${k}=${v}`).sort().join('\n');
      if (signature === this.groups.signature || !this.opts.nameTalkgroups) return false;
      this.groups.signature = signature;
      let n = 0;
      for (const [network, list] of byNetwork) n += this.opts.nameTalkgroups(network, list);
      this.opts.log?.(`[dsd] ${n} talkgroup names from ${GROUPS_FILE}`);
      return true;
    } catch (e) {
      this.opts.log?.(`[dsd] ${GROUPS_FILE}: ${(e as Error).message}`);
      return false;
    }
  }

  // --- write-back ------------------------------------------------------------

  /** Switch writing on or off (Data › DSD+ link); on, the names go in at once. */
  setWriteBack(on: boolean): void {
    if (on === this.writeBackOn) return;
    this.writeBackOn = on;
    this.losses = 0;
    this.writeBack = { ...this.writeBack, enabled: on, error: null };
    if (on) this.scheduleWrite();
    else if (this.writeTimer) {
      clearTimeout(this.writeTimer);
      this.writeTimer = null;
    }
    this.opts.onChange(this.status(), false);
  }

  /** The user's names moved (a radio or talkgroup named or unnamed): write them soon. */
  namesChanged(): void {
    this.scheduleWrite();
  }

  private scheduleWrite(): void {
    if (!this.writeBackOn || !this.folder || !this.opts.names || this.writeBack.error) return;
    if (this.writeTimer) clearTimeout(this.writeTimer);
    this.writeTimer = setTimeout(() => {
      this.writeTimer = null;
      this.writeNames();
    }, WRITE_DEBOUNCE_MS);
  }

  /**
   * Write the user's names into both files now (`force` clears a stop). Each file is read afresh, the names
   * applied, and written only when a line changes; a file DSD+ is mid-rewrite (changed in the last
   * `SETTLE_MS`) waits for the next poll. Returns the status.
   */
  writeNames(force = false): WriteBackStatus {
    if (force) {
      this.losses = 0;
      this.writeBack = { ...this.writeBack, error: null };
    }
    if (!this.folder || !this.opts.names) return this.status().writeBack;
    if (!this.writeBackOn) {
      this.writeBack = { ...this.writeBack, error: 'Write-back is off' };
      return this.status().writeBack;
    }
    const names = this.opts.names();
    const now = this.now();
    // DSD+ mid-rewrite of either file: try again once it has settled, without a word.
    if ([this.radios, this.groups].some((t) => t.changedAt !== null && now - t.changedAt < SETTLE_MS)) {
      if (this.writeTimer) clearTimeout(this.writeTimer);
      this.writeTimer = setTimeout(() => {
        this.writeTimer = null;
        this.writeNames(force);
      }, SETTLE_MS);
      return this.status().writeBack;
    }
    let radios = 0;
    let groups = 0;
    let kept = 0;
    let wrote = false;
    try {
      const r = this.writeFile(RADIOS_FILE, this.radios, now, (text) => {
        const res = applyAliases(text, 'radios', names.radio);
        radios = res.written + res.unchanged;
        kept += res.kept;
        this.wroteRadios = new Map([...aliasesOf(res.text, 'radios')].filter(([k, v]) => v !== '' && names.radio(k.split('|')[0]!, Number(k.split('|')[1])) === v));
        return res.written > 0 ? res.text : null;
      });
      const g = this.writeFile(GROUPS_FILE, this.groups, now, (text) => {
        const res = applyAliases(text, 'groups', names.talkgroup);
        groups = res.written + res.unchanged;
        kept += res.kept;
        this.wroteGroups = new Map([...aliasesOf(res.text, 'groups')].filter(([k, v]) => v !== '' && names.talkgroup(k.split('|')[0]!, Number(k.split('|')[1])) === v));
        return res.written > 0 ? res.text : null;
      });
      wrote = r || g;
      this.writeBack = { ...this.writeBack, lastAt: wrote || this.writeBack.lastAt === null ? now : this.writeBack.lastAt, radios, groups, kept, error: null };
      if (wrote) this.opts.log?.(`[dsd] wrote ${radios} radio and ${groups} talkgroup names into DSD+'s files${kept ? ` (${kept} typed in DSD+ kept)` : ''}`);
    } catch (e) {
      this.writeBack = { ...this.writeBack, error: `Cannot write: ${(e as Error).message}` };
      this.opts.log?.(`[dsd] write-back: ${(e as Error).message}`);
    }
    this.opts.onChange(this.status(), false);
    return this.status().writeBack;
  }

  /**
   * Set a talkgroup's follow mode on the feed's current network: its priority and override in the groups file,
   * a line added when DSD+ has none for it yet. Needs write-back on.
   */
  setTalkgroupFollow(tgid: number, mode: FollowMode): WriteBackStatus {
    const network = this.feed.network?.id;
    if (!this.folder || !network) throw new Error('No DSD+ network');
    if (!this.writeBackOn) throw new Error('Turn on write-back in Data › DSD+ link first');
    const protocol = this.networkProtocols.get(network)?.protocol ?? null;
    const now = this.now();
    try {
      this.writeFile(GROUPS_FILE, this.groups, now, (text) => {
        const res = setGroupFollow(text, protocol ?? '', network, tgid, mode, now);
        if (res.appended && protocol === null) throw new Error("DSD+ has no line for this talkgroup yet and its groups file has not named the network's protocol; try once DSD+ has heard it");
        return res.changed ? res.text : null;
      });
      this.groupFollow.set(`${network}|${tgid}`, mode);
      this.writeBack = { ...this.writeBack, lastAt: now, error: null };
      this.opts.log?.(`[dsd] talkgroup ${tgid} on ${network}: ${mode}`);
    } catch (e) {
      this.writeBack = { ...this.writeBack, error: `Cannot write: ${(e as Error).message}` };
      throw e;
    } finally {
      this.opts.onChange(this.status(), false);
    }
    return this.status().writeBack;
  }

  /**
   * Read a file, let `change` produce its new text (null for nothing to write), and write it: a backup copy
   * beside it before the first write of the session, then the text in place (DSD+ keeps the file open, so it
   * is overwritten, never renamed over). True when written. A file still settling after a rewrite throws.
   */
  private writeFile(name: string, tracked: Tracked, now: number, change: (text: string) => string | null): boolean {
    const path = join(this.folder!, name);
    if (!existsSync(path)) return false;
    if (tracked.changedAt !== null && now - tracked.changedAt < SETTLE_MS) throw new Error(`${name} is being rewritten by DSD+; trying again shortly`);
    const text = readFileSync(path, 'utf8');
    const next = change(text);
    if (next === null || next === text) return false;
    if (!this.backedUp.has(name)) {
      copyFileSync(path, path + BACKUP_SUFFIX);
      this.backedUp.add(name);
    }
    writeFileSync(path, next, 'utf8');
    // Our own write is a change the tracker will see; note it so the next read is not taken for DSD+'s.
    const st = statSync(path);
    tracked.size = st.size;
    tracked.mtimeMs = st.mtimeMs;
    tracked.changedAt = null;
    return true;
  }

  /**
   * DSD+ rewrote a file: are the names we wrote still in it? A rewrite that drops them means DSD+ never read our
   * edit (an old version, or a copy it keeps in memory); after `MAX_LOSSES` in a row writing stops with a message,
   * since writing again would only loop. A file that still carries them resets the count.
   */
  private noteLosses(text: string, kind: 'radios' | 'groups'): void {
    const wrote = kind === 'radios' ? this.wroteRadios : this.wroteGroups;
    if (!this.writeBackOn || wrote.size === 0) return;
    const now = aliasesOf(text, kind);
    let lost = 0;
    for (const [key, name] of wrote) if (now.has(key) && now.get(key) !== name) lost++;
    if (lost === 0) {
      this.losses = 0;
      return;
    }
    this.losses++;
    this.opts.log?.(`[dsd] DSD+ rewrote ${kind === 'radios' ? RADIOS_FILE : GROUPS_FILE} without ${lost} name${lost === 1 ? '' : 's'} written to it (${this.losses} of ${MAX_LOSSES})`);
    if (this.losses >= MAX_LOSSES) {
      this.writeBack = { ...this.writeBack, error: `DSD+ keeps rewriting its files without the names written to them; restart DSD+ so it reads them, then Write now` };
      if (this.writeTimer) clearTimeout(this.writeTimer);
      this.writeTimer = null;
    }
  }

  private ingest(line: string, live = false): void {
    const ev = parseDsdEventLine(line);
    if (!ev) return;
    const before = this.feed;
    this.feed = reduceDsdEvent(before, ev);
    if (live && ev.kind === 'call') this.opts.onCall?.(ev, this.feed.network?.key ?? null);
    if (this.opts.record) for (const row of eventRows(before, this.feed, ev)) if (this.throttle.keep(row)) this.pending.push(row);
  }

  /** Hand the rows gathered since the last flush to the database, one transaction; a failure is logged, never thrown into the poll. */
  private flushPending(): void {
    if (this.pending.length === 0 || !this.opts.record) return;
    const rows = this.pending;
    this.pending = [];
    try {
      this.recorded += this.opts.record(rows);
    } catch (e) {
      this.opts.log?.(`[dsd] recording events: ${(e as Error).message}`);
    }
  }

  private read(path: string, from: number, length: number): string {
    const fd = openSync(path, 'r');
    try {
      const buf = Buffer.alloc(length);
      const n = readSync(fd, buf, 0, length, from);
      return buf.subarray(0, n).toString('utf8');
    } finally {
      closeSync(fd);
    }
  }
}
