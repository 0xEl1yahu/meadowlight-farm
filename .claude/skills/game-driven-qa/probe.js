// Meadowlight QA probe: installs window.__qa. Load it after every page load with
//   await import('/.claude/skills/game-driven-qa/probe.js?t=' + Date.now())
// Dev builds only (needs window.__meadowlight). Returns small JSON so a QA agent can read
// state without screenshots. Editing this file while the page has imported it makes Vite
// reload the page — finish edits before a run, or re-run setup after.
(() => {
  const h = window.__meadowlight;
  if (!h) return 'no __meadowlight handle: is this a dev build (npm run dev)?';
  const A = h.actions;
  const S = () => h.store.getState();
  const hhmm = (m) => `${String(Math.floor(m / 60) % 24).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
  const robot = (r) => ({
    id: r.id, name: r.name, size: r.size, at: [r.tx, r.tz], facing: r.facing, power: r.power,
    tokens: r.tokens, pc: r.pc, next: r.nextActMinute, carried: r.carried, bag: r.bag?.length,
    last: r.lastAction ? `${r.lastAction.kind}${r.lastAction.ok === false ? ' ✗' : ''}${r.lastAction.bickered ? ' bicker' : ''}` : null,
  });
  const qa = {
    /** One-line picture of the game: clock, player, robots, recent toasts. */
    snap(nMsgs = 3) {
      const s = S();
      return {
        day: s.time.absoluteDay, time: hhmm(s.time.minuteOfDay), map: s.player.mapId,
        player: { at: [s.player.tx, s.player.tz], facing: s.player.facing, energy: s.player.energy, gold: s.player.gold, carrying: s.player.carrying },
        held: s.inventory?.slots?.[s.inventory.selected]?.itemId ?? null,
        pool: s.robots.pool, fuel: s.robots.lastNightFuel,
        robots: s.robots.list.map(robot),
        toasts: s.messages.entries.slice(-nMsgs).map((m) => `[${m.tone}] ${m.text}`),
        panel: s.ui.panel.kind, paused: s.ui.paused, speed: s.ui.timeScale,
      };
    },
    /**
     * The tile at a coordinate, via the game's own getTile (Vite serves source modules in dev,
     * so the page can import them). Farm by default. Directions: 0 N, 1 E, 2 S, 3 W.
     */
    async tile(tx, tz, mapId = S().player.mapId) {
      const { getTile } = await import('/src/world/tiles.ts');
      return getTile(S().maps[mapId], tx, tz);
    },
    /** Tile one step ahead of the player (what E / Space act on). */
    async ahead() {
      const { stepTile } = await import('/src/world/grid.ts');
      const p = S().player; const t = stepTile({ tx: p.tx, tz: p.tz }, p.facing);
      return { at: [t.tx, t.tz], tile: await qa.tile(t.tx, t.tz) };
    },
    /** Import any game module for its pure helpers, e.g. qa.mod('/src/robots/logText.ts'). */
    mod(path) { return import(path); },
    /** Farm log, newest last, as raw entries. */
    log(n = 8) { return S().robots.log.entries.slice(-n); },
    /**
     * Farm log as readable lines: "06:39 Tweedle @5,11 | says … | happened … ×1". Use this, not
     * robotLog(): console.table output reads back as "{0: Object, …}" through console tools.
     */
    async logText(n = 12, robotName = null) {
      const L = await import('/src/robots/logText.ts');
      const s = S(); const names = new Map(s.robots.list.map((r) => [r.id, r.name]));
      return s.robots.log.entries
        .filter((e) => robotName === null || names.get(e.robotId) === robotName)
        .slice(-n)
        .map((e) => `d${e.day} ${hhmm(e.minute)} ${names.get(e.robotId)} @${e.tx},${e.tz} | says: ${L.robotSays(e)} | happened: ${L.whatHappened(e, names)} ×${e.count}`);
    },
    /** A robot by name (the most recently added one if several share it). */
    robot(name) { return [...S().robots.list].reverse().find((r) => r.name === name) ?? null; },
    /**
     * The test fixtures (tests/testUtils.ts: withTile, soilTile, matureCrop, withPlayer, stack,
     * withSlots, …) run in the page too. Build a state with them, then qa.load(state).
     */
    fixtures() { return Promise.all([import('/tests/testUtils.ts'), import('/src/core/types.ts')]).then(([U, T]) => ({ ...U, T })); },
    load(state) { h.store.dispatch(A.load(state)); return qa.snap(1); },
    state: S,
    /** Advance the simulation deterministically, bypassing real time. */
    tick(minutes) { h.store.dispatch(A.tick(minutes)); return qa.snap(); },
    sleep() { h.store.dispatch(A.sleep()); return qa.snap(5); },
    move(direction, steps = 1) { for (let i = 0; i < steps; i++) h.store.dispatch(A.move(direction)); return qa.snap(1); },
    face(direction) { h.store.dispatch(A.face(direction)); return qa.snap(1); },
    interact() { h.store.dispatch(A.interact()); return qa.snap(2); },
    useTool() { h.store.dispatch(A.useTool()); return qa.snap(2); },
    select(slot) { h.store.dispatch(A.selectSlot(slot)); return qa.snap(0); },
    /** Real keyboard path: fires keydown/keyup on window, exactly as the InputController hears it. */
    async key(code, holdMs = 60, opts = {}) {
      window.dispatchEvent(new KeyboardEvent('keydown', { code, key: code, bubbles: true, ...opts }));
      await new Promise((r) => setTimeout(r, holdMs));
      window.dispatchEvent(new KeyboardEvent('keyup', { code, key: code, bubbles: true, ...opts }));
      await new Promise((r) => setTimeout(r, 50));
      return qa.snap(2);
    },
    /**
     * Walk to a tile with real key taps (one 120 ms tap = one tile), greedy on the longer axis,
     * sidestepping when blocked. Returns the path taken; stops after maxTaps or when stuck.
     * Finish with qa.key('ShiftLeft'...) or qa.face(dir) to face the target you want to act on.
     */
    async walkTo(tx, tz, maxTaps = 200) {
      const keyFor = { N: 'KeyW', E: 'KeyD', S: 'KeyS', W: 'KeyA' };
      const path = [];
      let stuck = 0;
      for (let i = 0; i < maxTaps; i++) {
        const p = S().player;
        const dx = tx - p.tx, dz = tz - p.tz;
        if (dx === 0 && dz === 0) return { arrived: true, at: [p.tx, p.tz], taps: i };
        const xDir = dx > 0 ? 'E' : 'W', zDir = dz > 0 ? 'S' : 'N';
        const primary = Math.abs(dx) >= Math.abs(dz) ? xDir : zDir;
        const secondary = primary === xDir ? (dz !== 0 ? zDir : (stuck % 2 ? 'N' : 'S')) : (dx !== 0 ? xDir : (stuck % 2 ? 'W' : 'E'));
        const dir = stuck > 0 ? secondary : primary;
        await qa.key(keyFor[dir], 120);
        const q = S().player;
        const moved = q.tx !== p.tx || q.tz !== p.tz;
        path.push(dir + (moved ? '' : '✗'));
        stuck = moved ? Math.max(0, stuck - 1) : stuck + 1;
        if (stuck > 6) return { arrived: false, at: [q.tx, q.tz], stuckAfter: path.slice(-8) };
      }
      const p = S().player;
      return { arrived: p.tx === tx && p.tz === tz, at: [p.tx, p.tz], taps: maxTaps };
    },
    /**
     * Turn in place (Shift + direction), the real-keyboard way. 0 N, 1 E, 2 S, 3 W. Shift is
     * released at the end, so the HUD hint stops showing Shift's intent (e.g. "Look at {name}").
     */
    async turn(direction) {
      const code = ['KeyW', 'KeyD', 'KeyS', 'KeyA'][direction];
      return qa.shift(code);
    },
    /**
     * Shift + a key, the real-keyboard way: Shift goes down first and up last, so both the
     * InputController's shiftHeld and the key's event.shiftKey see it. Shift + E peeks at a robot
     * (or clears the marker's zone); Shift + Space cycles the zone marker's letter.
     */
    async shift(code, holdMs = 60) {
      window.dispatchEvent(new KeyboardEvent('keydown', { code: 'ShiftLeft', key: 'Shift', shiftKey: true, bubbles: true }));
      await qa.key(code, holdMs, { shiftKey: true });
      window.dispatchEvent(new KeyboardEvent('keyup', { code: 'ShiftLeft', key: 'Shift', bubbles: true }));
      await new Promise((r) => setTimeout(r, 50));
      return qa.snap(2);
    },
    /** Deep equality that ignores key order, e.g. a saved program against the one that was loaded. */
    same(a, b) {
      const canon = (v) => (Array.isArray(v) ? v.map(canon) : v !== null && typeof v === 'object' ? Object.fromEntries(Object.keys(v).sort().map((k) => [k, canon(v[k])])) : v);
      return JSON.stringify(canon(a)) === JSON.stringify(canon(b));
    },
    /**
     * Setup only: puts the robot called `name` on the workbench (6,4) and stands the player on
     * (6,5) facing it, so qa.key('KeyE') ("Work on {name}") opens its screen. Use it when carrying
     * the robot there isn't what's being checked.
     */
    bench(name) {
      return qa.patch((s) => {
        const r = [...s.robots.list].reverse().find((x) => x.name === name);
        Object.assign(r, { onBench: true, carried: false, tx: 6, tz: 4 });
        Object.assign(s.player, { tx: 6, tz: 5, facing: 0, carrying: s.player.carrying === r.id ? null : s.player.carrying });
      });
    },
    /** Frames per second over a short window, from requestAnimationFrame. */
    async fps(ms = 2000) {
      let n = 0; const t0 = performance.now();
      await new Promise((done) => { const f = () => { n++; performance.now() - t0 < ms ? requestAnimationFrame(f) : done(); }; requestAnimationFrame(f); });
      return Math.round((n * 1000) / (performance.now() - t0));
    },
    /** Mutate state for setup only (e.g. give items), then load it. Never use to fake a result under test. */
    patch(fn) { const next = structuredClone(S()); fn(next); h.store.dispatch(A.load(next)); return qa.snap(1); },
  };
  window.__qa = qa;
  return qa.snap();
})();
