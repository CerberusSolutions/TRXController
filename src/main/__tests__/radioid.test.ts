import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { LogDb } from '../log/db';
import { DEFAULT_COLUMNS, jsonToUsers, mapColumns, readUserFile, rowToUser, splitCsvLine } from '../identities/radioid';

describe('splitCsvLine', () => {
  it('handles quotes, embedded commas and doubled quotes', () => {
    expect(splitCsvLine('1,G4ABC,"Smith, John","He said ""hi""",Leeds')).toEqual(['1', 'G4ABC', 'Smith, John', 'He said "hi"', 'Leeds']);
    expect(splitCsvLine('a,,c')).toEqual(['a', '', 'c']);
  });
});

describe('mapColumns', () => {
  it('maps the radioid.net header regardless of case or order', () => {
    const m = mapColumns(['RADIO_ID', 'CALLSIGN', 'FIRST_NAME', 'LAST_NAME', 'CITY', 'STATE', 'COUNTRY']);
    expect(m).toEqual({ id: 0, callsign: 1, firstName: 2, lastName: 3, name: -1, city: 4, state: 5, country: 6 });
    const m2 = mapColumns(['callsign', 'country', 'radio_id', 'name', 'surname']);
    expect(m2).toMatchObject({ id: 2, callsign: 0, firstName: 3, lastName: 4, country: 1 });
  });
  it('treats a lone "name" column as the full name', () => {
    expect(mapColumns(['id', 'callsign', 'name'])).toMatchObject({ name: 2, firstName: -1 });
  });
  it('rejects a data row', () => {
    expect(mapColumns(['2345678', 'G4ABC', 'John', 'Smith', 'Leeds', 'West Yorkshire', 'United Kingdom'])).toBeNull();
  });
});

describe('rowToUser', () => {
  it('builds a user with the name joined and callsign upper-cased', () => {
    const u = rowToUser(['2345678', 'g4abc', 'John', 'Smith', 'Leeds', 'W Yorks', 'United Kingdom'], DEFAULT_COLUMNS);
    expect(u).toEqual({ id: 2345678, callsign: 'G4ABC', name: 'John Smith', city: 'Leeds', state: 'W Yorks', country: 'United Kingdom' });
  });
  it('rejects rows without a numeric id or a callsign', () => {
    expect(rowToUser(['abc', 'G4ABC'], DEFAULT_COLUMNS)).toBeNull();
    expect(rowToUser(['123', ''], DEFAULT_COLUMNS)).toBeNull();
  });
});

describe('jsonToUsers', () => {
  it('reads the radioid.net JSON export', () => {
    const users = jsonToUsers('{"count":1,"results":[{"radio_id":2345678,"callsign":"G4ABC","name":"John","surname":"Smith","city":"Leeds","state":"","country":"United Kingdom"}]}');
    expect(users).toEqual([{ id: 2345678, callsign: 'G4ABC', name: 'John Smith', city: 'Leeds', state: '', country: 'United Kingdom' }]);
  });
});

describe('readUserFile + LogDb', () => {
  it('imports a CSV with a BOM and header, then resolves radio ids on log rows', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'trx-'));
    const csv = join(dir, 'user.csv');
    writeFileSync(
      csv,
      '﻿RADIO_ID,CALLSIGN,FIRST_NAME,LAST_NAME,CITY,STATE,COUNTRY\r\n' +
        '2345678,G4ABC,John,Smith,Leeds,West Yorkshire,United Kingdom\r\n' +
        '7654321,M0XYZ,"Jane ""JJ""",Doe,"Stoke, Staffs",,United Kingdom\r\n' +
        'bad,row\r\n' +
        '\r\n',
    );
    const parsed = await readUserFile(csv);
    expect(parsed.hadHeader).toBe(true);
    expect(parsed.users).toHaveLength(2);
    expect(parsed.skipped).toBe(1);
    expect(parsed.users[1]).toMatchObject({ id: 7654321, callsign: 'M0XYZ', name: 'Jane "JJ" Doe', city: 'Stoke, Staffs' });

    const db = new LogDb(':memory:');
    expect(db.replaceDmrUsers(parsed.users, 'user.csv', 1234)).toBe(2);
    expect(db.identityStats()).toEqual({ dmrUsers: 2, importedAt: 1234, source: 'user.csv' });
    expect(db.lookupDmrUser(7654321)?.callsign).toBe('M0XYZ');
    expect(db.lookupDmrUser(1)).toBeUndefined();

    const row = db.insert({ startedAt: 1, endedAt: 2, frequencyHz: 1, mode: '', signalType: '', name: '', system: '', scanlist: '', objectType: '', tgid: 9, radioId: 7654321, site: '', squelch: '', rssiPeak: 0 });
    expect(row.radioCallsign).toBe('M0XYZ');
    expect(row.radioName).toBe('Jane "JJ" Doe');
    const unknown = db.insert({ ...row, id: undefined as unknown as number, radioId: 5 } as never);
    expect(unknown.radioCallsign).toBeNull();

    // re-import replaces the table
    expect(db.replaceDmrUsers([{ id: 1, callsign: 'A', name: '', city: '', state: '', country: '' }], 'x', 2)).toBe(1);
    expect(db.identityStats().dmrUsers).toBe(1);
    db.close();
  });

  it('imports a headerless CSV using the default layout', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'trx-'));
    const csv = join(dir, 'user.csv');
    writeFileSync(csv, '2345678,G4ABC,John,Smith,Leeds,,United Kingdom\n');
    const parsed = await readUserFile(csv);
    expect(parsed.hadHeader).toBe(false);
    expect(parsed.users[0]?.callsign).toBe('G4ABC');
  });
});
