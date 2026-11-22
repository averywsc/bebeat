import type { DrumVoiceName } from '../types/daw';

const NOTE_SEMITONES: Record<string, number> = {
  C: 0, 'C#': 1, DB: 1,
  D: 2, 'D#': 3, EB: 3,
  E: 4,
  F: 5, 'F#': 6, GB: 6,
  G: 7, 'G#': 8, AB: 8,
  A: 9, 'A#': 10, BB: 10,
  B: 11,
};

const NOTE_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];

export const SCALE_DEFINITIONS: Record<string, number[]> = {
  major: [0, 2, 4, 5, 7, 9, 11],
  minor: [0, 2, 3, 5, 7, 8, 10],
  dorian: [0, 2, 3, 5, 7, 9, 10],
  phrygian: [0, 1, 3, 5, 7, 8, 10],
  lydian: [0, 2, 4, 6, 7, 9, 11],
  mixolydian: [0, 2, 4, 5, 7, 9, 10],
  pentatonic: [0, 3, 5, 7, 10],
  majorPentatonic: [0, 2, 4, 7, 9],
  harmonicMinor: [0, 2, 3, 5, 7, 8, 11],
  blues: [0, 3, 5, 6, 7, 10],
  chromatic: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11],
};

export const CHORD_DEFINITIONS: Record<string, number[]> = {
  maj: [0, 4, 7],
  min: [0, 3, 7],
  maj7: [0, 4, 7, 11],
  min7: [0, 3, 7, 10],
  dom7: [0, 4, 7, 10],
  dim: [0, 3, 6],
  aug: [0, 4, 8],
  sus2: [0, 2, 7],
  sus4: [0, 5, 7],
  min9: [0, 3, 7, 10, 14],
  maj9: [0, 4, 7, 11, 14],
  add9: [0, 4, 7, 14],
};

export function noteToMidi(note: string | number): number {
  if (typeof note === 'number') return Math.max(0, Math.min(127, Math.round(note)));
  const cleaned = note.trim().toUpperCase();
  const match = cleaned.match(/^([A-G][#B]?)(-?\d+)?$/);
  if (!match) return 60;
  const pitch = NOTE_SEMITONES[match[1]] ?? 0;
  const octave = match[2] !== undefined ? parseInt(match[2], 10) : 4;
  return Math.max(0, Math.min(127, (octave + 1) * 12 + pitch));
}

export function midiToNoteName(midi: number): string {
  const m = Math.max(0, Math.min(127, Math.round(midi)));
  const name = NOTE_NAMES[m % 12];
  const octave = Math.floor(m / 12) - 1;
  return `${name}${octave}`;
}

export function midiToFreq(midi: number): number {
  return 440 * Math.pow(2, (midi - 69) / 12);
}

export function durToBeats(dur: string | number): number {
  if (typeof dur === 'number') return Math.max(0.03125, dur);
  const map: Record<string, number> = {
    '1n': 4, '2n': 2, '2n.': 3,
    '4n': 1, '4n.': 1.5, '4t': 2 / 3,
    '8n': 0.5, '8n.': 0.75, '8t': 1 / 3,
    '16n': 0.25, '16n.': 0.375, '16t': 1 / 6,
    '32n': 0.125, '64n': 0.0625,
  };
  return map[dur.trim().toLowerCase()] ?? 0.25;
}

export function getScaleMidiNotes(root: string | number, scaleName: string, octaves = 2): number[] {
  const rootMidi = noteToMidi(root);
  const intervals = SCALE_DEFINITIONS[scaleName] ?? SCALE_DEFINITIONS.minor;
  const out: number[] = [];
  for (let oct = 0; oct < octaves; oct++) {
    for (const iv of intervals) {
      const m = rootMidi + oct * 12 + iv;
      if (m <= 127) out.push(m);
    }
  }
  return out;
}

export function isMidiInScale(midi: number, rootPitchClass: number, scaleName: string): boolean {
  const intervals = SCALE_DEFINITIONS[scaleName] ?? SCALE_DEFINITIONS.minor;
  const pc = (((midi - rootPitchClass) % 12) + 12) % 12;
  return intervals.includes(pc);
}

export function snapMidiToScale(midi: number, rootPitchClass: number, scaleName: string): number {
  if (isMidiInScale(midi, rootPitchClass, scaleName)) return midi;
  for (let d = 1; d <= 6; d++) {
    if (isMidiInScale(midi + d, rootPitchClass, scaleName)) return midi + d;
    if (isMidiInScale(midi - d, rootPitchClass, scaleName)) return midi - d;
  }
  return midi;
}

export const Scale = {
  build(root: string, mode = 'minor', octaves = 3): number[] {
    return getScaleMidiNotes(root, mode, octaves);
  },
  major: (root: string, octaves = 3) => getScaleMidiNotes(root, 'major', octaves),
  minor: (root: string, octaves = 3) => getScaleMidiNotes(root, 'minor', octaves),
  dorian: (root: string, octaves = 3) => getScaleMidiNotes(root, 'dorian', octaves),
  phrygian: (root: string, octaves = 3) => getScaleMidiNotes(root, 'phrygian', octaves),
  lydian: (root: string, octaves = 3) => getScaleMidiNotes(root, 'lydian', octaves),
  mixolydian: (root: string, octaves = 3) => getScaleMidiNotes(root, 'mixolydian', octaves),
  pentatonic: (root: string, octaves = 3) => getScaleMidiNotes(root, 'pentatonic', octaves),
  harmonicMinor: (root: string, octaves = 3) => getScaleMidiNotes(root, 'harmonicMinor', octaves),
};

export const Chord = {
  build(root: string | number, quality = 'min7'): number[] {
    const r = noteToMidi(root);
    const ivs = CHORD_DEFINITIONS[quality] ?? CHORD_DEFINITIONS.min7;
    return ivs.map((iv) => r + iv);
  },
  maj: (root: string) => Chord.build(root, 'maj'),
  min: (root: string) => Chord.build(root, 'min'),
  maj7: (root: string) => Chord.build(root, 'maj7'),
  min7: (root: string) => Chord.build(root, 'min7'),
  dom7: (root: string) => Chord.build(root, 'dom7'),
  min9: (root: string) => Chord.build(root, 'min9'),
  sus2: (root: string) => Chord.build(root, 'sus2'),
  sus4: (root: string) => Chord.build(root, 'sus4'),
};

/** Bjorklund / Euclidean rhythm generator returning 0/1 array of length `steps` */
export function euclid(pulses: number, steps: number, rotate = 0): number[] {
  const n = Math.max(1, Math.round(steps));
  const k = Math.max(0, Math.min(n, Math.round(pulses)));
  const pattern: number[] = [];
  for (let i = 0; i < n; i++) {
    pattern.push((i * k) % n < k ? 1 : 0);
  }
  if (rotate !== 0) {
    const r = ((rotate % n) + n) % n;
    return [...pattern.slice(n - r), ...pattern.slice(0, n - r)];
  }
  return pattern;
}

export function transpose(notes: Array<string | number>, semis: number): number[] {
  return notes.map((n) => noteToMidi(n) + semis);
}

export function polyrhythm(a: number, b: number, totalBeats = 4): { layerA: number[]; layerB: number[] } {
  const layerA: number[] = [];
  const layerB: number[] = [];
  for (let i = 0; i < a; i++) layerA.push((i * totalBeats) / a);
  for (let i = 0; i < b; i++) layerB.push((i * totalBeats) / b);
  return { layerA, layerB };
}

export function markov<T>(states: T[], matrix: number[][], length = 16, seed = 13): T[] {
  if (states.length === 0) return [];
  let s = seed | 0;
  const rand = () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
  let idx = 0;
  const out: T[] = [];
  for (let i = 0; i < length; i++) {
    out.push(states[idx]);
    const row = matrix[idx] || states.map(() => 1 / states.length);
    const total = row.reduce((a, b) => a + b, 0) || 1;
    let r = rand() * total;
    for (let j = 0; j < row.length; j++) {
      r -= row[j];
      if (r <= 0) {
        idx = j % states.length;
        break;
      }
    }
  }
  return out;
}

export function humanize(value: number, amount = 0.05, seed = 1): number {
  const x = Math.sin(seed * 12.9898) * 43758.5453;
  const r = (x - Math.floor(x)) * 2 - 1;
  return value + r * amount;
}

export function prob(chance: number, seed = 1): boolean {
  const x = Math.sin(seed * 78.233) * 43758.5453;
  return (x - Math.floor(x)) <= chance;
}

export interface MiniEvent {
  token: string;
  atBeat: number;
  durationBeats: number;
  velocity: number;
  layer: number;
}

/**
 * Strudel / TidalCycles inspired Mini-Notation Parser:
 * Supports:
 * - Layered tracks via comma: `"bd ~ sn ~, hh*8"`
 * - Bar splits via pipe: `"c2 ~ c2 eb2 | g2 ~ f2 d2"`
 * - Subdivision brackets: `"[sn cp]"`, `"[bd [hh hh]]"`
 * - Multiplication: `"hh*8"`, `"cp*2"`
 * - Rests: `"~"` or `"-"`
 * - Euclidean suffix: `"bd(5,8)"`
 */
export function parseMiniNotation(input: string, beatsPerCycle = 4): MiniEvent[] {
  const layers = splitTopLevel(input, ',');
  const allEvents: MiniEvent[] = [];

  layers.forEach((layerStr, layerIdx) => {
    const bars = splitTopLevel(layerStr, '|').map((s) => s.trim()).filter(Boolean);
    if (bars.length === 0) return;
    bars.forEach((barStr, barIdx) => {
      const tokens = tokenizeMini(barStr);
      if (tokens.length === 0) return;
      const barStart = barIdx * beatsPerCycle;
      scheduleGroup(tokens, barStart, beatsPerCycle, layerIdx, allEvents);
    });
  });

  return allEvents.sort((a, b) => a.atBeat - b.atBeat);
}

function splitTopLevel(str: string, sep: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let cur = '';
  for (let i = 0; i < str.length; i++) {
    const ch = str[i];
    if (ch === '[' || ch === '<' || ch === '(') depth++;
    else if (ch === ']' || ch === '>' || ch === ')') depth = Math.max(0, depth - 1);
    if (ch === sep && depth === 0) {
      parts.push(cur);
      cur = '';
    } else {
      cur += ch;
    }
  }
  if (cur.trim().length > 0) parts.push(cur);
  return parts;
}

function tokenizeMini(str: string): string[] {
  const tokens: string[] = [];
  let i = 0;
  while (i < str.length) {
    while (i < str.length && /\s/.test(str[i])) i++;
    if (i >= str.length) break;
    if (str[i] === '[') {
      let depth = 1;
      let j = i + 1;
      while (j < str.length && depth > 0) {
        if (str[j] === '[') depth++;
        else if (str[j] === ']') depth--;
        j++;
      }
      // Capture trailing multiplier like `[sn cp]*2`
      while (j < str.length && !/\s/.test(str[j]) && str[j] !== '[') j++;
      tokens.push(str.slice(i, j));
      i = j;
    } else {
      let j = i;
      while (j < str.length && !/\s/.test(str[j])) j++;
      tokens.push(str.slice(i, j));
      i = j;
    }
  }
  return tokens;
}

function scheduleGroup(
  tokens: string[],
  startBeat: number,
  spanBeats: number,
  layer: number,
  out: MiniEvent[]
): void {
  const slotDur = spanBeats / tokens.length;
  tokens.forEach((rawTok, idx) => {
    const slotStart = startBeat + idx * slotDur;
    let tok = rawTok.trim();
    if (!tok || tok === '~' || tok === '-') return;

    // Handle multiplier suffix `*N`
    let repeat = 1;
    const mulMatch = tok.match(/^(.*)\*(\d+(?:\.\d+)?)$/);
    if (mulMatch) {
      tok = mulMatch[1];
      repeat = Math.max(1, Math.min(32, Math.round(parseFloat(mulMatch[2]))));
    }

    const repDur = slotDur / repeat;
    for (let r = 0; r < repeat; r++) {
      const rStart = slotStart + r * repDur;
      if (tok.startsWith('[') && tok.endsWith(']')) {
        const inner = tokenizeMini(tok.slice(1, -1));
        if (inner.length > 0) {
          scheduleGroup(inner, rStart, repDur, layer, out);
        }
      } else {
        // Check euclidean syntax e.g. `bd(5,8)` or `c3(3,8,1)`
        const eucMatch = tok.match(/^([^(]+)\((\d+),(\d+)(?:,(\d+))?\)$/);
        if (eucMatch) {
          const baseTok = eucMatch[1];
          const pulses = parseInt(eucMatch[2], 10);
          const steps = parseInt(eucMatch[3], 10);
          const rot = eucMatch[4] ? parseInt(eucMatch[4], 10) : 0;
          const pat = euclid(pulses, steps, rot);
          const stepDur = repDur / pat.length;
          pat.forEach((hit, hi) => {
            if (hit) {
              out.push({
                token: baseTok,
                atBeat: rStart + hi * stepDur,
                durationBeats: stepDur * 0.9,
                velocity: hi === 0 ? 0.92 : 0.78,
                layer,
              });
            }
          });
        } else {
          out.push({
            token: tok,
            atBeat: rStart,
            durationBeats: repDur * 0.9,
            velocity: idx === 0 && r === 0 ? 0.9 : 0.78,
            layer,
          });
        }
      }
    }
  });
}

export function normalizeDrumToken(tok: string): DrumVoiceName | null {
  const t = tok.toLowerCase().trim();
  const map: Record<string, DrumVoiceName> = {
    bd: 'bd', kick: 'bd', k: 'bd',
    sn: 'sn', sd: 'sn', snare: 'sn',
    cp: 'cp', clap: 'cp',
    hh: 'hh', ch: 'hh', hat: 'hh',
    oh: 'oh', openhat: 'oh',
    rim: 'rim', rs: 'rim',
    lt: 'lt', tom: 'lt', mt: 'lt',
    perc: 'perc', cb: 'perc', fm: 'perc',
  };
  return map[t] ?? null;
}
