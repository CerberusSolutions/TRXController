import { SerialPort } from 'serialport';
import { SERIAL_SETTINGS } from '@trxcontroller/rcip';
import type { PortInfo } from '../../shared/ipc';
import type { Transport, TransportFactory } from './transport';

/** Ports every Mac has and none of which is ever a scanner: the debug console, the Wi-Fi debug port, Bluetooth. */
const MAC_BUILT_IN = /\/(?:tty|cu)\.(?:debug-console|wlan-debug|Bluetooth-.*)$/i;

export function isBuiltInPort(path: string, platform: NodeJS.Platform = process.platform): boolean {
  return platform === 'darwin' && MAC_BUILT_IN.test(path);
}

/**
 * On macOS every serial device has two names: `/dev/tty.X`, which waits for carrier detect on open,
 * and `/dev/cu.X`, the call-out side meant for outgoing connections. The library lists the tty
 * names; the app lists, remembers and opens the cu one. Elsewhere the path is returned as is.
 */
export function preferredPath(path: string, platform: NodeJS.Platform = process.platform): string {
  return platform === 'darwin' ? path.replace(/^\/dev\/tty\./, '/dev/cu.') : path;
}

export async function listPorts(): Promise<PortInfo[]> {
  const ports = await SerialPort.list();
  return ports.filter((p) => !isBuiltInPort(p.path)).map((p) => ({
    path: preferredPath(p.path),
    manufacturer: p.manufacturer,
    friendlyName: (p as { friendlyName?: string }).friendlyName,
    vendorId: p.vendorId,
    productId: p.productId,
    serialNumber: p.serialNumber,
  }));
}

/** Whistler TRX USB VID:PID as seen on the TRX-1E. */
export const WHISTLER_VID = '2A59';

export function looksLikeScanner(p: PortInfo): boolean {
  return (p.vendorId ?? '').toUpperCase() === WHISTLER_VID;
}

class SerialTransport implements Transport {
  constructor(private readonly port: SerialPort) {}

  write(bytes: Uint8Array): Promise<void> {
    return new Promise((resolve, reject) => {
      this.port.write(Buffer.from(bytes), (err) => {
        if (err) return reject(err);
        this.port.drain((err2) => (err2 ? reject(err2) : resolve()));
      });
    });
  }

  onData(cb: (bytes: Uint8Array) => void): void {
    this.port.on('data', (d: Buffer) => cb(new Uint8Array(d.buffer, d.byteOffset, d.byteLength)));
  }

  onError(cb: (err: Error) => void): void {
    this.port.on('error', cb);
  }

  onClose(cb: () => void): void {
    this.port.on('close', cb);
  }

  close(): Promise<void> {
    return new Promise((resolve) => {
      if (!this.port.isOpen) return resolve();
      this.port.close(() => resolve());
    });
  }
}

export const serialTransportFactory: TransportFactory = {
  open(path: string): Promise<Transport> {
    return new Promise((resolve, reject) => {
      const port = new SerialPort(
        {
          path: preferredPath(path),
          baudRate: SERIAL_SETTINGS.baudRate,
          dataBits: SERIAL_SETTINGS.dataBits,
          stopBits: SERIAL_SETTINGS.stopBits,
          parity: SERIAL_SETTINGS.parity,
          autoOpen: false,
        },
        undefined,
      );
      port.open((err) => (err ? reject(err) : resolve(new SerialTransport(port))));
    });
  },
};
