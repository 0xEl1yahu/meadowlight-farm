/**
 * Generative ambient music, synthesised with the Web Audio API (no audio files).
 *
 * A soft pad holds the chord while a pentatonic melody wanders over it. Mood follows the
 * clock (morning, afternoon, evening, night), the key follows the season, and rain makes it
 * quieter. Browsers only allow audio after a user gesture, so it starts on the first key
 * press or click. M toggles it on and off (remembered per browser).
 */
import { Weather, type GameState, type Season } from '../core/types';

type Mood = 'morning' | 'afternoon' | 'evening' | 'night';

interface MoodSpec {
  /** Seconds between melody notes. */
  readonly step: number;
  /** Chance that a step plays a note. */
  readonly density: number;
  /** Octave offset of the melody. */
  readonly octave: number;
  readonly volume: number;
  readonly wave: OscillatorType;
}

const MOODS: Readonly<Record<Mood, MoodSpec>> = {
  morning: { step: 0.55, density: 0.7, octave: 1, volume: 0.9, wave: 'triangle' },
  afternoon: { step: 0.45, density: 0.8, octave: 1, volume: 1, wave: 'triangle' },
  evening: { step: 0.7, density: 0.55, octave: 0, volume: 0.8, wave: 'sine' },
  night: { step: 1.0, density: 0.4, octave: 0, volume: 0.6, wave: 'sine' },
};

/** Root note (MIDI) per season: Spring C, Summer D, Fall A, Winter F. */
const SEASON_ROOT: Readonly<Record<Season, number>> = { 0: 60, 1: 62, 2: 57, 3: 53 };
/** Major pentatonic scale degrees in semitones. */
const PENTATONIC = [0, 2, 4, 7, 9, 12, 14, 16] as const;
/** Chord progression as scale roots in semitones (I – vi – IV – V). */
const PROGRESSION = [0, 9, 5, 7] as const;
const BAR_SECONDS = 8;
const CROSSFADE_SECONDS = 8;
const MASTER_VOLUME = 0.16;
const STORAGE_KEY = 'meadowlight-farm.music';

function moodAt(minute: number): Mood {
  const hour = (minute / 60) % 24;
  if (hour >= 6 && hour < 12) return 'morning';
  if (hour >= 12 && hour < 17) return 'afternoon';
  if (hour >= 17 && hour < 21) return 'evening';
  return 'night';
}

function midiToHz(midi: number): number {
  return 440 * 2 ** ((midi - 69) / 12);
}

function readEnabled(): boolean {
  try {
    return window.localStorage.getItem(STORAGE_KEY) !== 'off';
  } catch {
    return true;
  }
}

function writeEnabled(on: boolean): void {
  try {
    window.localStorage.setItem(STORAGE_KEY, on ? 'on' : 'off');
  } catch {
    // Storage unavailable: the setting just lasts for this session.
  }
}

export class MusicPlayer {
  private audio: AudioContext | null = null;
  private master: GainNode | null = null;
  private reverb: DelayNode | null = null;
  private enabled = readEnabled();
  private nextNoteTime = 0;
  private nextBarTime = 0;
  private bar = 0;
  private melodyIndex = 3;
  private readonly abort = new AbortController();

  constructor() {
    const start = (): void => this.start();
    window.addEventListener('keydown', start, { signal: this.abort.signal });
    window.addEventListener('pointerdown', start, { signal: this.abort.signal });
    window.addEventListener(
      'keydown',
      (event) => {
        if (event.code !== 'KeyM' || event.repeat || event.ctrlKey || event.metaKey || event.altKey) return;
        const target = event.target;
        if (target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement) return;
        this.toggle();
      },
      { signal: this.abort.signal },
    );
  }

  get isEnabled(): boolean {
    return this.enabled;
  }

  toggle(): void {
    this.enabled = !this.enabled;
    writeEnabled(this.enabled);
    if (this.audio === null || this.master === null) return;
    const now = this.audio.currentTime;
    this.master.gain.cancelScheduledValues(now);
    this.master.gain.setTargetAtTime(this.enabled ? MASTER_VOLUME : 0, now, 0.4);
    if (this.enabled) this.resync();
  }

  /** Called once per frame with the current game state. */
  update(state: GameState, clockMinutes: number, frozen: boolean): void {
    const audio = this.audio;
    if (audio === null || this.master === null || !this.enabled) return;
    const target = frozen ? MASTER_VOLUME * 0.35 : state.weather === Weather.Sunny ? MASTER_VOLUME : MASTER_VOLUME * 0.55;
    this.master.gain.setTargetAtTime(target, audio.currentTime, CROSSFADE_SECONDS / 4);

    const mood = MOODS[moodAt(clockMinutes)];
    const root = SEASON_ROOT[state.time.season];
    const horizon = audio.currentTime + 0.3;
    while (this.nextBarTime < horizon) {
      this.playChord(root, this.nextBarTime, mood);
      this.nextBarTime += BAR_SECONDS;
      this.bar += 1;
    }
    while (this.nextNoteTime < horizon) {
      this.maybePlayNote(root, this.nextNoteTime, mood);
      this.nextNoteTime += mood.step;
    }
  }

  dispose(): void {
    this.abort.abort();
    void this.audio?.close();
    this.audio = null;
  }

  private start(): void {
    if (this.audio !== null) {
      if (this.audio.state === 'suspended') void this.audio.resume();
      return;
    }
    const Ctor = window.AudioContext;
    if (typeof Ctor !== 'function') return;
    const audio = new Ctor();
    const master = audio.createGain();
    master.gain.value = 0;
    master.connect(audio.destination);
    // A simple feedback delay gives the notes a soft, roomy tail.
    const delay = audio.createDelay(1);
    delay.delayTime.value = 0.38;
    const feedback = audio.createGain();
    feedback.gain.value = 0.35;
    const wet = audio.createGain();
    wet.gain.value = 0.4;
    delay.connect(feedback);
    feedback.connect(delay);
    delay.connect(wet);
    wet.connect(master);
    this.audio = audio;
    this.master = master;
    this.reverb = delay;
    if (this.enabled) master.gain.setTargetAtTime(MASTER_VOLUME, audio.currentTime, 1.5);
    this.resync();
  }

  private resync(): void {
    if (this.audio === null) return;
    const now = this.audio.currentTime + 0.1;
    this.nextNoteTime = now + 1;
    this.nextBarTime = now;
  }

  private playChord(root: number, time: number, mood: MoodSpec): void {
    const degree = PROGRESSION[this.bar % PROGRESSION.length] ?? 0;
    const minor = degree === 9;
    const base = root - 12 + degree;
    const notes = [base, base + (minor ? 3 : 4), base + 7];
    for (const midi of notes) this.voice(midiToHz(midi), time, BAR_SECONDS + 1.5, 0.05 * mood.volume, 'sine', 2.5);
  }

  private maybePlayNote(root: number, time: number, mood: MoodSpec): void {
    if (Math.random() > mood.density) return;
    const jump = Math.floor(Math.random() * 5) - 2;
    this.melodyIndex = Math.min(PENTATONIC.length - 1, Math.max(0, this.melodyIndex + jump));
    const midi = root + 12 * mood.octave + (PENTATONIC[this.melodyIndex] ?? 0);
    const length = mood.step * (Math.random() < 0.3 ? 3 : 1.6);
    this.voice(midiToHz(midi), time, length, 0.07 * mood.volume, mood.wave, 0.02);
  }

  private voice(hz: number, time: number, length: number, peak: number, wave: OscillatorType, attack: number): void {
    const audio = this.audio;
    const master = this.master;
    if (audio === null || master === null) return;
    const osc = audio.createOscillator();
    osc.type = wave;
    osc.frequency.value = hz;
    const gain = audio.createGain();
    gain.gain.setValueAtTime(0, time);
    gain.gain.linearRampToValueAtTime(peak, time + attack);
    gain.gain.exponentialRampToValueAtTime(0.0001, time + length);
    osc.connect(gain);
    gain.connect(master);
    if (this.reverb !== null) gain.connect(this.reverb);
    osc.start(time);
    osc.stop(time + length + 0.05);
  }
}
