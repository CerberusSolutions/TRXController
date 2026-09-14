/** Decoded `P` (Power Status) response. */
export interface PowerStatus {
  on: boolean;
  raw: number;
}

export function parsePower(data: Uint8Array): PowerStatus {
  if (data.length !== 1) throw new Error(`Power data must be 1 byte, got ${data.length}`);
  return { on: data[0] === 1, raw: data[0]! };
}
