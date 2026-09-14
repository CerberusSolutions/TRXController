/**
 * Types shared between main, preload and renderer. Pure types plus channel
 * names; no runtime dependencies on Node or Electron.
 */
import type { ActiveChannel, Lcd, Status, Version } from '@trxcontroller/rcip';

export type LinkStatus = 'disconnected' | 'connecting' | 'connected' | 'unresponsive' | 'error';

export interface PortInfo {
  path: string;
  manufacturer?: string;
  friendlyName?: string;
  vendorId?: string;
  productId?: string;
  serialNumber?: string;
}

export interface LinkStats {
  requests: number;
  responses: number;
  timeouts: number;
  frameErrors: number;
  consecutiveTimeouts: number;
  /** Round-trip of the last successful request, ms. */
  lastRttMs: number | null;
}

export interface ScannerSnapshot {
  link: {
    status: LinkStatus;
    port: string | null;
    error: string | null;
  };
  version: Version | null;
  status: Status | null;
  lcd: Lcd | null;
  active: ActiveChannel | null;
  stats: LinkStats;
  /** Wall-clock time (ms since epoch) of the last update. */
  updatedAt: number;
}

export const IPC = {
  listPorts: 'scanner:list-ports',
  connect: 'scanner:connect',
  disconnect: 'scanner:disconnect',
  sendKey: 'scanner:send-key',
  getSnapshot: 'scanner:get-snapshot',
  snapshot: 'scanner:snapshot',
  ccdump: 'scanner:ccdump',
} as const;
