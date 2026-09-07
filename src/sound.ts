/**
 * All game audio, synthesised with Web Audio — no files ship.
 *
 * The context is created lazily on a user gesture, because browsers refuse to
 * start audio otherwise, and every call is wrapped so a missing or broken
 * audio stack can never break the game.
 */

const MUTE_KEY = 'ds:muted';

let ctx: AudioContext | null = null;
let master: GainNode | null = null;
let failed = false;
let muted = readMuted();
/** Which seat is the local player, so the opponent can be given another voice. */
let localSeat: 'p1' | 'p2' | null = null;

function readMuted(): boolean {
  try {
    return localStorage.getItem(MUTE_KEY) === '1';
  } catch {
    return false;
  }
}

function context(): AudioContext | null {
  if (ctx || failed) return ctx;
  try {
    const Ctor =
      window.AudioContext ??
      (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctor) {
      failed = true;
      return null;
    }
    ctx = new Ctor();
    // Everything routes through one gain, so muting is a single value change
    // and no caller needs to know about it.
    master = ctx.createGain();
    master.gain.value = muted ? 0 : 1;
    master.connect(ctx.destination);
  } catch {
    failed = true;
  }
  return ctx;
}

/** Call from a click handler so the browser lets us play later. */
export function primeAudio(): void {
  const audio = context();
  if (audio && audio.state === 'suspended') void audio.resume();
}

export function setAudioSeat(seat: 'p1' | 'p2' | null): void {
  localSeat = seat;
}

export function isMuted(): boolean {
  return muted;
}

export function setMuted(next: boolean): void {
  muted = next;
  try {
    localStorage.setItem(MUTE_KEY, next ? '1' : '0');
  } catch {
    // A blocked store just means the choice does not persist.
  }
  if (master) master.gain.value = next ? 0 : 1;
}

interface Voice {
  type?: OscillatorType;
  /** -1 hard left … 1 hard right. Ignored where StereoPanner is unavailable. */
  pan?: number;
  /** Multiplies the frequency, for pitching a whole voice down. */
  detune?: number;
}

function blip(frequency: number, durationMs: number, gain: number, voice: Voice = {}): void {
  const audio = context();
  if (!audio || !master) return;
  try {
    if (audio.state === 'suspended') void audio.resume();
    const osc = audio.createOscillator();
    const amp = audio.createGain();
    osc.type = voice.type ?? 'sine';
    osc.frequency.value = frequency * (voice.detune ?? 1);

    const now = audio.currentTime;
    const end = now + durationMs / 1000;
    amp.gain.setValueAtTime(0.0001, now);
    amp.gain.exponentialRampToValueAtTime(Math.max(0.0002, gain), now + 0.01);
    amp.gain.exponentialRampToValueAtTime(0.0001, end);

    let tail: AudioNode = amp;
    if (voice.pan !== undefined && typeof audio.createStereoPanner === 'function') {
      const panner = audio.createStereoPanner();
      panner.pan.value = voice.pan;
      amp.connect(panner);
      tail = panner;
    }

    osc.connect(amp);
    tail.connect(master);
    osc.start(now);
    osc.stop(end + 0.02);
  } catch {
    // A missing tick is never worth an error.
  }
}

/**
 * The opponent gets a different timbre, pitched down and offset in the stereo
 * field — so a long cascade *sounds* like it is happening to you rather than
 * by you, without having to look.
 */
function voiceFor(byOpponent: boolean): Voice {
  return byOpponent
    ? { type: 'triangle', detune: 0.75, pan: 0.35 }
    : { type: 'sine', pan: -0.35 };
}

/** Whether a move by `player` is the opponent's, from the local seat's view. */
export function isOpponent(player: 'p1' | 'p2' | null): boolean {
  if (!player) return false;
  // Pass-and-play has no local seat: player two is treated as "the other voice"
  // so the two humans still sound different.
  return localSeat === null ? player === 'p2' : player !== localSeat;
}

/** Diatonic, not chromatic — chromatic reads as a siren, diatonic as triumph. */
const SCALE = [0, 2, 4, 5, 7, 9, 11, 12, 14, 16, 17, 19];

function scaleStep(index: number): number {
  // Long runs keep climbing by octave instead of flattening at the top.
  const octave = Math.floor(index / SCALE.length);
  return SCALE[index % SCALE.length] + octave * 12;
}

/** A line being drawn: short, low, physical. */
export function playClaimLine(byOpponent = false): void {
  blip(180, 55, 0.07, voiceFor(byOpponent));
}

/** A box claimed. Pitch climbs with position in the run. */
export function playClaimSquare(indexInChain: number, byOpponent = false): void {
  const step = scaleStep(Math.max(0, indexInChain));
  blip(440 * Math.pow(2, step / 12), 130, 0.13, voiceFor(byOpponent));
}

/**
 * The cadence that ends a run. A crescendo with no resolution is just noise —
 * this gives the build somewhere to land.
 */
export function playChainResolve(chainLength: number, byOpponent = false): void {
  if (chainLength < 2) return;
  const root = 440 * Math.pow(2, scaleStep(Math.max(0, chainLength - 1)) / 12);
  const voice = voiceFor(byOpponent);
  // Tonic, fifth, octave — arpeggiated tight so it reads as one chord.
  blip(root / 2, 300, 0.11, voice);
  window.setTimeout(() => blip((root / 2) * 1.5, 280, 0.1, voice), 45);
  window.setTimeout(() => blip(root, 260, 0.1, voice), 90);
}

export function playCountdownTick(secondsLeft: number): void {
  const step = Math.min(5, Math.max(1, secondsLeft));
  blip(660 + (5 - step) * 90, 120, 0.16);
}

export function playTimeUp(): void {
  blip(320, 420, 0.2);
}

export function playVictory(): void {
  blip(523, 160, 0.16);
  window.setTimeout(() => blip(784, 320, 0.16), 150);
}

export function playDefeat(): void {
  blip(392, 180, 0.14);
  window.setTimeout(() => blip(262, 380, 0.14), 170);
}

/** Plays up the winner's board as it is swept, resolving on the octave. */
export function playVictorySweep(count: number): void {
  const notes = Math.min(count, 16);
  for (let i = 0; i < notes; i += 1) {
    window.setTimeout(() => {
      blip(440 * Math.pow(2, scaleStep(i) / 12), 150, 0.12);
    }, i * 55);
  }
  window.setTimeout(() => blip(880, 420, 0.16), notes * 55 + 80);
}

/** Someone arrived: same shape as victory, quieter. */
export function playOpponentJoined(): void {
  blip(523, 140, 0.14);
  window.setTimeout(() => blip(784, 200, 0.12), 120);
}

/** Someone left: a falling door-close. */
export function playOpponentLeft(): void {
  blip(440, 160, 0.12);
  window.setTimeout(() => blip(294, 260, 0.12), 140);
}

/** A neutral knock — deliberately neither rising nor falling. */
export function playDrawOffered(): void {
  blip(440, 150, 0.12);
  window.setTimeout(() => blip(440, 180, 0.12), 200);
}

/** A small flat buzz for a refused move. */
export function playRejected(): void {
  blip(220, 90, 0.1);
  window.setTimeout(() => blip(208, 90, 0.1), 90);
}
