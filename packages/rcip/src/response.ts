import { parseActiveChannel, type ActiveChannel, type RecordingHeaderOptions } from './activeChannel';
import { Code } from './commands';
import type { Frame } from './frame';
import { parseLcd, type Lcd } from './lcd';
import { parsePower, type PowerStatus } from './power';
import { parseStatus, type Status } from './status';
import { parseVersion, type Version } from './version';

export type ParsedResponse =
  | { code: 'A'; status: Status; frame: Frame }
  | { code: 'L'; lcd: Lcd; frame: Frame }
  | { code: 'a'; activeChannel: ActiveChannel; frame: Frame }
  | { code: 'P'; power: PowerStatus; frame: Frame }
  | { code: 'V'; version: Version; frame: Frame }
  | { code: string; unknown: true; frame: Frame };

/** Dispatch a decoded frame to the matching parser. */
export function parseResponse(frame: Frame, opts: RecordingHeaderOptions = {}): ParsedResponse {
  switch (frame.codeChar) {
    case Code.STATUS:
      return { code: 'A', status: parseStatus(frame.data), frame };
    case Code.LCD:
      return { code: 'L', lcd: parseLcd(frame.data), frame };
    case Code.ACTIVE_CHANNEL:
      return { code: 'a', activeChannel: parseActiveChannel(frame.data, opts), frame };
    case Code.POWER:
      return { code: 'P', power: parsePower(frame.data), frame };
    case Code.VERSION:
      return { code: 'V', version: parseVersion(frame.data), frame };
    default:
      return { code: frame.codeChar, unknown: true, frame };
  }
}
