/**
 * Names the user has given radio IDs: "radio 5 on SOT Council is Chatterley Whitfield Radio User 1".
 * The scanner's own Radio ID list is cut to the display's 16 characters, and radioid.net knows only
 * amateur radios, so this is where a full name lives. A radio name outranks both wherever a radio ID is
 * shown: the hero, the log's Name column, the traffic block and the tooltips.
 */

export interface RadioName {
  id: number;
  radioId: number;
  /**
   * The trunked system the ID belongs to (the scanner's system tag), since radio IDs are local to a
   * trunked system; '' = any system, which is how a conventional DMR radio ID (radioid.net's global
   * kind) is keyed.
   */
  system: string;
  name: string;
  /** ms since epoch */
  namedAt: number;
}

export type NewRadioName = Omit<RadioName, 'id' | 'namedAt'>;

/**
 * The name that applies to a radio ID heard on `system`: the one keyed to that system, else the one
 * keyed to any system. Null when the user has named neither.
 */
export function pickRadioName<T extends Pick<RadioName, 'radioId' | 'system'>>(list: readonly T[], radioId: number | null | undefined, system: string | null | undefined): T | null {
  if (radioId === null || radioId === undefined) return null;
  const sys = system ?? '';
  let any: T | null = null;
  for (const n of list) {
    if (n.radioId !== radioId) continue;
    if (n.system === sys) return n;
    if (n.system === '') any = n;
  }
  return any;
}

/** The system a radio ID is keyed by when named from a reception: the trunked system's tag, '' on a conventional object. */
export function radioNameSystem(r: { objectType: string; system: string }): string {
  return /^(TGRP|Talkgroup)$/i.test(r.objectType) ? r.system : '';
}
