/**
 * Composition root: wires the deterministic store to the render systems, input and HUD, and
 * runs the frame loop.
 *
 * Frame order
 *   1. input.update       – held-key movement pacing (dispatches player actions)
 *   2. fixed-step clock   – converts scaled real time into whole game minutes (time/tick)
 *   3. player.update      – lerps the character; the camera then follows it
 *   4. other systems      – lighting, weather, crops, placed objects, effects… (animation only)
 *   5. hud.update, render
 *
 * State changes reach render systems through `sync(state, prev)` from the store subscription,
 * never through polling, so the per-frame cost of an idle farm is animation only.
 */
import { MusicPlayer } from './audio/music';
import './style.css';
import { TIME } from './config';
import { FixedStepClock } from './core/loop';
import { createStore, type Store } from './core/store';
import type { GameState } from './core/types';
import { InputController } from './input/InputController';
import { CropRenderer } from './render/CropRenderer';
import { EffectsRenderer } from './render/EffectsRenderer';
import { LightingManager } from './render/LightingManager';
import { updateSharedUniforms } from './render/materials';
import { ObjectRenderer } from './render/ObjectRenderer';
import { PlayerRenderer } from './render/PlayerRenderer';
import { SceneContext } from './render/SceneContext';
import { StructureRenderer } from './render/StructureRenderer';
import { classifySync } from './render/syncPolicy';
import { TerrainRenderer } from './render/TerrainRenderer';
import { TileHighlighter } from './render/TileHighlighter';
import type { FrameContext, RenderSystem } from './render/types';
import { WeatherRenderer } from './render/WeatherRenderer';
import { actions, type GameAction } from './state/actions';
import { createInitialState } from './state/initialState';
import { clearSave, loadGame, saveGame } from './state/persistence';
import { gameReducer } from './state/reducer';
import { Hud } from './ui/Hud';
import { selectActiveWorld, selectIsFrozen } from './state/selectors';

declare global {
  interface Window {
    /** Present only in development builds. */
    __meadowlight?: {
      readonly store: Store<GameState, GameAction>;
      readonly ctx: SceneContext;
      readonly systems: readonly RenderSystem[];
      readonly actions: typeof actions;
    };
  }
}

function showFatalError(error: unknown): void {
  const message = error instanceof Error ? error.message : String(error);
  const panel = document.createElement('div');
  panel.className = 'fatal-error';
  const title = document.createElement('h1');
  title.textContent = 'The farm could not start';
  const detail = document.createElement('p');
  detail.textContent = message;
  panel.append(title, detail);
  document.body.append(panel);
}

function bootstrap(): () => void {
  const container = document.getElementById('app');
  const hudRoot = document.getElementById('hud');
  if (container === null || hudRoot === null) throw new Error('index.html must contain #app and #hud');

  if (new URLSearchParams(window.location.search).has('new')) clearSave();
  const initial = loadGame() ?? createInitialState();
  const store = createStore<GameState, GameAction>(gameReducer, initial, { freeze: import.meta.env.DEV });

  const ctx = new SceneContext(container, selectActiveWorld(initial).grid);
  const player = new PlayerRenderer(ctx);
  const music = new MusicPlayer();
  const systems: readonly RenderSystem[] = [
    player,
    new LightingManager(ctx),
    new TerrainRenderer(ctx),
    new StructureRenderer(ctx),
    new CropRenderer(ctx),
    new ObjectRenderer(ctx),
    new TileHighlighter(ctx),
    new WeatherRenderer(ctx),
    new EffectsRenderer(ctx),
  ];

  const startNewGame = (): void => {
    clearSave();
    store.dispatch(actions.load(createInitialState()));
    saveGame(store.getState());
  };

  const hud = new Hud({
    root: hudRoot,
    store,
    onNewGame: startNewGame,
    getRenderStats: () => ({
      calls: ctx.renderer.info.render.calls,
      triangles: ctx.renderer.info.render.triangles,
    }),
  });
  const input = new InputController({ target: window, canvas: ctx.renderer.domElement, store, rig: ctx.rig });

  for (const system of systems) system.sync(initial, null);
  hud.sync(initial, null);
  ctx.rig.snap(player.focus);

  const simClock = new FixedStepClock(TIME.realSecondsPerGameMinute, TIME.maxTickMinutes);

  const unsubscribe = store.subscribe((state, prev, action) => {
    // A load or a map change rebuilds every render system on the new map's grid; the HUD keeps
    // prev across a map change (toasts, day wipe, gold tween). See render/syncPolicy.ts.
    const plan = classifySync(state, prev, action);
    if (plan.setGrid) ctx.setActiveGrid(selectActiveWorld(state).grid);
    const systemsPrev = plan.systemsPrev === 'null' ? null : prev;
    for (const system of systems) system.sync(state, systemsPrev);
    hud.sync(state, plan.hudPrev === 'null' ? null : prev);
    if (plan.snapCamera) ctx.rig.snap(player.focus);
    const newDay = state.time.absoluteDay !== prev.time.absoluteDay;
    if (action.type === 'game/load' || newDay) simClock.reset();
    if (newDay) saveGame(state);
  });

  if (import.meta.env.DEV) {
    // Development-only debugging handle (stripped from production builds).
    window.__meadowlight = { store, ctx, systems, actions };
  }

  const saveOnHide = (): void => {
    saveGame(store.getState());
  };
  window.addEventListener('pagehide', saveOnHide);

  let rafId = 0;
  let last = performance.now();
  let elapsed = 0;

  const frame = (now: number): void => {
    rafId = requestAnimationFrame(frame);
    const dt = Math.min(0.1, Math.max(0, (now - last) / 1000));
    last = now;
    elapsed += dt;

    input.update(dt);

    const before = store.getState();
    const running = !selectIsFrozen(before);
    const minutes = simClock.advance(running ? dt * before.ui.timeScale : 0);
    if (minutes > 0) store.dispatch(actions.tick(minutes));

    const state = store.getState();
    const frameContext: FrameContext = {
      dt,
      elapsed,
      state,
      clockMinutes: Math.min(TIME.passOutMinute, state.time.minuteOfDay + simClock.fraction),
    };

    updateSharedUniforms(elapsed, dt, state.weather);
    player.update(frameContext);
    ctx.rig.follow(player.focus);
    ctx.rig.update(dt);
    for (const system of systems) {
      if (system !== player) system.update(frameContext);
    }
    hud.update(frameContext);
    music.update(state, frameContext.clockMinutes, selectIsFrozen(state));
    ctx.render();
  };
  rafId = requestAnimationFrame(frame);

  return () => {
    music.dispose();
    cancelAnimationFrame(rafId);
    window.removeEventListener('pagehide', saveOnHide);
    unsubscribe();
    input.dispose();
    hud.dispose();
    for (const system of systems) system.dispose();
    ctx.dispose();
  };
}

let dispose: (() => void) | null = null;
try {
  dispose = bootstrap();
} catch (error) {
  console.error(error);
  showFatalError(error);
}

if (import.meta.hot) {
  import.meta.hot.dispose(() => {
    dispose?.();
    dispose = null;
  });
}
