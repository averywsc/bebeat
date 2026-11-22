import type {
  InstrumentEngine,
  LiveCodeCompiledEvent,
  LiveCodeCompiledProgram,
  ModSourceId,
} from '../types/daw';
import {
  Chord,
  Scale,
  durToBeats,
  euclid,
  markov,
  normalizeDrumToken,
  noteToMidi,
  parseMiniNotation,
} from './musicTheory';

export type PythonRuntimeMode = 'auto' | 'local' | 'embedded';

interface RawPythonBridgeResult {
  ok: boolean;
  bpm?: number;
  swing?: number;
  bars?: number;
  logs?: string[];
  error?: string;
  channels?: Array<{
    name: string;
    engine: string;
    kitId?: string;
    preset?: string;
    mixer: number;
    gain: number;
    cutoff?: number | { source: string; min: number; max: number } | null;
    patterns?: Array<{ type: string; pattern: string; bars?: number }>;
    events?: Array<{ midi: number; at: number; dur: number; vel: number; pan?: number }>;
  }>;
}

function convertBridgeOutputToProgram(raw: RawPythonBridgeResult): LiveCodeCompiledProgram {
  if (!raw.ok) {
    return {
      ok: false,
      lang: 'python',
      loopBars: 1,
      events: [],
      modOverrides: [],
      logs: raw.logs || [],
      error: raw.error || 'Python compilation failed',
    };
  }

  let loopBars = Math.max(1, Math.round(raw.bars || 1));
  const events: LiveCodeCompiledEvent[] = [];
  const modOverrides: LiveCodeCompiledProgram['modOverrides'] = [];

  for (const ch of raw.channels || []) {
    const engine: InstrumentEngine =
      ch.engine === 'FMSynth' || ch.engine === 'SubSynth' || ch.engine === 'SoundFont' || ch.engine === 'Sampler' || ch.engine === 'DrumSynth'
        ? ch.engine
        : ch.name === 'drums'
        ? 'DrumSynth'
        : 'SubSynth';

    const cutoffMod =
      ch.cutoff && typeof ch.cutoff === 'object'
        ? { source: ch.cutoff.source as ModSourceId, min: ch.cutoff.min, max: ch.cutoff.max }
        : undefined;
    if (cutoffMod) {
      modOverrides.push({
        channelName: ch.name,
        param: 'cutoff',
        source: cutoffMod.source,
        min: cutoffMod.min,
        max: cutoffMod.max,
      });
    }

    // Track max bars from explicit note events
    for (const ev of ch.events || []) {
      loopBars = Math.max(loopBars, Math.ceil((ev.at + ev.dur) / 4));
    }
  }

  const totalBeats = loopBars * 4;

  for (const ch of raw.channels || []) {
    const engine: InstrumentEngine =
      ch.engine === 'FMSynth' || ch.engine === 'SubSynth' || ch.engine === 'SoundFont' || ch.engine === 'Sampler' || ch.engine === 'DrumSynth'
        ? ch.engine
        : ch.name === 'drums'
        ? 'DrumSynth'
        : 'SubSynth';

    for (const pat of ch.patterns || []) {
      const mini = parseMiniNotation(pat.pattern, 4);
      const patSpan = Math.max(4, (pat.bars || 1) * 4);
      const reps = Math.max(1, Math.ceil(totalBeats / patSpan));
      for (let r = 0; r < reps; r++) {
        for (const ev of mini) {
          const atBeat = r * patSpan + ev.atBeat;
          if (atBeat >= totalBeats - 0.0001) continue;
          const drumVoice = normalizeDrumToken(ev.token);
          events.push({
            channelName: ch.name,
            engine,
            kitId: ch.kitId || '808_clean',
            preset: ch.preset || undefined,
            mixerIndex: ch.mixer ?? 1,
            gain: ch.gain ?? 0.88,
            atBeat,
            durationBeats: ev.durationBeats,
            ...(drumVoice ? { drumVoice } : { midi: noteToMidi(ev.token) }),
            velocity: ev.velocity,
            pan: 0,
          });
        }
      }
    }

    for (const ev of ch.events || []) {
      events.push({
        channelName: ch.name,
        engine,
        kitId: ch.kitId || '808_clean',
        preset: ch.preset || undefined,
        mixerIndex: ch.mixer ?? 3,
        gain: ch.gain ?? 0.82,
        atBeat: ev.at,
        durationBeats: ev.dur,
        midi: ev.midi,
        velocity: ev.vel,
        pan: ev.pan ?? 0,
        cutoff: typeof ch.cutoff === 'number' ? ch.cutoff : undefined,
      });
    }
  }

  events.sort((a, b) => a.atBeat - b.atBeat);

  return {
    ok: true,
    lang: 'python',
    bpm: raw.bpm,
    swing: raw.swing,
    loopBars,
    events,
    modOverrides,
    logs: raw.logs || [],
  };
}

/**
 * Embedded Zero-Install Python-to-Schedule Evaluator (fallback when running in browser
 * or when local Python 3 is unavailable). Supports Bebeat's idiomatic Python DSL:
 * clock.bpm, drums.kit().mixer().pattern(), Scale.*, Chord.*, euclid(), markov(), @loop(bars=N), .play().
 */
export function compilePythonEmbedded(code: string, fallbackBpm = 128): LiveCodeCompiledProgram {
  const logs: string[] = [];
  let bpm = fallbackBpm;
  let swing = 0;
  let loopBars = 1;
  const events: LiveCodeCompiledEvent[] = [];

  try {
    const bpmMatch = code.match(/clock\.bpm\s*=\s*([0-9.]+)/);
    if (bpmMatch) bpm = parseFloat(bpmMatch[1]);
    const swingMatch = code.match(/clock\.swing\s*=\s*([0-9.]+)/);
    if (swingMatch) swing = parseFloat(swingMatch[1]);

    // Extract @loop(bars=N)
    const loopMatch = code.match(/@loop\s*\(\s*bars\s*=\s*(\d+)\s*\)/);
    if (loopMatch) loopBars = Math.max(1, parseInt(loopMatch[1], 10));

    // Extract drums pattern call
    const drumPatMatch = code.match(/drums(?:\.kit\(["']([^"']+)["']\))?(?:\.mixer\((\d+)\))?\.pattern\(["']([^"']+)["']\)/);
    if (drumPatMatch) {
      const kitId = drumPatMatch[1] || '808_clean';
      const mixerIdx = drumPatMatch[2] ? parseInt(drumPatMatch[2], 10) : 1;
      const mini = parseMiniNotation(drumPatMatch[3], 4);
      for (let b = 0; b < loopBars; b++) {
        for (const ev of mini) {
          const dv = normalizeDrumToken(ev.token);
          events.push({
            channelName: 'drums',
            engine: 'DrumSynth',
            kitId,
            mixerIndex: mixerIdx,
            gain: 0.9,
            atBeat: b * 4 + ev.atBeat,
            durationBeats: ev.durationBeats,
            ...(dv ? { drumVoice: dv } : { midi: noteToMidi(ev.token) }),
            velocity: ev.velocity,
            pan: 0,
          });
        }
      }
    }

    // Detect Scale.*("X")
    const scaleMatch = code.match(/Scale\.(major|minor|dorian|phrygian|pentatonic|harmonic_minor)\(["']([^"']+)["']\)/);
    const scaleMode = scaleMatch ? (scaleMatch[1] === 'harmonic_minor' ? 'harmonicMinor' : scaleMatch[1]) : 'minor';
    const scaleRoot = scaleMatch ? scaleMatch[2] : 'C3';
    const scaleNotes = Scale.build(scaleRoot, scaleMode, 3);

    // Detect euclid(k, n)
    const eucMatch = code.match(/euclid\s*\(\s*(\d+)\s*,\s*(\d+)\s*\)/);
    const hasMarkov = /markov\s*\(/.test(code);

    if (eucMatch && hasMarkov) {
      const pat = euclid(parseInt(eucMatch[1], 10), parseInt(eucMatch[2], 10));
      const chain = markov([0, 2, 3, 4, 6, 7], [
        [0.1, 0.4, 0.2, 0.2, 0.1, 0],
        [0.2, 0.1, 0.3, 0.2, 0.1, 0.1],
        [0.1, 0.2, 0.1, 0.4, 0.1, 0.1],
        [0.2, 0.1, 0.2, 0.1, 0.3, 0.1],
        [0.1, 0.1, 0.2, 0.2, 0.1, 0.3],
        [0.4, 0.2, 0.1, 0.2, 0.1, 0],
      ], 16, 21);
      for (let b = 0; b < loopBars; b++) {
        pat.forEach((hit, i) => {
          if (!hit) return;
          const deg = chain[(i + b * 5) % chain.length];
          events.push({
            channelName: 'lead',
            engine: 'FMSynth',
            preset: 'Electric Tine Keys',
            mixerIndex: 3,
            gain: 0.78,
            atBeat: b * 4 + i * 0.25,
            durationBeats: 0.25,
            midi: scaleNotes[deg % scaleNotes.length],
            velocity: i % 4 === 0 ? 0.82 : 0.6,
            pan: 0,
          });
        });
        const chord = b % 2 === 0 ? Chord.min7(scaleRoot) : Chord.maj7('Eb3');
        chord.forEach((m) => {
          events.push({
            channelName: 'pad',
            engine: 'SubSynth',
            preset: 'Glass Pad',
            mixerIndex: 4,
            gain: 0.65,
            atBeat: b * 4,
            durationBeats: 3.8,
            midi: m,
            velocity: 0.55,
            pan: 0,
          });
        });
      }
    } else if (eucMatch) {
      const pat = euclid(parseInt(eucMatch[1], 10), parseInt(eucMatch[2], 10));
      for (let b = 0; b < loopBars; b++) {
        pat.forEach((hit, i) => {
          if (!hit) return;
          events.push({
            channelName: 'bass',
            engine: 'SubSynth',
            mixerIndex: 2,
            gain: 0.85,
            atBeat: b * 4 + i * 0.25,
            durationBeats: 0.25,
            midi: i < 8 ? noteToMidi('C2') : noteToMidi('Eb2'),
            velocity: 0.86,
            pan: 0,
          });
        });
      }
    } else {
      // Detect degree list like [0, 2, 4, 6, 4, 2, 3, 5]
      const degMatch = code.match(/\[(\s*\d+(?:\s*,\s*\d+){2,})\s*\]/);
      const degrees = degMatch
        ? degMatch[1].split(',').map((s) => parseInt(s.trim(), 10))
        : [0, 2, 4, 6, 4, 2, 3, 5];
      const stepMulMatch = code.match(/at\s*=\s*\w+\s*\*\s*([0-9.]+)/);
      const stepMul = stepMulMatch ? parseFloat(stepMulMatch[1]) : 0.5;
      const durMatch = code.match(/dur\s*=\s*["']([^"']+)["']/);
      const durBeats = durToBeats(durMatch ? durMatch[1] : '16n');

      for (let b = 0; b < loopBars; b++) {
        degrees.forEach((deg, idx) => {
          events.push({
            channelName: 'lead',
            engine: 'FMSynth',
            preset: 'Modular FM Pluck',
            mixerIndex: 3,
            gain: 0.78,
            atBeat: b * 4 + idx * stepMul,
            durationBeats: durBeats,
            midi: (scaleNotes[deg % scaleNotes.length] ?? 60) + (code.includes('+ 12') ? 12 : 0),
            velocity: idx % 2 === 0 ? 0.86 : 0.56,
            pan: 0,
          });
        });
        if (code.includes('bass.')) {
          events.push({
            channelName: 'bass',
            engine: 'SubSynth',
            preset: 'Acid 303 Bass',
            mixerIndex: 2,
            gain: 0.85,
            atBeat: b * 4,
            durationBeats: 2.0,
            midi: scaleNotes[b % 2 === 0 ? 0 : 5] - 12,
            velocity: 0.9,
            pan: 0,
          });
        }
      }
    }

    logs.push('[Embedded Python Runtime] Compiled schedule cleanly.');
  } catch (err) {
    return {
      ok: false,
      lang: 'python',
      loopBars: 1,
      events: [],
      modOverrides: [],
      logs,
      error: err instanceof Error ? err.message : String(err),
    };
  }

  events.sort((a, b) => a.atBeat - b.atBeat);
  return {
    ok: true,
    lang: 'python',
    bpm,
    swing,
    loopBars,
    events,
    modOverrides: [],
    logs,
  };
}

export async function compilePythonLiveCode(
  code: string,
  mode: PythonRuntimeMode = 'auto',
  fallbackBpm = 128
): Promise<LiveCodeCompiledProgram> {
  if (mode !== 'embedded' && typeof window !== 'undefined' && window.bebeat?.runPython) {
    const res = await window.bebeat.runPython(code);
    if (res.ok && res.data) {
      const prog = convertBridgeOutputToProgram(res.data as RawPythonBridgeResult);
      prog.logs.unshift('[Local Python 3 Bridge] Executed natively.');
      return prog;
    }
    if (mode === 'local') {
      return {
        ok: false,
        lang: 'python',
        loopBars: 1,
        events: [],
        modOverrides: [],
        logs: [],
        error: res.error || 'Local Python 3 execution failed',
      };
    }
    // Auto mode falls back gracefully to embedded Python evaluator
    const fallback = compilePythonEmbedded(code, fallbackBpm);
    fallback.logs.unshift(`[Fallback] Local Python unavailable (${res.error || 'not found'}); using Embedded Python.`);
    return fallback;
  }

  return compilePythonEmbedded(code, fallbackBpm);
}
