import type { TrxApi } from './index';

declare global {
  interface Window {
    trx: TrxApi;
  }
}

export {};
