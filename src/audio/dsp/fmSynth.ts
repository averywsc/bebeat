import type { FmSynthParams } from '../../types/daw';
import { midiToFreq } from '../../livecode/musicTheory';

export interface FmTriggerOpts {
  midi: number;
  time: number;
  duration: number;
  velocity: number;
  pan?: number;
  cutoffOverride?: number;
  modIndexOverride?: number;
}

/**
 * 4-Operator FM/PM Synthesizer with 6 classic algorithms:
 *  Alg 0: 4 -> 3 -> 2 -> 1 (Full Serial Stack)
 *  Alg 1: (4 -> 3) + (2 -> 1) (Dual 2-Op Stacks — Electric Piano)
 *  Alg 2: (4 + 3 + 2) -> 1 (3 Modulators into 1 Carrier — Metallic Bells)
 *  Alg 3: 4 -> (3 + 2) -> 1 (Y-Branch Modular Pluck)
 *  Alg 4: (4 -> 3 -> 2) + 1 (3-Stack + Clean Sub Carrier)
 *  Alg 5: 4 + 3 + 2 + 1 (4-Op Additive Organ)
 */
export function triggerFmSynthNote(
  ctx: BaseAudioContext,
  dest: AudioNode,
  params: FmSynthParams,
  opts: FmTriggerOpts
): void {
  const t0 = Math.max(ctx.currentTime, opts.time);
  const dur = Math.max(0.03, opts.duration);
  const baseFreq = midiToFreq(opts.midi);
  const modIndex = Math.max(0, Math.min(18, opts.modIndexOverride ?? params.modIndex));

  const filter = ctx.createBiquadFilter();
  filter.type = 'lowpass';
  filter.frequency.setValueAtTime(Math.max(80, Math.min(18500, opts.cutoffOverride ?? params.cutoff)), t0);
  filter.Q.setValueAtTime(Math.max(0.2, Math.min(16, params.resonance)), t0);

  const outGain = ctx.createGain();
  outGain.gain.setValueAtTime(Math.max(0.01, opts.velocity * 0.36), t0);

  const panner = ctx.createStereoPanner();
  panner.pan.setValueAtTime(Math.max(-1, Math.min(1, opts.pan ?? 0)), t0);

  filter.connect(outGain);
  outGain.connect(panner);
  panner.connect(dest);

  let maxRelease = 0.1;
  const ops = params.operators.map((op) => {
    const osc = ctx.createOscillator();
    osc.type = 'sine';
    const opFreq = baseFreq * Math.max(0.25, op.ratio);
    osc.frequency.setValueAtTime(opFreq, t0);
    osc.detune.setValueAtTime(op.detune, t0);

    const envGain = ctx.createGain();
    const peak = Math.max(0.001, op.level);
    const sus = Math.max(0.0002, peak * Math.max(0.01, op.env.sustain));
    const rel = Math.max(0.02, op.env.release);
    if (rel > maxRelease) maxRelease = rel;

    envGain.gain.setValueAtTime(0.0001, t0);
    envGain.gain.linearRampToValueAtTime(peak, t0 + Math.max(0.0015, op.env.attack));
    envGain.gain.exponentialRampToValueAtTime(sus, t0 + op.env.attack + Math.max(0.004, op.env.decay));
    envGain.gain.setValueAtTime(sus, t0 + dur);
    envGain.gain.exponentialRampToValueAtTime(0.0001, t0 + dur + rel);

    osc.connect(envGain);
    return { osc, envGain, freq: opFreq };
  });

  // Helper to connect modulator `src` -> carrier `dst` scaled by FM index & frequency
  const modConnect = (srcIdx: number, dstIdx: number, scale = 1.0) => {
    const depth = ctx.createGain();
    depth.gain.setValueAtTime(ops[dstIdx].freq * modIndex * 0.55 * scale, t0);
    ops[srcIdx].envGain.connect(depth);
    depth.connect(ops[dstIdx].osc.frequency);
  };

  // Optional Op 4 self-feedback approximation using a subtle high-harmonic wave
  if (params.feedback > 0.05) {
    const fbOsc = ctx.createOscillator();
    fbOsc.type = 'sawtooth';
    fbOsc.frequency.setValueAtTime(ops[3].freq, t0);
    const fbGain = ctx.createGain();
    fbGain.gain.setValueAtTime(ops[3].freq * params.feedback * 0.35, t0);
    fbOsc.connect(fbGain).connect(ops[3].osc.frequency);
    fbOsc.start(t0);
    fbOsc.stop(t0 + dur + maxRelease + 0.05);
  }

  switch (params.algorithm) {
    case 0: // 4 -> 3 -> 2 -> 1
      modConnect(3, 2, 0.7);
      modConnect(2, 1, 0.85);
      modConnect(1, 0, 1.0);
      ops[0].envGain.connect(filter);
      break;
    case 1: // (4 -> 3) + (2 -> 1)
      modConnect(3, 2, 0.9);
      modConnect(1, 0, 0.9);
      ops[0].envGain.connect(filter);
      ops[2].envGain.connect(filter);
      break;
    case 2: // (4 + 3 + 2) -> 1
      modConnect(3, 0, 0.7);
      modConnect(2, 0, 0.8);
      modConnect(1, 0, 0.9);
      ops[0].envGain.connect(filter);
      break;
    case 3: // 4 -> (3 + 2) -> 1
      modConnect(3, 2, 0.75);
      modConnect(3, 1, 0.75);
      modConnect(2, 0, 0.85);
      modConnect(1, 0, 0.85);
      ops[0].envGain.connect(filter);
      break;
    case 4: // (4 -> 3 -> 2) + 1
      modConnect(3, 2, 0.8);
      modConnect(2, 1, 0.9);
      ops[1].envGain.connect(filter);
      ops[0].envGain.connect(filter);
      break;
    case 5: // Additive 4 + 3 + 2 + 1
    default:
      ops.forEach((op) => op.envGain.connect(filter));
      break;
  }

  const stopAt = t0 + dur + maxRelease + 0.05;
  ops.forEach((op) => {
    op.osc.start(t0);
    op.osc.stop(stopAt);
  });
}
