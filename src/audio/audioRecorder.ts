import { midiToNoteName } from '../livecode/musicTheory';

export interface RecordedAudioTake {
  id: string;
  name: string;
  createdAt: string;
  durationSec: number;
  sampleRate: number;
  buffer: AudioBuffer;
}

export interface TunerReading {
  frequency: number;
  noteName: string;
  midi: number;
  cents: number;
  clarity: number;
}

/**
 * Autocorrelation chromatic pitch detector for the built-in Tuner & Pitch Correction analyzer.
 */
export function detectPitchAutocorrelation(buf: Float32Array, sampleRate: number): TunerReading | null {
  const n = buf.length;
  let rms = 0;
  for (let i = 0; i < n; i++) rms += buf[i] * buf[i];
  rms = Math.sqrt(rms / n);
  if (rms < 0.012) return null;

  const minLag = Math.floor(sampleRate / 1200);
  const maxLag = Math.min(n >> 1, Math.floor(sampleRate / 55));
  let bestLag = -1;
  let bestCorr = 0;

  for (let lag = minLag; lag <= maxLag; lag++) {
    let corr = 0;
    let normA = 0;
    let normB = 0;
    for (let i = 0; i < n - lag; i++) {
      const a = buf[i];
      const b = buf[i + lag];
      corr += a * b;
      normA += a * a;
      normB += b * b;
    }
    const denom = Math.sqrt(normA * normB) + 1e-9;
    const score = corr / denom;
    if (score > bestCorr) {
      bestCorr = score;
      bestLag = lag;
    }
  }

  if (bestLag < 0 || bestCorr < 0.55) return null;
  const freq = sampleRate / bestLag;
  const midiFloat = 69 + 12 * Math.log2(freq / 440);
  const midi = Math.round(midiFloat);
  const cents = Math.round((midiFloat - midi) * 100);
  return {
    frequency: freq,
    noteName: midiToNoteName(midi),
    midi,
    cents,
    clarity: bestCorr,
  };
}

/** Audio buffer DSP operations for Edison / Audio Editor / Flex Time / Slicex */
export function reverseAudioBuffer(ctx: BaseAudioContext, src: AudioBuffer): AudioBuffer {
  const out = ctx.createBuffer(src.numberOfChannels, src.length, src.sampleRate);
  for (let c = 0; c < src.numberOfChannels; c++) {
    const inp = src.getChannelData(c);
    const dst = out.getChannelData(c);
    for (let i = 0; i < src.length; i++) dst[i] = inp[src.length - 1 - i];
  }
  return out;
}

export function normalizeAudioBuffer(ctx: BaseAudioContext, src: AudioBuffer, targetPeak = 0.95): AudioBuffer {
  let peak = 1e-6;
  for (let c = 0; c < src.numberOfChannels; c++) {
    const d = src.getChannelData(c);
    for (let i = 0; i < d.length; i++) {
      const a = Math.abs(d[i]);
      if (a > peak) peak = a;
    }
  }
  const gain = targetPeak / peak;
  const out = ctx.createBuffer(src.numberOfChannels, src.length, src.sampleRate);
  for (let c = 0; c < src.numberOfChannels; c++) {
    const inp = src.getChannelData(c);
    const dst = out.getChannelData(c);
    for (let i = 0; i < src.length; i++) dst[i] = inp[i] * gain;
  }
  return out;
}

export function applyFadeAudioBuffer(ctx: BaseAudioContext, src: AudioBuffer, fadeInSec = 0.03, fadeOutSec = 0.08): AudioBuffer {
  const out = ctx.createBuffer(src.numberOfChannels, src.length, src.sampleRate);
  const inSamps = Math.min(src.length, Math.floor(fadeInSec * src.sampleRate));
  const outSamps = Math.min(src.length, Math.floor(fadeOutSec * src.sampleRate));
  for (let c = 0; c < src.numberOfChannels; c++) {
    const inp = src.getChannelData(c);
    const dst = out.getChannelData(c);
    for (let i = 0; i < src.length; i++) {
      let g = 1;
      if (i < inSamps) g *= i / Math.max(1, inSamps);
      if (i > src.length - outSamps) g *= (src.length - i) / Math.max(1, outSamps);
      dst[i] = inp[i] * g;
    }
  }
  return out;
}

/** Extract a sub-region [startSec..endSec] from an AudioBuffer with tiny 4ms anti-click edge fades */
export function sliceAudioBuffer(
  ctx: BaseAudioContext,
  src: AudioBuffer,
  startSec: number,
  endSec: number
): AudioBuffer {
  const sIdx = Math.max(0, Math.min(src.length - 1, Math.floor(startSec * src.sampleRate)));
  const eIdx = Math.max(sIdx + 64, Math.min(src.length, Math.floor(endSec * src.sampleRate)));
  const len = Math.max(64, eIdx - sIdx);
  const out = ctx.createBuffer(src.numberOfChannels, len, src.sampleRate);
  const fadeLen = Math.min(Math.floor(src.sampleRate * 0.004), len >> 2);

  for (let c = 0; c < src.numberOfChannels; c++) {
    const inp = src.getChannelData(c);
    const dst = out.getChannelData(c);
    for (let i = 0; i < len; i++) {
      let g = 1;
      if (i < fadeLen) g = i / Math.max(1, fadeLen);
      else if (i > len - fadeLen) g = (len - i) / Math.max(1, fadeLen);
      dst[i] = (inp[sIdx + i] ?? 0) * g;
    }
  }
  return out;
}

/** Cut/remove a region [startSec..endSec] out of an AudioBuffer */
export function deleteRegionAudioBuffer(
  ctx: BaseAudioContext,
  src: AudioBuffer,
  startSec: number,
  endSec: number
): AudioBuffer {
  const sIdx = Math.max(0, Math.min(src.length, Math.floor(startSec * src.sampleRate)));
  const eIdx = Math.max(sIdx, Math.min(src.length, Math.floor(endSec * src.sampleRate)));
  const newLen = Math.max(64, src.length - (eIdx - sIdx));
  const out = ctx.createBuffer(src.numberOfChannels, newLen, src.sampleRate);

  for (let c = 0; c < src.numberOfChannels; c++) {
    const inp = src.getChannelData(c);
    const dst = out.getChannelData(c);
    for (let i = 0; i < sIdx && i < newLen; i++) dst[i] = inp[i];
    let w = sIdx;
    for (let i = eIdx; i < src.length && w < newLen; i++) dst[w++] = inp[i];
  }
  return out;
}

export function detectTransientSlices(src: AudioBuffer, sensitivity = 0.55): number[] {
  const data = src.getChannelData(0);
  const hop = Math.floor(src.sampleRate * 0.015);
  const slices: number[] = [0];
  let prevE = 0;
  const minGapSec = 0.085;
  const threshold = 0.02 + (1 - sensitivity) * 0.14;

  for (let i = 0; i < data.length - hop; i += hop) {
    let sum = 0;
    for (let j = 0; j < hop; j++) sum += data[i + j] * data[i + j];
    const rms = Math.sqrt(sum / hop);
    const sec = i / src.sampleRate;
    if (rms - prevE > threshold && sec - slices[slices.length - 1] >= minGapSec) {
      slices.push(sec);
    }
    prevE = rms * 0.75 + prevE * 0.25;
  }
  return slices;
}

/**
 * Live Microphone / Line-In Audio Recorder with Input Monitoring, Multiple Takes, and Live Tuner Feed.
 */
export class LiveAudioRecorder {
  private stream: MediaStream | null = null;
  private sourceNode: MediaStreamAudioSourceNode | null = null;
  private monitorGain: GainNode | null = null;
  private analyser: AnalyserNode | null = null;
  private mediaRecorder: MediaRecorder | null = null;
  private chunks: Blob[] = [];
  private takes: RecordedAudioTake[] = [];
  private monitoring = false;
  private isRecording = false;
  private timeBuf = new Float32Array(2048);

  async ensureMic(ctx: AudioContext): Promise<void> {
    if (this.stream) return;
    this.stream = await navigator.mediaDevices.getUserMedia({
      audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false },
    });
    this.sourceNode = ctx.createMediaStreamSource(this.stream);
    this.analyser = ctx.createAnalyser();
    this.analyser.fftSize = 2048;
    this.monitorGain = ctx.createGain();
    this.monitorGain.gain.value = this.monitoring ? 0.85 : 0;
    this.sourceNode.connect(this.analyser);
    this.sourceNode.connect(this.monitorGain);
    this.monitorGain.connect(ctx.destination);
  }

  setInputMonitoring(enabled: boolean): void {
    this.monitoring = enabled;
    if (this.monitorGain) {
      this.monitorGain.gain.value = enabled ? 0.85 : 0;
    }
  }

  getInputMonitoring(): boolean {
    return this.monitoring;
  }

  getIsRecording(): boolean {
    return this.isRecording;
  }

  listTakes(): RecordedAudioTake[] {
    return [...this.takes];
  }

  addTakeBuffer(name: string, buffer: AudioBuffer): RecordedAudioTake {
    const take: RecordedAudioTake = {
      id: `take_${Date.now().toString(36)}_${this.takes.length + 1}`,
      name,
      createdAt: new Date().toLocaleTimeString(),
      durationSec: buffer.duration,
      sampleRate: buffer.sampleRate,
      buffer,
    };
    this.takes.unshift(take);
    return take;
  }

  async startRecording(ctx: AudioContext): Promise<void> {
    await this.ensureMic(ctx);
    if (!this.stream || this.isRecording) return;
    this.chunks = [];
    this.mediaRecorder = new MediaRecorder(this.stream);
    this.mediaRecorder.ondataavailable = (e) => {
      if (e.data.size > 0) this.chunks.push(e.data);
    };
    this.mediaRecorder.start();
    this.isRecording = true;
  }

  async stopRecording(ctx: AudioContext): Promise<RecordedAudioTake | null> {
    if (!this.mediaRecorder || !this.isRecording) return null;
    this.isRecording = false;
    return new Promise((resolve) => {
      const mr = this.mediaRecorder!;
      mr.onstop = async () => {
        try {
          const blob = new Blob(this.chunks, { type: mr.mimeType || 'audio/webm' });
          const ab = await blob.arrayBuffer();
          const decoded = await ctx.decodeAudioData(ab);
          const take = this.addTakeBuffer(`Audio Take ${this.takes.length + 1}`, decoded);
          resolve(take);
        } catch {
          resolve(null);
        }
      };
      mr.stop();
    });
  }

  readMicTuner(sampleRate: number): { level: number; tuner: TunerReading | null } {
    if (!this.analyser) return { level: 0, tuner: null };
    this.analyser.getFloatTimeDomainData(this.timeBuf);
    let max = 0;
    for (let i = 0; i < this.timeBuf.length; i++) {
      const a = Math.abs(this.timeBuf[i]);
      if (a > max) max = a;
    }
    return { level: max, tuner: detectPitchAutocorrelation(this.timeBuf, sampleRate) };
  }
}

export const liveAudioRecorder = new LiveAudioRecorder();
