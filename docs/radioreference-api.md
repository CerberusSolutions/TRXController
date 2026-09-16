# RadioReference web service (as used by TRXController)

Source: `https://api.radioreference.com/soap2/?wsdl&v=latest` (SOAP 1.1, rpc/encoded,
endpoint `https://api.radioreference.com/soap2/index.php`). Client: `src/main/identities/radioreference.ts`;
cache and scheduling: `src/main/identities/rrService.ts`.

Every operation takes `authInfo { username, password, appKey, version: "latest", style: "rpc" }`
as its last parameter. `username` / `password` are the user's own RadioReference premium
login (stored encrypted with Electron safeStorage); `appKey` is this application's key, baked
in at build time from the `RR_KEY` environment variable (`electron.vite.config.ts`, GitHub
Actions secret in `release.yml`). A build without it has no RadioReference features.

## Operations used

| Operation | Parameters | Returns |
| --- | --- | --- |
| `getUserData` | | `{ username, subExpireDate }` (login test) |
| `getCountryList` | | `[{ coid, countryName, countryCode }]` |
| `getCountryInfo` | `coid` | `{ stateList: [{ stid, stateName, stateCode }], agencyList }` |
| `searchStateFreq` | `stid, freq (MHz), tone ('')` | `[searchFreqResult]` |
| `getTrsDetails` | `sid` | `Trs { sName, sType, sFlavor, sVoice, sCity, sysid: [{ sysid, wacn, ct }], ... }` |
| `getTrsSites` | `sid` | `[TrsSite { siteId, siteNumber, siteDescr, siteLocation, nac, ran, lat, lon, siteFreqs: [{ lcn, freq, use, colorCode }] }]` |
| `getTrsTalkgroupCats` | `sid` | `[{ tgCid, tgCname }]` |
| `getTrsTalkgroups` | `sid, tgCid?, tgTag?, tgDec?` | `[Talkgroup { tgDec, tgAlpha, tgDescr, tgMode, enc, tgSlot, tgCid, tags }]` |

`searchFreqResult { out, in, callsign, descr, alpha, tone, colorCode, tg, slot, mode, class, tags,
scid, sid, aid, ctid }`: a trunked hit carries the system `sid`; a conventional one has `sid` 0.

Other operations exist (county / metro / agency listings, `getTrsBySysid`, FCC lookups, feeds)
and are not used. The scanner does not report the P25 system ID over the serial link, so
frequency search is the way in.

## How the app uses it

- The region (`stid`) is chosen once in the Data menu (country, then region; for the United
  Kingdom the regions are its nations / areas as RadioReference lists them).
- When the squelch opens on a frequency that is not cached (`rr_freqs`, 30-day TTL), one
  `searchStateFreq` runs. Each trunked hit then fetches details, sites and the full talkgroup
  list once (`rr_systems`, `rr_talkgroups`, 90-day TTL). One call in flight, 1.2 s apart;
  a failed frequency is left alone for 10 minutes; a login-type fault empties the queue.
- The snapshot carries `rr: RrInfo` resolved for the current talkgroup and detected NAC
  (site match by frequency, then NAC). The hero shows a RadioReference block; the log fills
  a blank name / system from it.
