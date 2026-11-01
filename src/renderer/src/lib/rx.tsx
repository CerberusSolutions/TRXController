import { createContext, useContext } from 'react';

/**
 * Which receiver a component shows: 0 (RX1, the default, so a single-scanner window needs no provider) or 1 (RX2).
 * `ReceiverBlock` provides it for everything in a receiver's column; the hero, display, keypad and the Data dialog's
 * clock lines read the matching `rxView` from the scanner store.
 */
export const RxContext = createContext(0);

export function useRx(): number {
  return useContext(RxContext);
}
