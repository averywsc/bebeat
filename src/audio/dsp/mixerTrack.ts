import type { FxSlot, MixerTrack } from '../../types/daw';

const reverbImpulseCache = new Map<string, AudioBuffer>();

function createReverbImpulse(ctx: BaseAudioContext, decaySec: number, dampingHz: number): AudioBuffer {
  const key = `${ctx.sampleRate}:${decaySec.toFixed(2)}:${Math.round(dampingHz)}`;
  const cached = !(ctx instanceof OfflineAudioContext) ? reverbImpulseCache.get(key) : undefined;
  if (cached) return cached;

  const len = Math.max(1024, Math.floor(ctx.sampleRate * Math.min(6, Math.max(0.2, decaySec))));
  const buf = ctx.createBuffer(2, len, ctx.sampleRate);
  const dampAlpha = Math.min(0.95, Math.max(0.05, dampingHz / (ctx.sampleRate * 0.5)));

  for (let ch = 0; ch < 2; ch++) {
    const data = buf.getChannelData(ch);
    let seed = ch === 0 ? 12345 : 67891;
    let lp = 0;
    for (let i = 0; i < len; i++) {
      seed = (seed * 1664525 + 1013904223) >>> 0;
      const white = (seed / 4294967296) * 2 - 1;
      lp += dampAlpha * (white - lp);
      const env = Math.pow(1 - i / len, 2.4);
      data[i] = lp * env;
    }
  }
  if (!(ctx instanceof OfflineAudioContext)) {
    reverbImpulseCache.set(key, buf);
  }
  return buf;
}

function makeDriveCurve(drive: number): Float32Array<ArrayBuffer> {
  const n = 512;
  const curve = new Float32Array(new ArrayBuffer(n * 4));
  const k = 1 + drive * 32;
  for (let i = 0; i < n; i++) {
    const x = (i * 2) / n - 1;
    curve[i] = Math.tanh(x * k) / Math.tanh(k);
  }
  return curve;
}

export interface FxChainNode {
  input: AudioNode;
  output: AudioNode;
  disconnect(): void;
}

export function buildFxSlotNode(ctx: BaseAudioContext, slot: FxSlot, bpm: number): FxChainNode {
  const input = ctx.createGain();
  const output = ctx.createGain();
  const nodes: AudioNode[] = [input, output];

  if (!slot.enabled) {
    input.connect(output);
    return { input, output, disconnect: () => nodes.forEach((n) => { try { n.disconnect(); } catch {} }) };
  }

  const p = slot.params;
  switch (slot.type) {
    case 'eq4': {
      const low = ctx.createBiquadFilter();
      low.type = 'lowshelf';
      low.frequency.value = p.lowFreq ?? 90;
      low.gain.value = p.lowGain ?? 0;

      const lowMid = ctx.createBiquadFilter();
      lowMid.type = 'peaking';
      lowMid.frequency.value = 320;
      lowMid.Q.value = 1.0;
      lowMid.gain.value = p.lowMidGain ?? 0;

      const highMid = ctx.createBiquadFilter();
      highMid.type = 'peaking';
      highMid.frequency.value = 2200;
      highMid.Q.value = 1.0;
      highMid.gain.value = p.highMidGain ?? 0;

      const high = ctx.createBiquadFilter();
      high.type = 'highshelf';
      high.frequency.value = p.highFreq ?? 8000;
      high.gain.value = p.highGain ?? 0;

      input.connect(low).connect(lowMid).connect(highMid).connect(high).connect(output);
      nodes.push(low, lowMid, highMid, high);
      break;
    }

    case 'compressor': {
      const comp = ctx.createDynamicsCompressor();
      comp.threshold.value = p.threshold ?? -14;
      comp.ratio.value = Math.max(1, p.ratio ?? 4);
      comp.attack.value = Math.max(0.001, p.attack ?? 0.008);
      comp.release.value = Math.max(0.01, p.release ?? 0.14);
      comp.knee.value = 6;
      const makeup = ctx.createGain();
      makeup.gain.value = Math.pow(10, (p.makeup ?? 0) / 20);
      input.connect(comp).connect(makeup).connect(output);
      nodes.push(comp, makeup);
      break;
    }

    case 'reverb': {
      const mix = Math.max(0, Math.min(1, p.mix ?? 0.25));
      const dry = ctx.createGain();
      const wet = ctx.createGain();
      dry.gain.value = 1 - mix * 0.6;
      wet.gain.value = mix;
      const conv = ctx.createConvolver();
      conv.buffer = createReverbImpulse(ctx, p.decay ?? 1.8, p.damping ?? 4500);
      input.connect(dry).connect(output);
      input.connect(conv).connect(wet).connect(output);
      nodes.push(dry, wet, conv);
      break;
    }

    case 'delay': {
      const mix = Math.max(0, Math.min(1, p.mix ?? 0.22));
      const dry = ctx.createGain();
      const wet = ctx.createGain();
      dry.gain.value = 1 - mix * 0.5;
      wet.gain.value = mix;
      const delaySec = Math.max(0.02, Math.min(2.0, ((p.division ?? 0.375) * 60) / Math.max(40, bpm) * 2));
      const delayNode = ctx.createDelay(2.5);
      delayNode.delayTime.value = delaySec;
      const fb = ctx.createGain();
      fb.gain.value = Math.max(0, Math.min(0.88, p.feedback ?? 0.36));
      const tone = ctx.createBiquadFilter();
      tone.type = 'lowpass';
      tone.frequency.value = p.tone ?? 3600;

      input.connect(dry).connect(output);
      input.connect(delayNode).connect(tone).connect(wet).connect(output);
      tone.connect(fb).connect(delayNode);
      nodes.push(dry, wet, delayNode, fb, tone);
      break;
    }

    case 'saturation': {
      const mix = Math.max(0, Math.min(1, p.mix ?? 0.5));
      const dry = ctx.createGain();
      const wet = ctx.createGain();
      dry.gain.value = 1 - mix;
      wet.gain.value = mix;
      const shaper = ctx.createWaveShaper();
      shaper.curve = makeDriveCurve(p.drive ?? 0.3);
      shaper.oversample = '2x';
      const tone = ctx.createBiquadFilter();
      tone.type = 'lowpass';
      tone.frequency.value = p.tone ?? 7000;
      input.connect(dry).connect(output);
      input.connect(shaper).connect(tone).connect(wet).connect(output);
      nodes.push(dry, wet, shaper, tone);
      break;
    }

    case 'filter': {
      const f = ctx.createBiquadFilter();
      const modes: BiquadFilterType[] = ['lowpass', 'highpass', 'bandpass', 'notch'];
      f.type = modes[Math.round(p.mode ?? 0) % 4];
      f.frequency.value = Math.max(40, Math.min(18000, p.cutoff ?? 4200));
      f.Q.value = Math.max(0.2, Math.min(18, p.resonance ?? 1.4));
      input.connect(f).connect(output);
      nodes.push(f);
      break;
    }

    case 'chorus': {
      const mix = Math.max(0, Math.min(1, p.mix ?? 0.28));
      const dry = ctx.createGain();
      const wet = ctx.createGain();
      dry.gain.value = 1 - mix * 0.5;
      wet.gain.value = mix;
      const delay = ctx.createDelay(0.1);
      delay.delayTime.value = 0.018;
      const lfo = ctx.createOscillator();
      lfo.type = 'sine';
      lfo.frequency.value = p.rate ?? 0.8;
      const lfoDepth = ctx.createGain();
      lfoDepth.gain.value = (p.depth ?? 0.45) * 0.008;
      lfo.connect(lfoDepth).connect(delay.delayTime);
      lfo.start();
      input.connect(dry).connect(output);
      input.connect(delay).connect(wet).connect(output);
      nodes.push(dry, wet, delay, lfo, lfoDepth);
      break;
    }
  }

  return {
    input,
    output,
    disconnect: () => {
      nodes.forEach((n) => {
        try {
          if (n instanceof OscillatorNode) n.stop();
        } catch {}
        try {
          n.disconnect();
        } catch {}
      });
    },
  };
}

export class MixerTrackNode {
  readonly id: string;
  readonly input: GainNode;
  readonly fader: GainNode;
  readonly panner: StereoPannerNode;
  readonly sendAGain: GainNode;
  readonly sendBGain: GainNode;
  readonly output: GainNode;
  readonly analyser: AnalyserNode | null;
  private fxNodes: FxChainNode[] = [];
  private fxSignature = '';
  private meterBuf = new Float32Array(256);

  constructor(private ctx: BaseAudioContext, track: MixerTrack, bpm: number) {
    this.id = track.id;
    this.input = ctx.createGain();
    this.fader = ctx.createGain();
    this.panner = ctx.createStereoPanner();
    this.sendAGain = ctx.createGain();
    this.sendBGain = ctx.createGain();
    this.output = ctx.createGain();

    if (!(ctx instanceof OfflineAudioContext)) {
      this.analyser = ctx.createAnalyser();
      this.analyser.fftSize = 256;
    } else {
      this.analyser = null;
    }

    this.fader.connect(this.panner);
    this.panner.connect(this.output);
    this.panner.connect(this.sendAGain);
    this.panner.connect(this.sendBGain);
    if (this.analyser) {
      this.panner.connect(this.analyser);
    }

    this.applyState(track, bpm, false);
  }

  applyState(track: MixerTrack, bpm: number, anySoloInsert: boolean): void {
    const isAudible =
      track.kind === 'master' || track.kind === 'send'
        ? !track.mute
        : !track.mute && (!anySoloInsert || track.solo);

    const now = this.ctx.currentTime;
    this.fader.gain.setTargetAtTime(isAudible ? track.volume : 0, now, 0.01);
    this.panner.pan.setTargetAtTime(Math.max(-1, Math.min(1, track.pan)), now, 0.01);
    this.sendAGain.gain.setTargetAtTime(isAudible ? track.sendA : 0, now, 0.01);
    this.sendBGain.gain.setTargetAtTime(isAudible ? track.sendB : 0, now, 0.01);

    const sig = JSON.stringify({ fx: track.fx, bpm: Math.round(bpm) });
    if (sig !== this.fxSignature) {
      this.fxSignature = sig;
      this.rebuildFx(track.fx, bpm);
    }
  }

  private rebuildFx(slots: FxSlot[], bpm: number): void {
    try {
      this.input.disconnect();
    } catch {}
    this.fxNodes.forEach((n) => n.disconnect());
    this.fxNodes = [];

    let cursor: AudioNode = this.input;
    for (const slot of slots) {
      const fxNode = buildFxSlotNode(this.ctx, slot, bpm);
      cursor.connect(fxNode.input);
      cursor = fxNode.output;
      this.fxNodes.push(fxNode);
    }
    cursor.connect(this.fader);
  }

  readPeak(): number {
    if (!this.analyser) return 0;
    this.analyser.getFloatTimeDomainData(this.meterBuf);
    let max = 0;
    for (let i = 0; i < this.meterBuf.length; i++) {
      const a = Math.abs(this.meterBuf[i]);
      if (a > max) max = a;
    }
    return max;
  }

  dispose(): void {
    this.fxNodes.forEach((n) => n.disconnect());
    try {
      this.input.disconnect();
      this.fader.disconnect();
      this.panner.disconnect();
      this.sendAGain.disconnect();
      this.sendBGain.disconnect();
      this.output.disconnect();
    } catch {}
  }
}
