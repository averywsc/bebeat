import type {
  InstrumentEngine,
  LiveCodeCompiledEvent,
  LiveCodeCompiledProgram,
  ModSourceId,
  ModTargetParam,
} from '../types/daw';
import {
  Chord,
  Scale,
  durToBeats,
  euclid,
  humanize,
  markov,
  normalizeDrumToken,
  noteToMidi,
  parseMiniNotation,
  polyrhythm,
  prob,
  transpose,
} from './musicTheory';

interface ModDescriptor {
  kind: 'lfo' | 'source';
  shape?: 'sine' | 'saw' | 'tri' | 'square';
  rateHz?: number;
  source?: ModSourceId;
  min: number;
  max: number;
}

function makeSourceExpr(source: ModSourceId, min = 0, max = 1) {
  return {
    __mod: true,
    kind: 'source' as const,
    source,
    min,
    max,
    map(lo: number, hi: number) {
      return makeSourceExpr(source, lo, hi);
    },
  };
}

function evalModAtBeat(mod: ModDescriptor, atBeat: number, bpm: number): number {
  if (mod.kind === 'lfo') {
    const tSec = (atBeat * 60) / Math.max(30, bpm);
    const phase = (tSec * (mod.rateHz ?? 0.5)) % 1;
    let wave = 0.5;
    if (mod.shape === 'sine') wave = 0.5 + 0.5 * Math.sin(2 * Math.PI * phase);
    else if (mod.shape === 'saw') wave = phase;
    else if (mod.shape === 'tri') wave = phase < 0.5 ? phase * 2 : (1 - phase) * 2;
    else wave = phase < 0.5 ? 1 : 0;
    return mod.min + wave * (mod.max - mod.min);
  }
  return mod.min + 0.5 * (mod.max - mod.min);
}

class JsInstrumentBuilder {
  engine: InstrumentEngine;
  kitId = '808_clean';
  preset = '';
  mixerIdx: number;
  gainVal = 0.85;
  panVal = 0;
  cutoffStatic?: number;
  cutoffMod?: ModDescriptor;
  events: Array<{
    atBeat: number;
    durationBeats: number;
    midi?: number;
    drumVoice?: NonNullable<ReturnType<typeof normalizeDrumToken>>;
    velocity: number;
    pan: number;
  }> = [];
  barsUsed = 1;

  constructor(public name: string, defaultEngine: InstrumentEngine, defaultMixer: number) {
    this.engine = defaultEngine;
    this.mixerIdx = defaultMixer;
  }

  kit(kitId: string) {
    this.kitId = kitId;
    this.engine = 'DrumSynth';
    return this;
  }

  synth(engineName: InstrumentEngine | string, preset = '') {
    if (engineName === 'FMSynth' || engineName === 'SubSynth' || engineName === 'SoundFont' || engineName === 'Sampler' || engineName === 'DrumSynth') {
      this.engine = engineName;
    }
    this.preset = preset;
    return this;
  }

  mixer(idx: number) {
    this.mixerIdx = Math.max(0, Math.round(idx));
    return this;
  }

  gain(v: number) {
    this.gainVal = Math.max(0, Math.min(1.5, Number(v) || 0.85));
    return this;
  }

  pan(v: number) {
    this.panVal = Math.max(-1, Math.min(1, Number(v) || 0));
    return this;
  }

  cutoff(val: number | ModDescriptor) {
    if (typeof val === 'number') {
      this.cutoffStatic = val;
    } else if (val && typeof val === 'object') {
      this.cutoffMod = val;
    }
    return this;
  }

  pattern(mini: string, bars = 1) {
    const parsed = parseMiniNotation(mini, 4);
    let maxBeat = bars * 4;
    for (const ev of parsed) {
      if (ev.atBeat + ev.durationBeats > maxBeat) maxBeat = ev.atBeat + ev.durationBeats;
      const drumVoice = normalizeDrumToken(ev.token);
      if (drumVoice) {
        this.events.push({
          atBeat: ev.atBeat,
          durationBeats: ev.durationBeats,
          drumVoice,
          velocity: ev.velocity,
          pan: this.panVal,
        });
      } else {
        this.events.push({
          atBeat: ev.atBeat,
          durationBeats: ev.durationBeats,
          midi: noteToMidi(ev.token),
          velocity: ev.velocity,
          pan: this.panVal,
        });
      }
    }
    this.barsUsed = Math.max(this.barsUsed, Math.ceil(maxBeat / 4));
    return this;
  }

  notes(seq: string | Array<string | number>, dur: string | number = '8n') {
    const stepBeats = durToBeats(dur);
    if (typeof seq === 'string') {
      const bars = seq.split('|').map((b) => b.trim()).filter(Boolean);
      bars.forEach((barStr, barIdx) => {
        const toks = barStr.split(/\s+/).filter(Boolean);
        const slot = Math.min(stepBeats, 4 / Math.max(1, toks.length));
        toks.forEach((tok, i) => {
          if (tok === '~' || tok === '-') return;
          this.events.push({
            atBeat: barIdx * 4 + i * slot,
            durationBeats: stepBeats * 0.9,
            midi: noteToMidi(tok),
            velocity: i % 2 === 0 ? 0.88 : 0.72,
            pan: this.panVal,
          });
        });
      });
      this.barsUsed = Math.max(this.barsUsed, Math.max(1, bars.length));
    } else if (Array.isArray(seq)) {
      seq.forEach((n, i) => {
        if (n === '~' || n === '-' || n === null || n === undefined) return;
        this.events.push({
          atBeat: i * stepBeats,
          durationBeats: stepBeats * 0.9,
          midi: noteToMidi(n),
          velocity: i % 2 === 0 ? 0.86 : 0.72,
          pan: this.panVal,
        });
      });
      this.barsUsed = Math.max(this.barsUsed, Math.ceil((seq.length * stepBeats) / 4));
    }
    return this;
  }

  chords(chordList: Array<Array<string | number>>, dur: string | number = '2n') {
    const d = durToBeats(dur);
    chordList.forEach((chord, ci) => {
      const atBeat = ci * d;
      chord.forEach((n, ni) => {
        this.events.push({
          atBeat,
          durationBeats: d * 0.95,
          midi: noteToMidi(n),
          velocity: Math.max(0.45, 0.72 - ni * 0.04),
          pan: this.panVal + (ni - 1.5) * 0.08,
        });
      });
    });
    this.barsUsed = Math.max(this.barsUsed, Math.ceil((chordList.length * d) / 4));
    return this;
  }

  euclid(pulses: number, steps: number, notes: Array<string | number>, dur: string | number = '16n', rotate = 0) {
    const pat = euclid(pulses, steps, rotate);
    const stepDur = durToBeats(dur);
    const totalBeats = steps * stepDur;
    // Tile to fill at least 1 bar (4 beats)
    const reps = Math.max(1, Math.ceil(4 / totalBeats));
    let noteCursor = 0;
    for (let r = 0; r < reps; r++) {
      pat.forEach((hit, i) => {
        if (!hit) return;
        const n = notes[noteCursor % Math.max(1, notes.length)];
        noteCursor++;
        const drum = typeof n === 'string' ? normalizeDrumToken(n) : null;
        this.events.push({
          atBeat: r * totalBeats + i * stepDur,
          durationBeats: stepDur * 0.85,
          ...(drum ? { drumVoice: drum } : { midi: noteToMidi(n) }),
          velocity: i === 0 ? 0.9 : 0.74,
          pan: this.panVal,
        });
      });
    }
    this.barsUsed = Math.max(this.barsUsed, Math.ceil((reps * totalBeats) / 4));
    return this;
  }

  play(note: string | number | Array<string | number>, opts?: { dur?: string | number; at?: number; vel?: number; pan?: number }) {
    const list = Array.isArray(note) ? note : [note];
    const atBeat = opts?.at ?? 0;
    const d = durToBeats(opts?.dur ?? '16n');
    const vel = opts?.vel ?? 0.82;
    list.forEach((n) => {
      const drum = typeof n === 'string' ? normalizeDrumToken(n) : null;
      this.events.push({
        atBeat,
        durationBeats: d,
        ...(drum ? { drumVoice: drum } : { midi: noteToMidi(n) }),
        velocity: vel,
        pan: opts?.pan ?? this.panVal,
      });
    });
    this.barsUsed = Math.max(this.barsUsed, Math.ceil((atBeat + d) / 4));
    return this;
  }
}

export function compileJsLiveCode(code: string, currentBpm = 128): LiveCodeCompiledProgram {
  const logs: string[] = [];
  const clock = { bpm: currentBpm, swing: 0, bars: 0 };
  const builders = new Map<string, JsInstrumentBuilder>();

  const getOrCreate = (name: string, engine: InstrumentEngine, mixerIdx: number) => {
    let b = builders.get(name);
    if (!b) {
      b = new JsInstrumentBuilder(name, engine, mixerIdx);
      builders.set(name, b);
    }
    return b;
  };

  const drums = getOrCreate('drums', 'DrumSynth', 1);
  const bass = getOrCreate('bass', 'SubSynth', 2);
  const lead = getOrCreate('lead', 'FMSynth', 3);
  const pad = getOrCreate('pad', 'SubSynth', 4);

  const synth = (name: string, engine: InstrumentEngine = 'SubSynth', mixerIdx = 5) =>
    getOrCreate(name, engine, mixerIdx);

  const lfo = {
    sine: (rateHz: number, min: number, max: number): ModDescriptor => ({ kind: 'lfo', shape: 'sine', rateHz, min, max }),
    saw: (rateHz: number, min: number, max: number): ModDescriptor => ({ kind: 'lfo', shape: 'saw', rateHz, min, max }),
    tri: (rateHz: number, min: number, max: number): ModDescriptor => ({ kind: 'lfo', shape: 'tri', rateHz, min, max }),
    square: (rateHz: number, min: number, max: number): ModDescriptor => ({ kind: 'lfo', shape: 'square', rateHz, min, max }),
  };

  const bands = {
    sub: makeSourceExpr('bands.sub'),
    low: makeSourceExpr('bands.lowMid'),
    lowMid: makeSourceExpr('bands.lowMid'),
    mid: makeSourceExpr('bands.highMid'),
    highMid: makeSourceExpr('bands.highMid'),
    highs: makeSourceExpr('bands.air'),
    air: makeSourceExpr('bands.air'),
  };

  const beat = {
    phase: makeSourceExpr('beat.phase'),
    bar: makeSourceExpr('bar.phase'),
    onBeat: (_n: number) => makeSourceExpr('beat.onBeat1'),
  };

  const env = {
    follow: (name = 'kick') =>
      makeSourceExpr(name.toLowerCase().includes('kick') || name.toLowerCase().includes('bd') ? 'env.kick' : 'env.master'),
  };

  const sandboxConsole = {
    log: (...args: unknown[]) => logs.push(args.map((a) => (typeof a === 'object' ? JSON.stringify(a) : String(a))).join(' ')),
    warn: (...args: unknown[]) => logs.push(`[WARN] ${args.map(String).join(' ')}`),
  };

  try {
    const fn = new Function(
      'clock',
      'drums',
      'bass',
      'lead',
      'pad',
      'synth',
      'lfo',
      'bands',
      'beat',
      'env',
      'Scale',
      'Chord',
      'transpose',
      'humanize',
      'euclid',
      'polyrhythm',
      'markov',
      'prob',
      'console',
      'Math',
      `"use strict";\n${code}`
    );

    fn(
      clock,
      drums,
      bass,
      lead,
      pad,
      synth,
      lfo,
      bands,
      beat,
      env,
      Scale,
      Chord,
      transpose,
      humanize,
      euclid,
      polyrhythm,
      markov,
      prob,
      sandboxConsole,
      Math
    );
  } catch (err) {
    return {
      ok: false,
      lang: 'javascript',
      loopBars: 1,
      events: [],
      modOverrides: [],
      logs,
      error: err instanceof Error ? err.message : String(err),
    };
  }

  let loopBars = Math.max(1, clock.bars || 1);
  builders.forEach((b) => {
    if (b.events.length > 0) loopBars = Math.max(loopBars, b.barsUsed);
  });

  const events: LiveCodeCompiledEvent[] = [];
  const modOverrides: LiveCodeCompiledProgram['modOverrides'] = [];

  builders.forEach((b) => {
    if (b.events.length === 0 && !b.cutoffMod) return;
    if (b.cutoffMod?.kind === 'source' && b.cutoffMod.source) {
      modOverrides.push({
        channelName: b.name,
        param: 'cutoff' as ModTargetParam,
        source: b.cutoffMod.source,
        min: b.cutoffMod.min,
        max: b.cutoffMod.max,
      });
    }

    // Tile shorter builders (e.g. 1-bar drum loop) across full loopBars
    const bSpanBeats = Math.max(4, b.barsUsed * 4);
    const totalBeats = loopBars * 4;
    const repeats = Math.max(1, Math.ceil(totalBeats / bSpanBeats));

    for (let r = 0; r < repeats; r++) {
      for (const ev of b.events) {
        const atBeat = r * bSpanBeats + ev.atBeat;
        if (atBeat >= totalBeats - 0.0001) continue;
        const cutoff =
          b.cutoffMod?.kind === 'lfo'
            ? evalModAtBeat(b.cutoffMod, atBeat, clock.bpm)
            : b.cutoffStatic;

        events.push({
          channelName: b.name,
          engine: b.engine,
          kitId: b.kitId,
          preset: b.preset || undefined,
          mixerIndex: b.mixerIdx,
          gain: b.gainVal,
          atBeat,
          durationBeats: ev.durationBeats,
          midi: ev.midi,
          drumVoice: ev.drumVoice,
          velocity: ev.velocity,
          pan: ev.pan,
          cutoff,
          cutoffMod:
            b.cutoffMod?.kind === 'source' && b.cutoffMod.source
              ? { source: b.cutoffMod.source, min: b.cutoffMod.min, max: b.cutoffMod.max }
              : undefined,
        });
      }
    }
  });

  events.sort((a, b) => a.atBeat - b.atBeat);

  return {
    ok: true,
    lang: 'javascript',
    bpm: clock.bpm,
    swing: clock.swing,
    loopBars,
    events,
    modOverrides,
    logs,
  };
}
