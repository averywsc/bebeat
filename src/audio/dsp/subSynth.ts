import type { SubSynthParams } from '../../types/daw';
import { midiToFreq } from '../../livecode/musicTheory';

function makeSaturationCurve(drive: number): Float32Array<ArrayBuffer> {
  const n = 512;
  const curve = new Float32Array(new ArrayBuffer(n * 4));
  const k = 1 + drive * 28;
  for (let i = 0; i < n; i++) {
    const x = (i * 2) / n - 1;
    curve[i] = Math.tanh(x * k) / Math.tanh(k);
  }
  return curve;
}

function buildMorphPeriodicWave(ctx: BaseAudioContext, wavetableName: string, morph: number): PeriodicWave {
  const harmonics = 32;
  const real = new Float32Array(harmonics);
  const imag = new Float32Array(harmonics);
  const m = Math.max(0, Math.min(1, morph));

  for (let k = 1; k < harmonics; k++) {
    if (wavetableName === 'acid_morph') {
      const saw = ((k % 2 === 0 ? -1 : 1) / k) * 0.7;
      const sq = k % 2 === 1 ? 0.9 / k : 0;
      imag[k] = saw * (1 - m) + sq * m;
    } else if (wavetableName === 'glass_fm') {
      imag[k] = (Math.sin(k * (1.2 + m * 2.4)) / (k * 0.85)) * Math.exp(-k * 0.08);
    } else if (wavetableName === 'warm_organ') {
      const drawbar = k <= 8 ? 1 / Math.pow(k, 0.75) : 0.15 / k;
      imag[k] = drawbar * (0.5 + 0.5 * Math.cos(k * m * 1.4));
    } else {
      // formant_sweep
      const center = 2 + m * 10;
      const bell = Math.exp(-0.18 * (k - center) * (k - center));
      imag[k] = (0.35 / k + 0.75 * bell) * (k % 2 === 1 ? 1 : 0.65);
    }
  }
  return ctx.createPeriodicWave(real, imag, { disableNormalization: false });
}

export interface SynthTriggerOpts {
  midi: number;
  time: number;
  duration: number;
  velocity: number;
  pan?: number;
  cutoffOverride?: number;
  detuneOffset?: number;
  slideFromMidi?: number;
}

export function triggerSubSynthNote(
  ctx: BaseAudioContext,
  dest: AudioNode,
  params: SubSynthParams,
  opts: SynthTriggerOpts
): void {
  const t0 = Math.max(ctx.currentTime, opts.time);
  const dur = Math.max(0.03, opts.duration);
  const baseFreq = midiToFreq(opts.midi);
  const startFreq = opts.slideFromMidi !== undefined ? midiToFreq(opts.slideFromMidi) : baseFreq;

  const filter = ctx.createBiquadFilter();
  filter.type = params.filterMode;
  const baseCutoff = Math.max(40, Math.min(18000, opts.cutoffOverride ?? params.cutoff));
  filter.Q.setValueAtTime(Math.max(0.1, Math.min(22, params.resonance)), t0);

  // Filter ADSR envelope
  const fEnv = params.filterEnv;
  const fPeak = Math.max(40, Math.min(18500, baseCutoff + params.filterEnvAmount * opts.velocity));
  const fSus = Math.max(40, Math.min(18500, baseCutoff + params.filterEnvAmount * fEnv.sustain * opts.velocity));
  filter.frequency.setValueAtTime(baseCutoff, t0);
  filter.frequency.linearRampToValueAtTime(fPeak, t0 + Math.max(0.002, fEnv.attack));
  filter.frequency.exponentialRampToValueAtTime(Math.max(40, fSus), t0 + fEnv.attack + Math.max(0.005, fEnv.decay));
  filter.frequency.setTargetAtTime(baseCutoff, t0 + dur, Math.max(0.015, fEnv.release * 0.35));

  // Optional soft saturation drive
  let postFilter: AudioNode = filter;
  if (params.drive > 0.02) {
    const shaper = ctx.createWaveShaper();
    shaper.curve = makeSaturationCurve(params.drive);
    shaper.oversample = '2x';
    filter.connect(shaper);
    postFilter = shaper;
  }

  // Amplitude ADSR envelope
  const amp = ctx.createGain();
  const aEnv = params.ampEnv;
  const peakAmp = Math.max(0.01, opts.velocity * 0.42);
  const susAmp = Math.max(0.0002, peakAmp * Math.max(0.02, aEnv.sustain));
  const releaseTime = Math.max(0.02, aEnv.release);
  const stopTime = t0 + dur + releaseTime + 0.04;

  amp.gain.setValueAtTime(0.0001, t0);
  amp.gain.linearRampToValueAtTime(peakAmp, t0 + Math.max(0.002, aEnv.attack));
  amp.gain.exponentialRampToValueAtTime(susAmp, t0 + aEnv.attack + Math.max(0.005, aEnv.decay));
  amp.gain.setValueAtTime(susAmp, t0 + dur);
  amp.gain.exponentialRampToValueAtTime(0.0001, t0 + dur + releaseTime);

  const masterPan = ctx.createStereoPanner();
  masterPan.pan.setValueAtTime(Math.max(-1, Math.min(1, opts.pan ?? 0)), t0);

  postFilter.connect(amp);
  amp.connect(masterPan);
  masterPan.connect(dest);

  // Syncable LFO
  let lfoOsc: OscillatorNode | null = null;
  if (params.lfoDepth > 0.005 && params.lfoRateHz > 0.02) {
    lfoOsc = ctx.createOscillator();
    lfoOsc.type = 'sine';
    lfoOsc.frequency.setValueAtTime(params.lfoRateHz, t0);
    const lfoGain = ctx.createGain();
    if (params.lfoTarget === 'cutoff') {
      lfoGain.gain.setValueAtTime(params.lfoDepth * 1400, t0);
      lfoOsc.connect(lfoGain).connect(filter.frequency);
    } else if (params.lfoTarget === 'pan') {
      lfoGain.gain.setValueAtTime(params.lfoDepth * 0.85, t0);
      lfoOsc.connect(lfoGain).connect(masterPan.pan);
    }
    lfoOsc.start(t0);
    lfoOsc.stop(stopTime);
  }

  const voices = Math.max(1, Math.min(5, Math.round(params.unisonVoices)));
  const voiceNorm = 1 / Math.sqrt(voices);
  const wtWave =
    params.osc1Wave === 'wavetable' || params.osc2Wave === 'wavetable'
      ? buildMorphPeriodicWave(ctx, params.wavetableName, params.wavetableMorph)
      : null;

  for (let v = 0; v < voices; v++) {
    const spreadFrac = voices === 1 ? 0 : (v / (voices - 1)) * 2 - 1;
    const uDetune = spreadFrac * params.unisonDetune + (opts.detuneOffset ?? 0);
    const uPan = ctx.createStereoPanner();
    uPan.pan.setValueAtTime(spreadFrac * params.stereoSpread * 0.8, t0);
    uPan.connect(filter);

    // Oscillator 1
    if (params.oscMix < 0.98) {
      const osc1 = ctx.createOscillator();
      if (params.osc1Wave === 'wavetable' && wtWave) osc1.setPeriodicWave(wtWave);
      else osc1.type = params.osc1Wave === 'wavetable' ? 'sawtooth' : params.osc1Wave;
      osc1.frequency.setValueAtTime(startFreq, t0);
      if (startFreq !== baseFreq && params.glide > 0) {
        osc1.frequency.exponentialRampToValueAtTime(baseFreq, t0 + Math.min(dur, params.glide));
      }
      osc1.detune.setValueAtTime(uDetune, t0);
      if (lfoOsc && params.lfoTarget === 'pitch') {
        const pg = ctx.createGain();
        pg.gain.setValueAtTime(params.lfoDepth * 65, t0);
        lfoOsc.connect(pg).connect(osc1.detune);
      }
      const g1 = ctx.createGain();
      g1.gain.setValueAtTime((1 - params.oscMix) * voiceNorm, t0);
      osc1.connect(g1).connect(uPan);
      osc1.start(t0);
      osc1.stop(stopTime);
    }

    // Oscillator 2
    if (params.oscMix > 0.02) {
      const osc2 = ctx.createOscillator();
      if (params.osc2Wave === 'wavetable' && wtWave) osc2.setPeriodicWave(wtWave);
      else osc2.type = params.osc2Wave === 'wavetable' ? 'triangle' : params.osc2Wave;
      const freq2 = baseFreq * Math.pow(2, params.osc2Semi / 12);
      const startFreq2 = startFreq * Math.pow(2, params.osc2Semi / 12);
      osc2.frequency.setValueAtTime(startFreq2, t0);
      if (startFreq2 !== freq2 && params.glide > 0) {
        osc2.frequency.exponentialRampToValueAtTime(freq2, t0 + Math.min(dur, params.glide));
      }
      osc2.detune.setValueAtTime(uDetune + params.osc2Detune, t0);
      const g2 = ctx.createGain();
      g2.gain.setValueAtTime(params.oscMix * voiceNorm, t0);
      osc2.connect(g2).connect(uPan);
      osc2.start(t0);
      osc2.stop(stopTime);
    }
  }
}
