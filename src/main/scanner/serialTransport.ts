import { SerialPort } from 'serialport';
import { SERIAL_SETTINGS } from '@trxcontroller/rcip';
import type { PortInfo } from '../../shared/ipc';
import type { Transport, TransportFactory } from './transport';

export async function listPorts(): Promise<PortInfo[]> {
  const ports = await SerialPort.list();
  return ports.map((p) => ({
    path: p.path,
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
          path,
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
