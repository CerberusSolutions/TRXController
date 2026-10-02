/**
 * Docking a secondary window (the map, the System window) beside the main one: set against the side
 * that has room, as tall as the main window and square (as wide as it is tall) or as wide as the room
 * allows, re-placed as the main window moves or resizes, let go when dragged by hand. One instance per
 * window; the side is remembered in settings by the host.
 */
import { screen, type BrowserWindow, type Rectangle } from 'electron';
import type { MapDockSide } from '../shared/ipc';

export interface DockHost {
  main: () => BrowserWindow | null;
  win: () => BrowserWindow | null;
  /** The docked window's smallest useful size, and the main window's minimum (kept when the display is split). */
  minSize: { width: number; height: number };
  mainMin: { width: number; height: number };
  /** The side remembered in settings, null when the window floats free. */
  remembered: () => MapDockSide | null;
  remember: (side: MapDockSide | null) => void;
  /** A free window's placement is its own to remember (debounced by the host). */
  rememberFree: () => void;
  /** The IPC channel the window's renderer listens on for `{ docked }`. */
  stateChannel: string;
  /** The side another docked window already holds, so the two take opposite sides; null when none does. */
  taken?: () => MapDockSide | null;
}

export class WindowDock {
  docked: MapDockSide | null = null;
  private placing = false;

  constructor(private readonly host: DockHost) {}

  state(): { docked: MapDockSide | null } {
    return { docked: this.docked };
  }

  /**
   * Where the window goes on one side of the main window: the main window's height, and square (as wide as
   * it is tall) or as wide as the room allows, whichever is less, so an ultrawide display does not hand it
   * a mile. Null when the side has no room for the smallest useful window.
   */
  bounds(side: MapDockSide): Rectangle | null {
    const win = this.host.main();
    if (!win || win.isDestroyed()) return null;
    const main = win.getBounds();
    const area = screen.getDisplayMatching(main).workArea;
    const right = area.x + area.width - (main.x + main.width);
    const left = main.x - area.x;
    const room = side === 'right' ? right : left;
    if (room < this.host.minSize.width) return null;
    const width = Math.min(room, Math.max(this.host.minSize.width, main.height));
    return { x: side === 'right' ? main.x + main.width : main.x - width, y: main.y, width, height: main.height };
  }

  private place(b: Rectangle): void {
    const w = this.host.win();
    if (!w || w.isDestroyed()) return;
    this.placing = true;
    if (w.isMaximized()) w.unmaximize();
    w.setBounds(b);
    setTimeout(() => {
      this.placing = false;
    }, 300);
  }

  private set(side: MapDockSide | null): void {
    this.docked = side;
    this.host.remember(side);
    const w = this.host.win();
    if (w && !w.isDestroyed()) w.webContents.send(this.host.stateChannel, { docked: side });
  }

  /**
   * Dock beside the main window: the asked-for side when it has room, else the other, else the two windows
   * share the display, the main one keeping the larger part. 'auto' prefers the side used last time, then
   * the right. A side another docked window holds (the map and the System window) is avoided when the other
   * side has room, so the two sit either side of the main window instead of on top of each other.
   */
  dock(side: MapDockSide | 'auto'): void {
    const main = this.host.main();
    const w = this.host.win();
    if (!main || main.isDestroyed() || !w || w.isDestroyed()) return;
    const flip = (s: MapDockSide): MapDockSide => (s === 'right' ? 'left' : 'right');
    let prefer: MapDockSide = side === 'auto' ? (this.docked ?? this.host.remembered() ?? 'right') : side;
    const taken = this.host.taken?.() ?? null;
    if (taken === prefer && this.bounds(flip(prefer))) prefer = flip(prefer);
    const other = flip(prefer);
    let b = this.bounds(prefer);
    let got: MapDockSide = prefer;
    if (!b) {
      b = this.bounds(other);
      if (b) got = other;
    }
    if (!b) {
      // No room either side: split the display between the two, the main window keeping the rest.
      if (main.isMaximized()) main.unmaximize();
      const area = screen.getDisplayMatching(main.getBounds()).workArea;
      const sideW = Math.min(Math.max(this.host.minSize.width, area.height), area.width - this.host.mainMin.width);
      const mainW = area.width - sideW;
      got = prefer;
      if (got === 'left') {
        main.setBounds({ x: area.x + sideW, y: area.y, width: mainW, height: area.height });
        b = { x: area.x, y: area.y, width: sideW, height: area.height };
      } else {
        main.setBounds({ x: area.x, y: area.y, width: mainW, height: area.height });
        b = { x: area.x + mainW, y: area.y, width: sideW, height: area.height };
      }
    }
    this.place(b);
    this.set(got);
  }

  undock(): void {
    if (!this.docked) return;
    this.set(null);
    this.host.rememberFree();
  }

  /** The main window moved or resized: a docked window goes with it while its side still has room. */
  follow(): void {
    if (!this.docked) return;
    const b = this.bounds(this.docked);
    if (b) this.place(b);
  }

  /** The window itself moved or resized: by hand while docked it lets go; free, it remembers its place. */
  onMoved(): void {
    const w = this.host.win();
    if (!w || w.isDestroyed() || this.placing) return;
    if (this.docked) {
      const want = this.bounds(this.docked);
      const b = w.getBounds();
      if (!want || Math.abs(b.x - want.x) > 4 || Math.abs(b.y - want.y) > 4 || Math.abs(b.width - want.width) > 4 || Math.abs(b.height - want.height) > 4) this.undock();
      return;
    }
    this.host.rememberFree();
  }

  /** The window closed. */
  reset(): void {
    this.docked = null;
  }
}
