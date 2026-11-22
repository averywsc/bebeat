import type { DrumSynthParams, DrumVoiceName, SamplerParams } from '../../types/daw';

let sharedNoiseBuffer: AudioBuffer | null = null;
function getNoiseBuffer(ctx: BaseAudioContext): AudioBuffer {
  if (sharedNoiseBuffer && sharedNoiseBuffer.sampleRate === ctx.sampleRate && !(ctx instanceof OfflineAudioContext)) {
    return sharedNoiseBuffer;
  }
  const len = Math.floor(ctx.sampleRate * 1.2);
  const buf = ctx.createBuffer(1, len, ctx.sampleRate);
  const ch = buf.getChannelData(0);
  let seed = 1337;
  for (let i = 0; i < len; i++) {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    ch[i] = (seed / 4294967296) * 2 - 1;
  }
  if (!(ctx instanceof OfflineAudioContext)) {
    sharedNoiseBuffer = buf;
  }
  return buf;
}

export function triggerSynthesizedDrum(
  ctx: BaseAudioContext,
  dest: AudioNode,
  voice: DrumVoiceName,
  params: DrumSynthParams,
  opts: { time: number; velocity: number; pitchSemi?: number; pan?: number }
): void {
  const t0 = Math.max(ctx.currentTime, opts.time);
  const vel = Math.max(0.02, opts.velocity);
  const tuneMul = Math.pow(2, (params.tuneSemi + (opts.pitchSemi ?? 0)) / 12);
  const panner = ctx.createStereoPanner();
  panner.pan.setValueAtTime(Math.max(-1, Math.min(1, opts.pan ?? 0)), t0);
  panner.connect(dest);

  const outGain = ctx.createGain();
  outGain.gain.setValueAtTime(vel * 0.85, t0);
  outGain.connect(panner);

  if (voice === 'bd') {
    const osc = ctx.createOscillator();
    osc.type = 'sine';
    const startHz = 165 * tuneMul;
    const endHz = 44 * tuneMul;
    osc.frequency.setValueAtTime(startHz, t0);
    osc.frequency.exponentialRampToValueAtTime(Math.max(24, endHz), t0 + 0.055);
    const amp = ctx.createGain();
    const dec = Math.max(0.08, params.decay * 1.15);
    amp.gain.setValueAtTime(1.0, t0);
    amp.gain.exponentialRampToValueAtTime(0.0001, t0 + dec);
    osc.connect(amp).connect(outGain);
    osc.start(t0);
    osc.stop(t0 + dec + 0.03);
  } else if (voice === 'sn' || voice === 'cp') {
    const noise = ctx.createBufferSource();
    noise.buffer = getNoiseBuffer(ctx);
    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.setValueAtTime((voice === 'cp' ? 1350 : 2100) * tuneMul, t0);
    bp.Q.setValueAtTime(voice === 'cp' ? 1.8 : 0.9, t0);
    const nGain = ctx.createGain();
    const dec = Math.max(0.06, params.decay * 0.7);
    if (voice === 'cp') {
      nGain.gain.setValueAtTime(0.001, t0);
      nGain.gain.linearRampToValueAtTime(0.9, t0 + 0.002);
      nGain.gain.setValueAtTime(0.25, t0 + 0.011);
      nGain.gain.linearRampToValueAtTime(0.95, t0 + 0.014);
      nGain.gain.setValueAtTime(0.3, t0 + 0.023);
      nGain.gain.linearRampToValueAtTime(1.0, t0 + 0.026);
      nGain.gain.exponentialRampToValueAtTime(0.0001, t0 + dec);
    } else {
      nGain.gain.setValueAtTime(0.85 * params.snap, t0);
      nGain.gain.exponentialRampToValueAtTime(0.0001, t0 + dec);
      // Snare tonal body
      const body = ctx.createOscillator();
      body.type = 'triangle';
      body.frequency.setValueAtTime(215 * tuneMul, t0);
      body.frequency.exponentialRampToValueAtTime(120 * tuneMul, t0 + 0.07);
      const bGain = ctx.createGain();
      bGain.gain.setValueAtTime(0.6, t0);
      bGain.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.12);
      body.connect(bGain).connect(outGain);
      body.start(t0);
      body.stop(t0 + 0.14);
    }
    noise.connect(bp).connect(nGain).connect(outGain);
    noise.start(t0);
    noise.stop(t0 + dec + 0.03);
  } else if (voice === 'hh' || voice === 'oh') {
    const noise = ctx.createBufferSource();
    noise.buffer = getNoiseBuffer(ctx);
    const hp = ctx.createBiquadFilter();
    hp.type = 'highpass';
    hp.frequency.setValueAtTime(6800 * tuneMul, t0);
    const g = ctx.createGain();
    const dec = voice === 'oh' ? Math.max(0.18, params.decay * 1.1) : Math.max(0.03, params.decay * 0.22);
    g.gain.setValueAtTime(0.55, t0);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dec);
    noise.connect(hp).connect(g).connect(outGain);
    noise.start(t0);
    noise.stop(t0 + dec + 0.02);
  } else {
    // rim / lt / perc
    const osc = ctx.createOscillator();
    osc.type = voice === 'lt' ? 'sine' : 'triangle';
    const baseHz = (voice === 'lt' ? 130 : voice === 'rim' ? 560 : 440) * tuneMul;
    osc.frequency.setValueAtTime(baseHz * 1.4, t0);
    osc.frequency.exponentialRampToValueAtTime(Math.max(40, baseHz), t0 + 0.05);
    const g = ctx.createGain();
    const dec = voice === 'lt' ? 0.28 : 0.11;
    g.gain.setValueAtTime(0.75, t0);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dec);
    osc.connect(g).connect(outGain);
    osc.start(t0);
    osc.stop(t0 + dec + 0.02);
  }
}

export function triggerSampleBuffer(
  ctx: BaseAudioContext,
  dest: AudioNode,
  buffer: AudioBuffer,
  opts: {
    time: number;
    velocity: number;
    pitchSemi?: number;
    pan?: number;
    cutoff?: number;
    startNorm?: number;
    endNorm?: number;
    duration?: number;
    samplerParams?: SamplerParams;
  }
): void {
  const t0 = Math.max(ctx.currentTime, opts.time);
  const src = ctx.createBufferSource();
  src.buffer = buffer;
  const rate = Math.pow(2, (opts.pitchSemi ?? 0) / 12);
  src.playbackRate.setValueAtTime(rate, t0);

  const filter = ctx.createBiquadFilter();
  filter.type = 'lowpass';
  filter.frequency.setValueAtTime(Math.max(80, Math.min(19000, opts.cutoff ?? 17500)), t0);

  const gain = ctx.createGain();
  const peak = Math.max(0.01, opts.velocity * 0.9);
  gain.gain.setValueAtTime(peak, t0);

  const panner = ctx.createStereoPanner();
  panner.pan.setValueAtTime(Math.max(-1, Math.min(1, opts.pan ?? 0)), t0);

  src.connect(filter).connect(gain).connect(panner).connect(dest);

  const offset = Math.max(0, (opts.startNorm ?? 0) * buffer.duration);
  const maxDur = Math.max(0.02, ((opts.endNorm ?? 1) - (opts.startNorm ?? 0)) * buffer.duration);
  const playDur = opts.duration ? Math.min(maxDur, opts.duration + 0.25) : maxDur;
  if (opts.samplerParams?.loop) {
    src.loop = true;
    src.loopStart = offset;
    src.loopEnd = Math.min(buffer.duration, offset + maxDur);
  }
  src.start(t0, offset, opts.samplerParams?.loop ? undefined : playDur);
  if (opts.samplerParams?.loop && opts.duration) {
    gain.gain.setValueAtTime(peak, t0 + opts.duration);
    gain.gain.exponentialRampToValueAtTime(0.0001, t0 + opts.duration + Math.max(0.03, opts.samplerParams.ampEnv.release));
    src.stop(t0 + opts.duration + opts.samplerParams.ampEnv.release + 0.02);
  }
}
