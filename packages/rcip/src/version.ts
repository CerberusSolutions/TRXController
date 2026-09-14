export interface VersionNumber {
  major: number;
  minor: number;
  raw: number;
  text: string;
}

/** Decoded `V` (Version Request) response. */
export interface Version {
  /** Model string with trailing spaces removed, e.g. "TRX-1". */
  model: string;
  /** Raw 8-character model field. */
  modelRaw: string;
  boot: VersionNumber;
  cpu: VersionNumber;
  dsp1: VersionNumber;
  dsp2: VersionNumber;
}

export const VERSION_DATA_LENGTH = 13;

export function versionNumber(b: number): VersionNumber {
  const major = (b >> 4) & 0x0f;
  const minor = b & 0x0f;
  return { major, minor, raw: b, text: `${major}.${minor}` };
}

export function parseVersion(data: Uint8Array): Version {
  if (data.length !== VERSION_DATA_LENGTH) {
    throw new Error(`Version data must be ${VERSION_DATA_LENGTH} bytes, got ${data.length}`);
  }
  // data[0] is the 0x00 echoed from the command.
  let modelRaw = '';
  for (let i = 1; i <= 8; i++) modelRaw += String.fromCharCode(data[i]!);
  return {
    model: modelRaw.replace(/\0/g, '').trim(),
    modelRaw,
    boot: versionNumber(data[9]!),
    cpu: versionNumber(data[10]!),
    dsp1: versionNumber(data[11]!),
    dsp2: versionNumber(data[12]!),
  };
}
