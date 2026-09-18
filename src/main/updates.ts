/**
 * "Is there a newer release?" via GitHub's public releases API. Notification
 * only: the user downloads and runs the installer themselves (the exe is
 * unsigned, so a silent auto-update would be worse, not better).
 */
import type { UpdateInfo } from '../shared/ipc';

export const RELEASES_API = 'https://api.github.com/repos/CerberusSolutions/TRXController/releases/latest';
export const RELEASES_PAGE = 'https://github.com/CerberusSolutions/TRXController/releases';
const FETCH_TIMEOUT_MS = 8000;

/** "v0.2.3" or "0.2.3" -> [0, 2, 3]; null if it is not a dotted number. */
export function parseVersion(text: string): number[] | null {
  const m = /^v?(\d+(?:\.\d+)*)/.exec(text.trim());
  return m ? m[1]!.split('.').map(Number) : null;
}

/** Positive when a is newer than b, zero when equal, negative when older. */
export function compareVersions(a: string, b: string): number {
  const pa = parseVersion(a) ?? [];
  const pb = parseVersion(b) ?? [];
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const d = (pa[i] ?? 0) - (pb[i] ?? 0);
    if (d !== 0) return d;
  }
  return 0;
}

interface ReleaseJson {
  tag_name?: unknown;
  name?: unknown;
  html_url?: unknown;
  published_at?: unknown;
  draft?: unknown;
  prerelease?: unknown;
  assets?: unknown;
}

/**
 * Turn the /releases/latest JSON into an UpdateInfo, or null if it is not a usable release.
 * The download link is the installer for this platform: the .exe on Windows, the .dmg on macOS,
 * the AppImage for this architecture on Linux.
 */
export function readRelease(json: unknown, current: string, checkedAt = Date.now(), platform: string = process.platform, arch: string = process.arch): UpdateInfo | null {
  const r = json as ReleaseJson;
  if (!r || typeof r.tag_name !== 'string' || !parseVersion(r.tag_name)) return null;
  if (r.draft === true) return null;
  const assets = Array.isArray(r.assets) ? (r.assets as { name?: unknown; browser_download_url?: unknown }[]) : [];
  // electron-builder names the Linux x64 AppImage "x86_64" (and the .deb "amd64"); arm64 stays arm64.
  const want = platform === 'darwin' ? /\.dmg$/i : platform === 'linux' ? new RegExp(`linux-${arch === 'x64' ? 'x86_64' : arch}\\.AppImage$`, 'i') : /\.exe$/i;
  const exe = assets.find((a) => typeof a.name === 'string' && want.test(a.name));
  const latest = r.tag_name.replace(/^v/, '');
  return {
    current,
    latest,
    newer: compareVersions(latest, current) > 0,
    url: typeof r.html_url === 'string' ? r.html_url : RELEASES_PAGE,
    downloadUrl: exe && typeof exe.browser_download_url === 'string' ? exe.browser_download_url : null,
    publishedAt: typeof r.published_at === 'string' ? Date.parse(r.published_at) || null : null,
    checkedAt,
  };
}

/** What both Node's fetch and Electron's net.fetch provide. */
export type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

/** Ask GitHub for the latest release. Resolves null (never throws) when offline or rate-limited. */
export async function checkForUpdate(current: string, fetchImpl: FetchLike = fetch): Promise<UpdateInfo | null> {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await fetchImpl(RELEASES_API, {
      signal: ctl.signal,
      headers: { Accept: 'application/vnd.github+json', 'User-Agent': `TRXController/${current}` },
    });
    if (!res.ok) return null;
    return readRelease(await res.json(), current);
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}
