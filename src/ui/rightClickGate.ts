/**
 * Which `contextmenu` events the inventory screen acts on, kept free of the DOM so it can be
 * tested (spec §7.4: each right click acts exactly once).
 *
 * A right click on the canvas interacts on `pointerdown`. When that opens a chest, the store
 * notifies synchronously, so the screen is already shown when the browser fires `contextmenu` for
 * the same gesture (after mousedown on macOS and Linux, after mouseup on Windows) and hit-tests it
 * onto a slot. Ctrl + click on macOS behaves the same way. So a `contextmenu` only acts when the
 * gesture that produced it began on the screen:
 *
 *   pointerdown or keydown on the screen   arms the gate (acts on nothing by itself)
 *   contextmenu                            acts only when armed, and disarms
 *   screen opens, switches panel, closes   disarms
 *
 * A keyboard `contextmenu` (Menu key, Shift + F10) targets the focused slot, so its keydown has
 * already bubbled through the screen. Arming on both keeps the rule independent of how a browser
 * reports the event's origin (a macOS Ctrl + click can look like a button-0 MouseEvent).
 */
export class RightClickGate {
  private armed = false;

  /** The screen opened, switched panel or closed: a gesture that started before now is foreign. */
  reset(): void {
    this.armed = false;
  }

  /** A pointer went down or a key was pressed on the screen: its `contextmenu` may act. */
  gestureBegan(): void {
    this.armed = true;
  }

  /** True when a `contextmenu` should act on a slot; each arming lets at most one through. */
  accept(): boolean {
    const armed = this.armed;
    this.armed = false;
    return armed;
  }
}
