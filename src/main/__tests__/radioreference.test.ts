import { describe, expect, it } from 'vitest';
import { RrClient, RrError, buildEnvelope, parseXml, rrCall, toPlain, type FetchLike } from '../identities/radioreference';

const AUTH = { username: 'steve', password: 'p&ss<word>', appKey: 'key-123' };

function soap(body: string): string {
  return (
    '<?xml version="1.0" encoding="UTF-8"?>' +
    '<SOAP-ENV:Envelope xmlns:SOAP-ENV="http://schemas.xmlsoap.org/soap/envelope/" xmlns:ns1="http://api.radioreference.com/soap2" ' +
    'xmlns:xsd="http://www.w3.org/2001/XMLSchema" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xmlns:SOAP-ENC="http://schemas.xmlsoap.org/soap/encoding/">' +
    `<SOAP-ENV:Body>${body}</SOAP-ENV:Body></SOAP-ENV:Envelope>`
  );
}

function fake(responses: Record<string, string>, calls: { op: string; body: string }[] = []): FetchLike {
  return (async (_url: string, init?: RequestInit) => {
    const op = String((init?.headers as Record<string, string>)['SOAPAction']).split('#')[1]!;
    calls.push({ op, body: String(init?.body) });
    const xml = responses[op];
    if (!xml) throw new Error(`no fake response for ${op}`);
    return { ok: !xml.includes('Fault'), status: xml.includes('Fault') ? 500 : 200, text: async () => xml } as unknown as Response;
  }) as FetchLike;
}

describe('parseXml / toPlain', () => {
  it('reads elements, attributes, entities, CDATA, nil and SOAP arrays', () => {
    const doc = parseXml('<?xml version="1.0"?><!-- c --><a x="1" ns:y=\'2\'><b>T &amp; &lt;U&gt; &#65;</b><c/><d xsi:nil="true"/><e><![CDATA[<raw>]]></e><list SOAP-ENC:arrayType="ns1:t[2]"><item><k>1</k></item><item><k>2</k></item></list></a>');
    expect(doc.name).toBe('a');
    expect(doc.attrs).toEqual({ x: '1', y: '2' });
    expect(toPlain(doc)).toEqual({ b: 'T & <U> A', c: '', d: null, e: '<raw>', list: [{ k: '1' }, { k: '2' }] });
  });

  it('treats an element whose children are all <item> as an array even without arrayType', () => {
    expect(toPlain(parseXml('<r><item>1</item><item>2</item></r>'))).toEqual(['1', '2']);
  });
});

describe('buildEnvelope', () => {
  it('encodes params in order, types ints and decimals, nils optional params and escapes the auth block', () => {
    const xml = buildEnvelope('searchStateFreq', { stid: 41, freq: 145.5, tone: '' }, AUTH);
    expect(xml).toContain('<ns1:searchStateFreq><stid xsi:type="xsd:int">41</stid><freq xsi:type="xsd:decimal">145.5</freq><tone xsi:type="xsd:string"></tone><authInfo');
    expect(xml).toContain('<password xsi:type="xsd:string">p&amp;ss&lt;word&gt;</password>');
    expect(xml).toContain('<version xsi:type="xsd:string">latest</version><style xsi:type="xsd:string">rpc</style>');
    expect(buildEnvelope('getTrsTalkgroups', { sid: 1, tgCid: null }, AUTH)).toContain('<tgCid xsi:nil="true"/>');
  });
});

describe('rrCall', () => {
  it('returns the plain return part and surfaces SOAP faults as RrError with the fault code', async () => {
    const ok = fake({ getUserData: soap('<ns1:getUserDataResponse><return xsi:type="ns1:UserInfo"><username>steve</username><subExpireDate>2027-01-01</subExpireDate></return></ns1:getUserDataResponse>') });
    expect(await rrCall('getUserData', {}, AUTH, ok)).toEqual({ username: 'steve', subExpireDate: '2027-01-01' });
    const bad = fake({ getUserData: soap('<SOAP-ENV:Fault><faultcode>AUTH</faultcode><faultstring>Invalid username or password</faultstring></SOAP-ENV:Fault>') });
    await expect(rrCall('getUserData', {}, AUTH, bad)).rejects.toMatchObject({ name: 'RrError', code: 'AUTH', message: 'Invalid username or password' });
    const html = (async () => ({ ok: false, status: 502, text: async () => '<html><body>Bad gateway' })) as unknown as FetchLike;
    await expect(rrCall('getUserData', {}, AUTH, html)).rejects.toBeInstanceOf(RrError);
  });
});

describe('RrClient', () => {
  const HIT = (extra: string) =>
    `<item xsi:type="ns1:searchFreqResult"><out>417.725</out><in xsi:nil="true"/><callsign></callsign><descr>MoD Police</descr><alpha>MDP Disp</alpha><tone>167 NAC</tone><colorCode></colorCode><tg></tg><slot></slot><mode>P25</mode><class></class><tags><item><tagId>1</tagId><tagDescr>Law Dispatch</tagDescr></item></tags><scid>0</scid>${extra}</item>`;

  it('maps frequency search hits, systems, sites and talkgroups', async () => {
    const calls: { op: string; body: string }[] = [];
    const c = new RrClient(AUTH, fake({
      searchStateFreq: soap(`<ns1:searchStateFreqResponse><return SOAP-ENC:arrayType="ns1:searchFreqResult[2]">${HIT('<sid>9876</sid><aid>0</aid><ctid>0</ctid>')}${HIT('<sid>0</sid><aid>12</aid><ctid>34</ctid>')}</return></ns1:searchStateFreqResponse>`),
      getTrsDetails: soap('<ns1:getTrsDetailsResponse><return><sName>Airwave Test</sName><sType>16</sType><sFlavor>3</sFlavor><sVoice>2</sVoice><sCity>Cambridge</sCity><sysid><item><sysid>3A2</sysid><ct>Cambs</ct><wacn>BEE00</wacn><model></model></item></sysid></return></ns1:getTrsDetailsResponse>'),
      getTrsSites: soap('<ns1:getTrsSitesResponse><return><item><siteId>5</siteId><sid>9876</sid><siteNumber>3</siteNumber><siteDescr>Croughton</siteDescr><nac>167</nac><ran xsi:nil="true"/><siteLocation>RAF Croughton</siteLocation><lat>51.99</lat><lon>-1.19</lon><siteFreqs><item><lcn>1</lcn><freq>417.725</freq><use>c</use><colorCode></colorCode><ch_id></ch_id></item><item><lcn>2</lcn><freq>419.475</freq><use></use><colorCode></colorCode><ch_id></ch_id></item></siteFreqs></item></return></ns1:getTrsSitesResponse>'),
      getTrsTalkgroupCats: soap('<ns1:getTrsTalkgroupCatsResponse><return><item><tgCid>77</tgCid><sid>9876</sid><tgCname>Security</tgCname></item></return></ns1:getTrsTalkgroupCatsResponse>'),
      getTrsTalkgroups: soap('<ns1:getTrsTalkgroupsResponse><return><item><tgId>1</tgId><tgDec>63305</tgDec><tgAlpha>SEC 1</tgAlpha><tgDescr>Security Dispatch</tgDescr><tgMode>DE</tgMode><enc>1</enc><tgSlot></tgSlot><tgCid>77</tgCid><tags><item><tagId>3</tagId><tagDescr>Security</tagDescr></item></tags></item></return></ns1:getTrsTalkgroupsResponse>'),
    }, calls));
    const hits = await c.searchStateFreq(41, 417.725);
    expect(hits).toHaveLength(2);
    expect(hits[0]).toMatchObject({ outMHz: 417.725, inMHz: null, descr: 'MoD Police', alpha: 'MDP Disp', tone: '167 NAC', mode: 'P25', tags: ['Law Dispatch'], sid: 9876, aid: null });
    expect(hits[1]).toMatchObject({ sid: null, aid: 12, ctid: 34 });
    expect(calls[0]!.body).toContain('<freq xsi:type="xsd:decimal">417.725</freq>');

    expect(await c.getTrsDetails(9876)).toEqual({ sid: 9876, name: 'Airwave Test', type: 16, flavor: 3, voice: 2, city: 'Cambridge', lat: null, lon: null, rangeKm: null, sysids: [{ sysid: '3A2', wacn: 'BEE00', ct: 'Cambs' }] });
    const sites = await c.getTrsSites(9876);
    expect(sites[0]).toMatchObject({ siteId: 5, siteNumber: 3, descr: 'Croughton', nac: '167', ran: null, location: 'RAF Croughton', lat: 51.99 });
    expect(sites[0]!.freqs).toEqual([{ freqMHz: 417.725, use: 'c', colorCode: '', lcn: 1 }, { freqMHz: 419.475, use: '', colorCode: '', lcn: 2 }]);
    const tgs = await c.getTrsTalkgroups(9876);
    expect(tgs).toEqual([{ tgDec: 63305, alpha: 'SEC 1', descr: 'Security Dispatch', mode: 'DE', enc: 1, slot: '', category: 'Security', tags: ['Security'] }]);
  });

  it('lists countries and a country\'s regions', async () => {
    const c = new RrClient(AUTH, fake({
      getCountryList: soap('<ns1:getCountryListResponse><return><item><coid>1</coid><countryName>United States</countryName><countryCode>US</countryCode></item><item><coid>40</coid><countryName>United Kingdom</countryName><countryCode>GB</countryCode></item></return></ns1:getCountryListResponse>'),
      getCountryInfo: soap('<ns1:getCountryInfoResponse><return><coid>40</coid><countryName>United Kingdom</countryName><countryCode>GB</countryCode><agencyList/><stateList><item><stid>410</stid><stateName>England</stateName><stateCode>ENG</stateCode></item></stateList></return></ns1:getCountryInfoResponse>'),
    }));
    expect(await c.getCountryList()).toEqual([{ coid: 1, name: 'United States', code: 'US' }, { coid: 40, name: 'United Kingdom', code: 'GB' }]);
    expect(await c.getStates(40)).toEqual([{ stid: 410, name: 'England', code: 'ENG' }]);
  });
});
