/** Byte-stream transport abstraction so the link can be tested without serialport. */
export interface Transport {
  write(bytes: Uint8Array): Promise<void>;
  onData(cb: (bytes: Uint8Array) => void): void;
  onError(cb: (err: Error) => void): void;
  onClose(cb: () => void): void;
  close(): Promise<void>;
}

export interface TransportFactory {
  open(path: string): Promise<Transport>;
}
