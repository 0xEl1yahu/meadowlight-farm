/**
 * Right-click gate (spec §7.4, src/ui/rightClickGate.ts): each right click acts exactly once. The
 * right click (or macOS Ctrl + click) on the canvas that opens a chest must not also act on the
 * chest screen through the `contextmenu` the browser fires for the same gesture. The screen arms
 * the gate on a pointerdown or keydown it receives and resets it whenever it opens, switches panel
 * or closes; each case below replays the event order a browser produces.
 */
import { describe, expect, it } from 'vitest';
import { RightClickGate } from '../src/ui/rightClickGate';

/** A gate for a screen that has just been opened. */
function opened(): RightClickGate {
  const gate = new RightClickGate();
  gate.reset();
  return gate;
}

describe('RightClickGate', () => {
  it('ignores the contextmenu of the canvas right click that opened the screen (macOS / Linux order)', () => {
    // Canvas pointerdown interacts; the synchronous sync opens the screen; contextmenu follows.
    const gate = opened();
    expect(gate.accept()).toBe(false);
  });

  it('ignores the contextmenu of the opening gesture when it arrives after pointerup (Windows order)', () => {
    // pointerup lands on the screen but does not arm it; only pointerdown and keydown do.
    const gate = opened();
    expect(gate.accept()).toBe(false);
  });

  it('forgets a gesture that began before the screen opened or switched panel', () => {
    const gate = new RightClickGate();
    gate.gestureBegan();
    gate.reset();
    expect(gate.accept()).toBe(false);
  });

  it('forgets a gesture when the screen closes', () => {
    const gate = opened();
    gate.gestureBegan();
    gate.reset();
    expect(gate.accept()).toBe(false);
  });

  it('acts on a right click that began on the screen, before or after pointerup', () => {
    const gate = opened();
    gate.gestureBegan();
    expect(gate.accept()).toBe(true);
    gate.gestureBegan();
    expect(gate.accept()).toBe(true);
  });

  it('acts on a keyboard contextmenu from a focused slot (its keydown arms the gate)', () => {
    const gate = opened();
    gate.gestureBegan();
    expect(gate.accept()).toBe(true);
  });

  it('acts at most once per arming', () => {
    const gate = opened();
    gate.gestureBegan();
    gate.gestureBegan();
    expect(gate.accept()).toBe(true);
    expect(gate.accept()).toBe(false);
  });

  it('acts again on the next right click after ignoring the opening one', () => {
    const gate = opened();
    expect(gate.accept()).toBe(false);
    gate.gestureBegan();
    expect(gate.accept()).toBe(true);
  });
});
