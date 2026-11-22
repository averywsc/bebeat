export type RetroVoiceId =
  | 'sam_82'
  | 'fl_robot'
  | 'cyber_vocoder'
  | 'radio_vintage'
  | 'whisper_ghost'
  | 'giant_bot'
  | 'chipmunk'
  | 'alien_mod'
  | 'windows_sapi';

export interface RetroVoicePreset {
  id: RetroVoiceId;
  name: string;
  description: string;
  defaultPitchHz: number;
  defaultSpeed: number;
  formantShift: number;
  bitcrush: number;
  noiseMix: number;
  ringModHz: number;
  chordHarmonics: boolean;
}

export const RETRO_VOICE_PRESETS: RetroVoicePreset[] = [
  {
    id: 'sam_82',
    name: 'SAM 1982 (8-Bit Classic)',
    description: 'Gritty 8-bit classic computer speech synthesizer with stepped formants',
    defaultPitchHz: 118,
    defaultSpeed: 1.0,
    formantShift: 1.0,
    bitcrush: 0.55,
    noiseMix: 0.14,
    ringModHz: 0,
    chordHarmonics: false,
  },
  {
    id: 'fl_robot',
    name: 'Classic Robot (Monotone)',
    description: 'Iconic buzz-wave DAW speech synthesizer robot voice',
    defaultPitchHz: 110,
    defaultSpeed: 1.05,
    formantShift: 0.96,
    bitcrush: 0.25,
    noiseMix: 0.08,
    ringModHz: 0,
    chordHarmonics: false,
  },
  {
    id: 'cyber_vocoder',
    name: 'Cyber Vocoder (Chord)',
    description: 'Harmonic chord-carrier robotic vocoder speech',
    defaultPitchHz: 130.81,
    defaultSpeed: 0.95,
    formantShift: 1.05,
    bitcrush: 0.12,
    noiseMix: 0.1,
    ringModHz: 0,
    chordHarmonics: true,
  },
  {
    id: 'radio_vintage',
    name: 'Vintage Radio / Intercom',
    description: 'Tight mid-band vintage transmission speech',
    defaultPitchHz: 142,
    defaultSpeed: 1.1,
    formantShift: 1.12,
    bitcrush: 0.35,
    noiseMix: 0.22,
    ringModHz: 0,
    chordHarmonics: false,
  },
  {
    id: 'whisper_ghost',
    name: 'Whisper Synth',
    description: 'Breathy unvoiced formant whisper for atmospheric drops',
    defaultPitchHz: 160,
    defaultSpeed: 0.85,
    formantShift: 1.15,
    bitcrush: 0.05,
    noiseMix: 0.92,
    ringModHz: 0,
    chordHarmonics: false,
  },
  {
    id: 'giant_bot',
    name: 'Giant Sub-Bot',
    description: 'Deep sub-octave booming retro robotic voice',
    defaultPitchHz: 68,
    defaultSpeed: 0.82,
    formantShift: 0.72,
    bitcrush: 0.3,
    noiseMix: 0.1,
    ringModHz: 0,
    chordHarmonics: false,
  },
  {
    id: 'chipmunk',
    name: 'High-Pitch Chipmunk',
    description: 'Fast, high-formant pitched retro vocal tag',
    defaultPitchHz: 255,
    defaultSpeed: 1.25,
    formantShift: 1.48,
    bitcrush: 0.15,
    noiseMix: 0.08,
    ringModHz: 0,
    chordHarmonics: false,
  },
  {
    id: 'alien_mod',
    name: 'Alien Ring-Mod',
    description: 'Sci-fi metallic ring-modulated speech',
    defaultPitchHz: 125,
    defaultSpeed: 0.95,
    formantShift: 1.08,
    bitcrush: 0.2,
    noiseMix: 0.12,
    ringModHz: 46,
    chordHarmonics: false,
  },
  {
    id: 'windows_sapi',
    name: 'Windows Classic SAPI Voice',
    description: 'Classic built-in Windows desktop Text-to-Speech rendered to editable WAV',
    defaultPitchHz: 120,
    defaultSpeed: 1.0,
    formantShift: 1.0,
    bitcrush: 0,
    noiseMix: 0,
    ringModHz: 0,
    chordHarmonics: false,
  },
];

interface PhonemeSpec {
  f1: number;
  f2: number;
  f3: number;
  durSec: number;
  voiced: boolean;
  fricative: number;
  amp: number;
}

// Formant table (Hz) for vowels and consonants (Klatt vocal-tract approximations)
const PHONEME_TABLE: Record<string, PhonemeSpec> = {
  a: { f1: 730, f2: 1090, f3: 2440, durSec: 0.125, voiced: true, fricative: 0.02, amp: 1.0 },
  e: { f1: 530, f2: 1840, f3: 2480, durSec: 0.115, voiced: true, fricative: 0.02, amp: 0.95 },
  i: { f1: 270, f2: 2290, f3: 3010, durSec: 0.115, voiced: true, fricative: 0.02, amp: 0.92 },
  o: { f1: 570, f2: 840, f3: 2410, durSec: 0.125, voiced: true, fricative: 0.02, amp: 1.0 },
  u: { f1: 300, f2: 870, f3: 2240, durSec: 0.125, voiced: true, fricative: 0.02, amp: 0.95 },
  y: { f1: 320, f2: 2150, f3: 2900, durSec: 0.09, voiced: true, fricative: 0.04, amp: 0.85 },
  b: { f1: 200, f2: 800, f3: 2100, durSec: 0.055, voiced: true, fricative: 0.15, amp: 0.55 },
  p: { f1: 220, f2: 900, f3: 2200, durSec: 0.055, voiced: false, fricative: 0.7, amp: 0.45 },
  d: { f1: 240, f2: 1700, f3: 2600, durSec: 0.055, voiced: true, fricative: 0.18, amp: 0.55 },
  t: { f1: 260, f2: 1800, f3: 2800, durSec: 0.055, voiced: false, fricative: 0.85, amp: 0.5 },
  g: { f1: 240, f2: 1350, f3: 2300, durSec: 0.06, voiced: true, fricative: 0.16, amp: 0.58 },
  k: { f1: 260, f2: 1450, f3: 2400, durSec: 0.06, voiced: false, fricative: 0.8, amp: 0.52 },
  c: { f1: 260, f2: 1500, f3: 2500, durSec: 0.06, voiced: false, fricative: 0.78, amp: 0.5 },
  s: { f1: 320, f2: 2400, f3: 4800, durSec: 0.09, voiced: false, fricative: 1.0, amp: 0.6 },
  z: { f1: 300, f2: 2200, f3: 4400, durSec: 0.085, voiced: true, fricative: 0.65, amp: 0.7 },
  f: { f1: 320, f2: 1500, f3: 3600, durSec: 0.08, voiced: false, fricative: 0.9, amp: 0.48 },
  v: { f1: 280, f2: 1400, f3: 3200, durSec: 0.08, voiced: true, fricative: 0.45, amp: 0.65 },
  h: { f1: 500, f2: 1500, f3: 2500, durSec: 0.075, voiced: false, fricative: 0.85, amp: 0.42 },
  m: { f1: 280, f2: 900, f3: 2200, durSec: 0.085, voiced: true, fricative: 0.02, amp: 0.72 },
  n: { f1: 280, f2: 1450, f3: 2500, durSec: 0.08, voiced: true, fricative: 0.03, amp: 0.72 },
  l: { f1: 360, f2: 1150, f3: 2600, durSec: 0.08, voiced: true, fricative: 0.04, amp: 0.78 },
  r: { f1: 420, f2: 1300, f3: 1650, durSec: 0.08, voiced: true, fricative: 0.05, amp: 0.8 },
  w: { f1: 310, f2: 750, f3: 2250, durSec: 0.08, voiced: true, fricative: 0.03, amp: 0.82 },
  j: { f1: 280, f2: 2100, f3: 3100, durSec: 0.075, voiced: true, fricative: 0.5, amp: 0.68 },
  q: { f1: 260, f2: 1400, f3: 2300, durSec: 0.06, voiced: false, fricative: 0.75, amp: 0.5 },
  x: { f1: 300, f2: 2100, f3: 4200, durSec: 0.09, voiced: false, fricative: 0.95, amp: 0.55 },
  sh: { f1: 320, f2: 1950, f3: 3500, durSec: 0.095, voiced: false, fricative: 1.0, amp: 0.62 },
  ch: { f1: 300, f2: 2050, f3: 3600, durSec: 0.085, voiced: false, fricative: 0.95, amp: 0.6 },
  th: { f1: 320, f2: 1600, f3: 3400, durSec: 0.08, voiced: false, fricative: 0.82, amp: 0.45 },
  oo: { f1: 310, f2: 820, f3: 2250, durSec: 0.145, voiced: true, fricative: 0.02, amp: 0.98 },
  ee: { f1: 270, f2: 2320, f3: 3050, durSec: 0.145, voiced: true, fricative: 0.02, amp: 0.96 },
  ' ': { f1: 400, f2: 1200, f3: 2400, durSec: 0.09, voiced: false, fricative: 0, amp: 0 },
  ',': { f1: 400, f2: 1200, f3: 2400, durSec: 0.16, voiced: false, fricative: 0, amp: 0 },
  '.': { f1: 400, f2: 1200, f3: 2400, durSec: 0.22, voiced: false, fricative: 0, amp: 0 },
};

const DIGIT_WORDS: Record<string, string> = {
  '0': 'zero', '1': 'one', '2': 'two', '3': 'three', '4': 'four',
  '5': 'five', '6': 'six', '7': 'seven', '8': 'eight', '9': 'nine',
};

function textToPhonemes(rawText: string): PhonemeSpec[] {
  const expanded = rawText
    .toLowerCase()
    .replace(/[0-9]/g, (d) => ` ${DIGIT_WORDS[d] || ''} `)
    .replace(/[^a-z ,.!?\n]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  const out: PhonemeSpec[] = [];
  let i = 0;
  while (i < expanded.length) {
    const two = expanded.slice(i, i + 2);
    if (PHONEME_TABLE[two]) {
      out.push(PHONEME_TABLE[two]);
      i += 2;
      continue;
    }
    const ch = expanded[i];
    if (ch === '!' || ch === '?') {
      out.push(PHONEME_TABLE['.']);
    } else if (PHONEME_TABLE[ch]) {
      out.push(PHONEME_TABLE[ch]);
    }
    i++;
  }
  if (out.length === 0) {
    out.push(PHONEME_TABLE.a, PHONEME_TABLE.o);
  }
  return out;
}

class Resonator {
  private y1 = 0;
  private y2 = 0;
  private a = 0;
  private b = 0;
  private c = 0;

  set(freq: number, bw: number, sr: number) {
    const f = Math.max(80, Math.min(sr * 0.44, freq));
    const r = Math.exp((-Math.PI * bw) / sr);
    this.c = -(r * r);
    this.b = 2 * r * Math.cos((2 * Math.PI * f) / sr);
    this.a = 1 - this.b - this.c;
  }

  process(x: number): number {
    const y = this.a * x + this.b * this.y1 + this.c * this.y2;
    this.y2 = this.y1;
    this.y1 = y;
    return y;
  }
}

export interface RetroSpeechOptions {
  text: string;
  voiceId: RetroVoiceId;
  pitchHz?: number;
  speed?: number;
  formantShift?: number;
  bitcrush?: number;
  sampleRate?: number;
}

/**
 * Pure DSP offline Retro Formant Speech Synthesizer -> Float32Array PCM (mono).
 * Works in browser, Electron, and Node unit tests with zero external dependencies.
 */
export function synthesizeRetroSpeechPcm(opts: RetroSpeechOptions): { samples: Float32Array; sampleRate: number } {
  const sr = opts.sampleRate ?? 48000;
  const preset = RETRO_VOICE_PRESETS.find((p) => p.id === opts.voiceId) || RETRO_VOICE_PRESETS[0];
  const basePitch = Math.max(45, Math.min(420, opts.pitchHz ?? preset.defaultPitchHz));
  const speed = Math.max(0.4, Math.min(2.2, opts.speed ?? preset.defaultSpeed));
  const fShift = Math.max(0.55, Math.min(1.8, opts.formantShift ?? preset.formantShift));
  const crush = Math.max(0, Math.min(1, opts.bitcrush ?? preset.bitcrush));

  const phonemes = textToPhonemes(opts.text);
  const segLengths = phonemes.map((p) => Math.max(256, Math.round((p.durSec / speed) * sr)));
  const totalSamples = segLengths.reduce((a, b) => a + b, 0) + Math.round(sr * 0.08);
  const out = new Float32Array(totalSamples);

  const r1 = new Resonator();
  const r2 = new Resonator();
  const r3 = new Resonator();

  let phase1 = 0;
  let phase2 = 0;
  let phase3 = 0;
  let ringPhase = 0;
  let seed = 424242;
  const rand = () => {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    return (seed / 4294967296) * 2 - 1;
  };

  let curF1 = phonemes[0].f1 * fShift;
  let curF2 = phonemes[0].f2 * fShift;
  let curF3 = phonemes[0].f3 * fShift;

  let cursor = 0;
  let heldSample = 0;
  const holdStep = crush > 0.05 ? Math.max(1, Math.round(1 + crush * 7)) : 1;
  const quantLevels = crush > 0.05 ? Math.max(12, Math.round(256 * (1 - crush * 0.82))) : 0;

  for (let pIdx = 0; pIdx < phonemes.length; pIdx++) {
    const ph = phonemes[pIdx];
    const segLen = segLengths[pIdx];
    const targetF1 = ph.f1 * fShift;
    const targetF2 = ph.f2 * fShift;
    const targetF3 = ph.f3 * fShift;

    for (let i = 0; i < segLen; i++) {
      const globalIdx = cursor + i;
      const globalProg = globalIdx / Math.max(1, totalSamples);
      const localProg = i / segLen;

      // Smooth formant glide between phonemes (classic coarticulation)
      const smooth = 0.008;
      curF1 += (targetF1 - curF1) * smooth;
      curF2 += (targetF2 - curF2) * smooth;
      curF3 += (targetF3 - curF3) * smooth;

      if (i % 16 === 0) {
        r1.set(curF1, 75, sr);
        r2.set(curF2, 110, sr);
        r3.set(curF3, 155, sr);
      }

      // Subtle natural downward pitch intonation contour
      const pitchHz = basePitch * (1.06 - globalProg * 0.16);
      phase1 = (phase1 + pitchHz / sr) % 1;
      // Rich glottal saw/pulse wave
      let glottal = 2 * phase1 - 1;
      if (preset.chordHarmonics) {
        phase2 = (phase2 + (pitchHz * 1.25) / sr) % 1; // Major 3rd / minor chord carrier
        phase3 = (phase3 + (pitchHz * 1.5) / sr) % 1;  // Perfect 5th
        glottal = 0.5 * glottal + 0.3 * (2 * phase2 - 1) + 0.28 * (2 * phase3 - 1);
      }

      const noise = rand();
      const voiceAmt = ph.voiced ? 1 - preset.noiseMix : 0;
      const noiseAmt = ph.voiced ? Math.max(ph.fricative, preset.noiseMix) : ph.fricative;
      const exc = glottal * voiceAmt + noise * noiseAmt * 0.75;

      // Parallel formant filter bank
      let sig = r1.process(exc) * 1.15 + r2.process(exc) * 0.85 + r3.process(exc) * 0.42;

      // Smooth segment envelope
      const fadeIn = Math.min(1, localProg * 8);
      const fadeOut = Math.min(1, (1 - localProg) * 8);
      sig *= ph.amp * fadeIn * fadeOut;

      if (preset.ringModHz > 0) {
        ringPhase += (2 * Math.PI * preset.ringModHz) / sr;
        sig *= 0.55 + 0.45 * Math.sin(ringPhase);
      }

      // Retro sample-rate / bit-depth crunch (SAM 1982 aesthetic)
      if (holdStep > 1) {
        if (globalIdx % holdStep === 0) heldSample = sig;
        sig = heldSample;
      }
      if (quantLevels > 0) {
        sig = Math.round(sig * quantLevels) / quantLevels;
      }

      out[globalIdx] = Math.tanh(sig * 1.8);
    }
    cursor += segLen;
  }

  // Normalize cleanly to -0.8 dBFS
  let peak = 1e-6;
  for (let i = 0; i < out.length; i++) {
    const a = Math.abs(out[i]);
    if (a > peak) peak = a;
  }
  const g = 0.91 / peak;
  for (let i = 0; i < out.length; i++) out[i] *= g;

  return { samples: out, sampleRate: sr };
}

export function createRetroSpeechAudioBuffer(ctx: BaseAudioContext, opts: RetroSpeechOptions): AudioBuffer {
  const { samples, sampleRate } = synthesizeRetroSpeechPcm({ ...opts, sampleRate: ctx.sampleRate });
  const buf = ctx.createBuffer(1, samples.length, sampleRate);
  buf.getChannelData(0).set(samples);
  return buf;
}
