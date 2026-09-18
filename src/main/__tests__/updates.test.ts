import { describe, expect, it } from 'vitest';
import { checkForUpdate, compareVersions, parseVersion, readRelease, type FetchLike } from '../updates';

const release = {
  tag_name: 'v0.2.4',
  name: 'v0.2.4',
  html_url: 'https://github.com/CerberusSolutions/TRXController/releases/tag/v0.2.4',
  published_at: '2026-09-15T12:00:00Z',
  draft: false,
  prerelease: false,
  assets: [
    { name: 'TRXController-Setup-0.2.4.exe', browser_download_url: 'https://github.com/x/TRXController-Setup-0.2.4.exe' },
    { name: 'TRXController-0.2.4-mac-arm64.dmg', browser_download_url: 'https://github.com/x/TRXController-0.2.4-mac-arm64.dmg' },
  ],
};

describe('versions', () => {
  it('parses with or without the v and compares numerically', () => {
    expect(parseVersion('v0.2.10')).toEqual([0, 2, 10]);
    expect(parseVersion('1.0')).toEqual([1, 0]);
    expect(parseVersion('latest')).toBeNull();
    expect(compareVersions('0.2.10', '0.2.9')).toBeGreaterThan(0);
    expect(compareVersions('v0.2.3', '0.2.3')).toBe(0);
    expect(compareVersions('0.3', '0.2.9')).toBeGreaterThan(0);
    expect(compareVersions('0.2.3', '1.0.0')).toBeLessThan(0);
  });
});

describe('readRelease', () => {
  it('flags a newer release with its page and installer link', () => {
    const info = readRelease(release, '0.2.3', 1000, 'win32');
    expect(info).toMatchObject({ current: '0.2.3', latest: '0.2.4', newer: true, checkedAt: 1000 });
    expect(info?.url).toContain('/releases/tag/v0.2.4');
    expect(info?.downloadUrl).toMatch(/Setup-0\.2\.4\.exe$/);
    expect(readRelease(release, '0.2.3', 1000, 'darwin')?.downloadUrl).toMatch(/mac-arm64\.dmg$/);
    expect(readRelease({ ...release, assets: [release.assets[0]] }, '0.2.3', 1000, 'darwin')?.downloadUrl).toBeNull();
    // Linux picks the AppImage for its own architecture; the .deb is on the release page.
    const linux = { ...release, assets: [...release.assets, { name: 'TRXController-0.2.4-linux-x86_64.AppImage', browser_download_url: 'https://x/l64' }, { name: 'TRXController-0.2.4-linux-arm64.AppImage', browser_download_url: 'https://x/la64' }, { name: 'TRXController-0.2.4-linux-amd64.deb', browser_download_url: 'https://x/deb' }] };
    expect(readRelease(linux, '0.2.3', 1000, 'linux', 'x64')?.downloadUrl).toBe('https://x/l64');
    expect(readRelease(linux, '0.2.3', 1000, 'linux', 'arm64')?.downloadUrl).toBe('https://x/la64');
    expect(readRelease(release, '0.2.3', 1000, 'linux', 'x64')?.downloadUrl).toBeNull();
    expect(info?.publishedAt).toBe(Date.parse('2026-09-15T12:00:00Z'));
  });

  it('is not newer when the app is on the latest or ahead of it', () => {
    expect(readRelease(release, '0.2.4')?.newer).toBe(false);
    expect(readRelease(release, '0.3.0')?.newer).toBe(false);
  });

  it('ignores drafts and unparseable payloads', () => {
    expect(readRelease({ ...release, draft: true }, '0.2.3')).toBeNull();
    expect(readRelease({ message: 'API rate limit exceeded' }, '0.2.3')).toBeNull();
    expect(readRelease(null, '0.2.3')).toBeNull();
  });
});

describe('checkForUpdate', () => {
  it('returns the release from a good response and null on failure', async () => {
    const ok = (async () => ({ ok: true, json: async () => release })) as unknown as FetchLike;
    expect((await checkForUpdate('0.2.3', ok))?.latest).toBe('0.2.4');
    const rateLimited = (async () => ({ ok: false, status: 403, json: async () => ({}) })) as unknown as FetchLike;
    expect(await checkForUpdate('0.2.3', rateLimited)).toBeNull();
    const offline = (async () => {
      throw new TypeError('fetch failed');
    }) as unknown as FetchLike;
    expect(await checkForUpdate('0.2.3', offline)).toBeNull();
  });
});
