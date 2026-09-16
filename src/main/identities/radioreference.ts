/**
 * RadioReference.com web service (SOAP 1.1, rpc/encoded) client.
 * WSDL: https://api.radioreference.com/soap2/?wsdl&v=latest (summarised in
 * docs/radioreference-api.md). Every call carries authInfo: the user's own
 * RadioReference premium username and password, this application's app key
 * (baked in at build time from RR_KEY), version "latest" and style "rpc".
 *
 * No SOAP or XML library: the envelopes we send are small and fixed, and the
 * replies are plain element trees with SOAP-encoded arrays of <item>, which the
 * tiny parser below turns into objects. Nothing here touches Electron, so it
 * runs under vitest with a fake fetch.
 */

export const RR_ENDPOINT = 'https://api.radioreference.com/soap2/index.php';
const RR_NS = 'http://api.radioreference.com/soap2';
const FETCH_TIMEOUT_MS = 20_000;

export interface RrAuth {
  username: string;
  password: string;
  appKey: string;
}

export type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

// --- Minimal XML ---------------------------------------------------------------

export interface XmlNode {
  name: string;
  attrs: Record<string, string>;
  children: XmlNode[];
  text: string;
}

function decodeEntities(s: string): string {
  return s.replace(/&(#x[0-9a-fA-F]+|#\d+|amp|lt|gt|quot|apos);/g, (_, e: string) => {
    if (e[0] === '#') return String.fromCodePoint(e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10));
    return { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" }[e] ?? '';
  });
}

/** Element name without its namespace prefix. */
function localName(qname: string): string {
  const i = qname.indexOf(':');
  return i < 0 ? qname : qname.slice(i + 1);
}

/** Parse a document into its root element. Comments, declarations and CDATA are handled; DTDs are not needed. */
export function parseXml(src: string): XmlNode {
  const root: XmlNode = { name: '#root', attrs: {}, children: [], text: '' };
  const stack: XmlNode[] = [root];
  let i = 0;
  const n = src.length;
  while (i < n) {
    const lt = src.indexOf('<', i);
    if (lt < 0) {
      stack[stack.length - 1]!.text += decodeEntities(src.slice(i));
      break;
    }
    if (lt > i) stack[stack.length - 1]!.text += decodeEntities(src.slice(i, lt));
    if (src.startsWith('<!--', lt)) {
      const end = src.indexOf('-->', lt);
      i = end < 0 ? n : end + 3;
      continue;
    }
    if (src.startsWith('<![CDATA[', lt)) {
      const end = src.indexOf(']]>', lt);
      stack[stack.length - 1]!.text += src.slice(lt + 9, end < 0 ? n : end);
      i = end < 0 ? n : end + 3;
      continue;
    }
    if (src.startsWith('<?', lt) || src.startsWith('<!', lt)) {
      const end = src.indexOf('>', lt);
      i = end < 0 ? n : end + 1;
      continue;
    }
    const gt = src.indexOf('>', lt);
    if (gt < 0) throw new Error('Malformed XML: unterminated tag');
    const raw = src.slice(lt + 1, gt);
    i = gt + 1;
    if (raw.startsWith('/')) {
      if (stack.length > 1) stack.pop();
      continue;
    }
    const selfClosing = raw.endsWith('/');
    const body = selfClosing ? raw.slice(0, -1) : raw;
    const m = /^([^\s/>]+)\s*([\s\S]*)$/.exec(body);
    if (!m) throw new Error('Malformed XML: bad tag');
    const node: XmlNode = { name: localName(m[1]!), attrs: {}, children: [], text: '' };
    const attrRe = /([^\s=]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g;
    let a: RegExpExecArray | null;
    while ((a = attrRe.exec(m[2]!))) node.attrs[localName(a[1]!)] = decodeEntities(a[2] ?? a[3] ?? '');
    stack[stack.length - 1]!.children.push(node);
    if (!selfClosing) stack.push(node);
  }
  const first = root.children[0];
  if (!first) throw new Error('Malformed XML: no root element');
  return first;
}

export function findChild(node: XmlNode, name: string): XmlNode | undefined {
  return node.children.find((c) => c.name === name);
}

/** Depth-first search for the first element with this local name. */
export function findDeep(node: XmlNode, name: string): XmlNode | undefined {
  for (const c of node.children) {
    if (c.name === name) return c;
    const hit = findDeep(c, name);
    if (hit) return hit;
  }
  return undefined;
}

export type Plain = string | null | Plain[] | { [k: string]: Plain };

/**
 * SOAP-encoded value to plain data: arrays (SOAP-ENC:Array or all-<item>
 * children) become arrays, elements with children become objects, leaves
 * become strings, xsi:nil becomes null.
 */
export function toPlain(node: XmlNode): Plain {
  if (node.attrs['nil'] === 'true' || node.attrs['nil'] === '1') return null;
  if (node.children.length === 0) return node.text.trim();
  const isArray = (node.attrs['arrayType'] !== undefined) || node.children.every((c) => c.name === 'item');
  if (isArray) return node.children.map(toPlain);
  const out: { [k: string]: Plain } = {};
  for (const c of node.children) out[c.name] = toPlain(c);
  return out;
}

// --- Envelope -------------------------------------------------------------------

function esc(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

export type SoapParam = string | number | null;

/** rpc/encoded request body for one operation; params in WSDL order, authInfo last. */
export function buildEnvelope(op: string, params: Record<string, SoapParam>, auth: RrAuth): string {
  const parts = Object.entries(params).map(([k, v]) => {
    if (v === null) return `<${k} xsi:nil="true"/>`;
    const type = typeof v === 'number' ? (Number.isInteger(v) ? 'xsd:int' : 'xsd:decimal') : 'xsd:string';
    return `<${k} xsi:type="${type}">${esc(String(v))}</${k}>`;
  });
  const authXml =
    `<authInfo xsi:type="ns1:authInfo">` +
    `<username xsi:type="xsd:string">${esc(auth.username)}</username>` +
    `<password xsi:type="xsd:string">${esc(auth.password)}</password>` +
    `<appKey xsi:type="xsd:string">${esc(auth.appKey)}</appKey>` +
    `<version xsi:type="xsd:string">latest</version>` +
    `<style xsi:type="xsd:string">rpc</style>` +
    `</authInfo>`;
  return (
    `<?xml version="1.0" encoding="UTF-8"?>` +
    `<SOAP-ENV:Envelope xmlns:SOAP-ENV="http://schemas.xmlsoap.org/soap/envelope/" ` +
    `xmlns:xsd="http://www.w3.org/2001/XMLSchema" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" ` +
    `xmlns:SOAP-ENC="http://schemas.xmlsoap.org/soap/encoding/" xmlns:ns1="${RR_NS}" ` +
    `SOAP-ENV:encodingStyle="http://schemas.xmlsoap.org/soap/encoding/">` +
    `<SOAP-ENV:Body><ns1:${op}>${parts.join('')}${authXml}</ns1:${op}></SOAP-ENV:Body></SOAP-ENV:Envelope>`
  );
}

export class RrError extends Error {
  constructor(
    message: string,
    /** SOAP fault code or HTTP status, for the UI to tell a bad login from an outage. */
    readonly code: string,
  ) {
    super(message);
    this.name = 'RrError';
  }
}

/** Call one operation and return the plain form of its `return` part. */
export async function rrCall(op: string, params: Record<string, SoapParam>, auth: RrAuth, fetchImpl: FetchLike = fetch): Promise<Plain> {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await fetchImpl(RR_ENDPOINT, {
      method: 'POST',
      signal: ctl.signal,
      headers: { 'Content-Type': 'text/xml; charset=utf-8', SOAPAction: `${RR_NS}#${op}`, 'User-Agent': 'TRXController' },
      body: buildEnvelope(op, params, auth),
    });
    const text = await res.text();
    let doc: XmlNode;
    try {
      doc = parseXml(text);
    } catch {
      throw new RrError(`RadioReference returned something that is not XML (HTTP ${res.status})`, String(res.status));
    }
    const fault = findDeep(doc, 'Fault');
    if (fault) {
      const code = findChild(fault, 'faultcode')?.text.trim() ?? String(res.status);
      const msg = findChild(fault, 'faultstring')?.text.trim() || 'RadioReference fault';
      throw new RrError(msg, code);
    }
    if (!res.ok) throw new RrError(`RadioReference HTTP ${res.status}`, String(res.status));
    const body = findDeep(doc, 'Body');
    const response = body?.children[0];
    const ret = response ? (findChild(response, 'return') ?? response.children[0]) : undefined;
    return ret ? toPlain(ret) : null;
  } finally {
    clearTimeout(timer);
  }
}

// --- Typed operations ----------------------------------------------------------

export interface RrCountry {
  coid: number;
  name: string;
  code: string;
}
export interface RrState {
  stid: number;
  name: string;
  code: string;
}
export interface RrUser {
  username: string;
  subExpireDate: string;
}
/** One searchStateFreq / searchCountyFreq hit. Trunked hits carry `sid`; conventional ones describe the channel. */
export interface RrFreqHit {
  outMHz: number;
  inMHz: number | null;
  callsign: string;
  descr: string;
  alpha: string;
  tone: string;
  colorCode: string;
  tg: string;
  slot: string;
  mode: string;
  class: string;
  tags: string[];
  sid: number | null;
  aid: number | null;
  ctid: number | null;
}
export interface RrSystemSummary {
  sid: number;
  name: string;
  type: number;
  flavor: number;
  voice: number;
  city: string;
  sysids: { sysid: string; wacn: string; ct: string }[];
}
export interface RrSite {
  siteId: number;
  siteNumber: number;
  descr: string;
  location: string;
  nac: string;
  ran: number | null;
  lat: number | null;
  lon: number | null;
  freqs: { freqMHz: number; use: string; colorCode: string; lcn: number | null }[];
}
export interface RrTalkgroup {
  tgDec: number;
  alpha: string;
  descr: string;
  mode: string;
  enc: number;
  slot: string;
  category: string;
  tags: string[];
}

type Obj = { [k: string]: Plain };
const obj = (p: Plain): Obj => (p && typeof p === 'object' && !Array.isArray(p) ? p : {});
const arr = (p: Plain): Plain[] => (Array.isArray(p) ? p : p && typeof p === 'object' ? [p] : []);
const str = (p: Plain | undefined): string => (typeof p === 'string' ? p : '');
const int = (p: Plain | undefined): number | null => {
  const v = Number(str(p));
  return str(p) !== '' && Number.isFinite(v) ? Math.trunc(v) : null;
};
const dec = (p: Plain | undefined): number | null => {
  const v = Number(str(p));
  return str(p) !== '' && Number.isFinite(v) ? v : null;
};
const tagNames = (p: Plain | undefined): string[] => arr(p ?? null).map((t) => str(obj(t)['tagDescr'])).filter(Boolean);

export function readFreqHit(p: Plain): RrFreqHit | null {
  const o = obj(p);
  const outMHz = dec(o['out']);
  if (outMHz === null) return null;
  return {
    outMHz,
    inMHz: dec(o['in']),
    callsign: str(o['callsign']),
    descr: str(o['descr']),
    alpha: str(o['alpha']),
    tone: str(o['tone']),
    colorCode: str(o['colorCode']),
    tg: str(o['tg']),
    slot: str(o['slot']),
    mode: str(o['mode']),
    class: str(o['class']),
    tags: tagNames(o['tags']),
    sid: int(o['sid']) || null,
    aid: int(o['aid']) || null,
    ctid: int(o['ctid']) || null,
  };
}

export function readTalkgroup(p: Plain, categories: Map<number, string>): RrTalkgroup | null {
  const o = obj(p);
  const tgDec = int(o['tgDec']);
  if (tgDec === null) return null;
  return {
    tgDec,
    alpha: str(o['tgAlpha']),
    descr: str(o['tgDescr']),
    mode: str(o['tgMode']),
    enc: int(o['enc']) ?? 0,
    slot: str(o['tgSlot']),
    category: categories.get(int(o['tgCid']) ?? -1) ?? '',
    tags: tagNames(o['tags']),
  };
}

export function readSite(p: Plain): RrSite | null {
  const o = obj(p);
  const siteId = int(o['siteId']);
  if (siteId === null) return null;
  return {
    siteId,
    siteNumber: int(o['siteNumber']) ?? 0,
    descr: str(o['siteDescr']),
    location: str(o['siteLocation']),
    nac: str(o['nac']),
    ran: int(o['ran']),
    lat: dec(o['lat']),
    lon: dec(o['lon']),
    freqs: arr(o['siteFreqs'] ?? null)
      .map((f) => {
        const fo = obj(f);
        const freqMHz = dec(fo['freq']);
        return freqMHz === null ? null : { freqMHz, use: str(fo['use']), colorCode: str(fo['colorCode']), lcn: int(fo['lcn']) };
      })
      .filter((f): f is NonNullable<typeof f> => f !== null),
  };
}

export function readSystem(sid: number, p: Plain): RrSystemSummary {
  const o = obj(p);
  return {
    sid,
    name: str(o['sName']),
    type: int(o['sType']) ?? 0,
    flavor: int(o['sFlavor']) ?? 0,
    voice: int(o['sVoice']) ?? 0,
    city: str(o['sCity']),
    sysids: arr(o['sysid'] ?? null).map((s) => ({ sysid: str(obj(s)['sysid']), wacn: str(obj(s)['wacn']), ct: str(obj(s)['ct']) })),
  };
}

/** The operations the app uses, each a thin wrapper over rrCall. */
export class RrClient {
  constructor(
    private readonly auth: RrAuth,
    private readonly fetchImpl: FetchLike = fetch,
  ) {}

  private call(op: string, params: Record<string, SoapParam> = {}): Promise<Plain> {
    return rrCall(op, params, this.auth, this.fetchImpl);
  }

  async getUserData(): Promise<RrUser> {
    const o = obj(await this.call('getUserData'));
    return { username: str(o['username']), subExpireDate: str(o['subExpireDate']) };
  }

  async getCountryList(): Promise<RrCountry[]> {
    return arr(await this.call('getCountryList'))
      .map((c) => ({ coid: int(obj(c)['coid']) ?? 0, name: str(obj(c)['countryName']), code: str(obj(c)['countryCode']) }))
      .filter((c) => c.coid > 0);
  }

  /** The "states" (regions) of a country: for the United Kingdom these are its nations / regions. */
  async getStates(coid: number): Promise<RrState[]> {
    const o = obj(await this.call('getCountryInfo', { coid }));
    return arr(o['stateList'] ?? null)
      .map((s) => ({ stid: int(obj(s)['stid']) ?? 0, name: str(obj(s)['stateName']), code: str(obj(s)['stateCode']) }))
      .filter((s) => s.stid > 0);
  }

  /** Everything known about a frequency (MHz) across a region: conventional channels and trunked systems using it. */
  async searchStateFreq(stid: number, freqMHz: number): Promise<RrFreqHit[]> {
    return arr(await this.call('searchStateFreq', { stid, freq: freqMHz, tone: '' }))
      .map(readFreqHit)
      .filter((h): h is RrFreqHit => h !== null);
  }

  async getTrsDetails(sid: number): Promise<RrSystemSummary> {
    return readSystem(sid, await this.call('getTrsDetails', { sid }));
  }

  async getTrsSites(sid: number): Promise<RrSite[]> {
    return arr(await this.call('getTrsSites', { sid }))
      .map(readSite)
      .filter((s): s is RrSite => s !== null);
  }

  async getTrsTalkgroups(sid: number): Promise<RrTalkgroup[]> {
    const cats = new Map<number, string>();
    for (const c of arr(await this.call('getTrsTalkgroupCats', { sid }))) {
      const id = int(obj(c)['tgCid']);
      if (id !== null) cats.set(id, str(obj(c)['tgCname']));
    }
    return arr(await this.call('getTrsTalkgroups', { sid, tgCid: null, tgTag: null, tgDec: null }))
      .map((t) => readTalkgroup(t, cats))
      .filter((t): t is RrTalkgroup => t !== null);
  }
}
