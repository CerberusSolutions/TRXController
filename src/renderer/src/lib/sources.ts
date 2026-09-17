import { SOURCE_NAME, type LookupSource } from '../../../shared/sources';

export { SOURCE_NAME };

/** Pill colours per lookup, shared by the hero's Listed block and the log's SRC column. */
export const SOURCE_PILL: Readonly<Record<Exclude<LookupSource, ''>, string>> = {
  RRDB: 'bg-cyan/15 text-cyan',
  WTR: 'bg-amber/15 text-amber',
  UKR: 'bg-green/15 text-green',
  RID: 'bg-panel-2 text-ink-2',
  MEM: 'bg-panel-2 text-ink-3',
  CONF: 'bg-green text-bg',
};

/**
 * The source to show on a log row: the stored one, except that a row whose only name is
 * the radio ID's callsign got that from radioid.net.
 */
export function rowSource(r: { name: string; source: LookupSource; radioCallsign: string | null }): LookupSource {
  return r.name === '' && r.radioCallsign && r.source !== 'RRDB' ? 'RID' : r.source;
}
