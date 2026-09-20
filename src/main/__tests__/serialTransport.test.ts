import { describe, expect, it } from 'vitest';
import { isBuiltInPort, preferredPath } from '../scanner/serialTransport';

describe('serial port names', () => {
  it("hides the Mac's own ports and nothing else", () => {
    expect(isBuiltInPort('/dev/tty.debug-console', 'darwin')).toBe(true);
    expect(isBuiltInPort('/dev/cu.wlan-debug', 'darwin')).toBe(true);
    expect(isBuiltInPort('/dev/tty.Bluetooth-Incoming-Port', 'darwin')).toBe(true);
    expect(isBuiltInPort('/dev/tty.usbmodem14201', 'darwin')).toBe(false);
    expect(isBuiltInPort('/dev/tty.usbserial-0001', 'darwin')).toBe(false);
    // The same names mean nothing off a Mac, so they are left alone there.
    expect(isBuiltInPort('/dev/tty.debug-console', 'linux')).toBe(false);
    expect(isBuiltInPort('COM7', 'win32')).toBe(false);
  });

  it('opens the call-out device on a Mac and leaves other platforms alone', () => {
    expect(preferredPath('/dev/tty.usbmodem14201', 'darwin')).toBe('/dev/cu.usbmodem14201');
    expect(preferredPath('/dev/cu.usbmodem14201', 'darwin')).toBe('/dev/cu.usbmodem14201');
    expect(preferredPath('/dev/ttyUSB0', 'linux')).toBe('/dev/ttyUSB0');
    expect(preferredPath('/dev/ttyACM0', 'linux')).toBe('/dev/ttyACM0');
    expect(preferredPath('COM7', 'win32')).toBe('COM7');
  });
});
