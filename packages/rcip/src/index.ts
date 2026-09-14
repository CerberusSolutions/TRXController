export * from './frame';
export * from './tables';
export * from './keys';
export * from './status';
export * from './lcd';
export * from './activeChannel';
export * from './version';
export * from './power';
export * from './commands';
export * from './response';

/** Serial settings from the spec. */
export const SERIAL_SETTINGS = {
  baudRate: 115200,
  dataBits: 8,
  parity: 'none',
  stopBits: 1,
} as const;
