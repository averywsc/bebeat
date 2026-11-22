import { midiToFreq } from '../../livecode/musicTheory';

export interface Sf2SampleMeta {
  name: string;
  start: number;
  end: number;
  loopStart: number;
  loopEnd: number;
  sampleRate: number;
  originalPitch: number;
  pitchCorrection: number;
}

export interface Sf2PresetMeta {
  name: string;
  preset: number;
  bank: number;
  sampleIndex: number;
}

export interface ParsedSoundFont {
  name: string;
  presets: Sf2PresetMeta[];
  samples: Sf2SampleMeta[];
  pcmInt16: Int16Array;
}

function readAscii(view: DataView, offset: number, length: number): string {
  let out = '';
  for (let i = 0; i < length; i++) {
    const c = view.getUint8(offset + i);
    if (c === 0) break;
    out += String.fromCharCode(c);
  }
  return out.trim();
}

/**
 * Pure-TypeScript RIFF/sfbk SoundFont 2.x parser.
 * Extracts INFO name, sdta/smpl 16-bit PCM bank, pdta/phdr presets, and pdta/shdr sample headers.
 */
export function parseSoundFont2(buffer: ArrayBuffer, fallbackName = 'SoundFont'): ParsedSoundFont {
  const view = new DataView(buffer);
  const riff = readAscii(view, 0, 4);
  const sfbk = readAscii(view, 8, 4);
  if (riff !== 'RIFF' || sfbk !== 'sfbk') {
    throw new Error('Invalid SF2 file: missing RIFF/sfbk header');
  }

  let sfName = fallbackName;
  let pcmInt16 = new Int16Array(0);
  const presets: Sf2PresetMeta[] = [];
  const samples: Sf2SampleMeta[] = [];

  const scanChunks = (start: number, end: number) => {
    let pos = start;
    while (pos + 8 <= end) {
      const id = readAscii(view, pos, 4);
      const size = view.getUint32(pos + 4, true);
      const dataStart = pos + 8;
      const dataEnd = Math.min(end, dataStart + size);

      if (id === 'LIST') {
        const listType = readAscii(view, dataStart, 4);
        if (listType === 'INFO' || listType === 'sdta' || listType === 'pdta') {
          scanChunks(dataStart + 4, dataEnd);
        }
      } else if (id === 'INAM') {
        sfName = readAscii(view, dataStart, size) || sfName;
      } else if (id === 'smpl') {
        const count = Math.floor(size / 2);
        pcmInt16 = new Int16Array(count);
        for (let i = 0; i < count; i++) {
          pcmInt16[i] = view.getInt16(dataStart + i * 2, true);
        }
      } else if (id === 'phdr') {
        const stride = 38;
        const count = Math.floor(size / stride);
        for (let i = 0; i < count - 1; i++) {
          const base = dataStart + i * stride;
          const name = readAscii(view, base, 20);
          const preset = view.getUint16(base + 20, true);
          const bank = view.getUint16(base + 22, true);
          if (name && name !== 'EOP') {
            presets.push({ name, preset, bank, sampleIndex: i });
          }
        }
      } else if (id === 'shdr') {
        const stride = 46;
        const count = Math.floor(size / stride);
        for (let i = 0; i < count - 1; i++) {
          const base = dataStart + i * stride;
          const name = readAscii(view, base, 20);
          const startIdx = view.getUint32(base + 20, true);
          const endIdx = view.getUint32(base + 24, true);
          const loopStart = view.getUint32(base + 28, true);
          const loopEnd = view.getUint32(base + 32, true);
          const sampleRate = view.getUint32(base + 36, true) || 44100;
          const originalPitch = view.getUint8(base + 40);
          const pitchCorrection = view.getInt8(base + 41);
          if (name && name !== 'EOS' && endIdx > startIdx) {
            samples.push({
              name,
              start: startIdx,
              end: endIdx,
              loopStart,
              loopEnd,
              sampleRate,
              originalPitch: originalPitch > 127 ? 60 : originalPitch,
              pitchCorrection,
            });
          }
        }
      }

      pos = dataStart + size + (size % 2);
    }
  };

  scanChunks(12, buffer.byteLength);

  if (presets.length === 0 && samples.length > 0) {
    samples.forEach((s, i) => presets.push({ name: s.name, preset: i, bank: 0, sampleIndex: i }));
  }

  return { name: sfName, presets, samples, pcmInt16 };
}

export class SoundFontPlayer {
  private fonts = new Map<string, ParsedSoundFont>();
  private bufferCache = new Map<string, AudioBuffer>();

  registerSoundFont(id: string, data: ArrayBuffer): ParsedSoundFont {
    const parsed = parseSoundFont2(data, id);
    this.fonts.set(id, parsed);
    return parsed;
  }

  getFont(id: string): ParsedSoundFont | undefined {
    return this.fonts.get(id);
  }

  listFonts(): Array<{ id: string; name: string; presets: Sf2PresetMeta[] }> {
    return Array.from(this.fonts.entries()).map(([id, sf]) => ({
      id,
      name: sf.name,
      presets: sf.presets,
    }));
  }

  private getSampleAudioBuffer(ctx: BaseAudioContext, fontId: string, sampleIdx: number): { buffer: AudioBuffer; meta: Sf2SampleMeta } | null {
    const sf = this.fonts.get(fontId);
    if (!sf || sf.samples.length === 0) return null;
    const idx = Math.max(0, Math.min(sf.samples.length - 1, sampleIdx));
    const meta = sf.samples[idx];
    const cacheKey = `${ctx.sampleRate}:${fontId}:${idx}`;
    const existing = this.bufferCache.get(cacheKey);
    if (existing && existing.sampleRate === meta.sampleRate) {
      return { buffer: existing, meta };
    }
    const len = Math.max(1, Math.min(meta.end, sf.pcmInt16.length) - meta.start);
    const buf = ctx.createBuffer(1, len, meta.sampleRate);
    const ch = buf.getChannelData(0);
    for (let i = 0; i < len; i++) {
      ch[i] = sf.pcmInt16[meta.start + i] / 32768;
    }
    if (!(ctx instanceof OfflineAudioContext)) {
      this.bufferCache.set(cacheKey, buf);
    }
    return { buffer: buf, meta };
  }

  triggerNote(
    ctx: BaseAudioContext,
    dest: AudioNode,
    opts: {
      fontId: string;
      presetIndex: number;
      midi: number;
      time: number;
      duration: number;
      velocity: number;
      cutoff: number;
      release: number;
      pan?: number;
    }
  ): void {
    const sf = this.fonts.get(opts.fontId);
    const preset = sf?.presets[Math.min(opts.presetIndex, (sf?.presets.length ?? 1) - 1)];
    const sampleData = sf ? this.getSampleAudioBuffer(ctx, opts.fontId, preset?.sampleIndex ?? opts.presetIndex) : null;

    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.setValueAtTime(Math.max(120, Math.min(18000, opts.cutoff)), opts.time);

    const amp = ctx.createGain();
    const peakGain = Math.max(0.01, opts.velocity * 0.65);
    const rel = Math.max(0.04, opts.release);
    amp.gain.setValueAtTime(0.0001, opts.time);
    amp.gain.linearRampToValueAtTime(peakGain, opts.time + 0.006);
    amp.gain.setValueAtTime(peakGain, opts.time + opts.duration);
    amp.gain.exponentialRampToValueAtTime(0.0001, opts.time + opts.duration + rel);

    const panner = ctx.createStereoPanner();
    panner.pan.setValueAtTime(opts.pan ?? 0, opts.time);

    filter.connect(amp);
    amp.connect(panner);
    panner.connect(dest);

    if (sampleData) {
      const src = ctx.createBufferSource();
      src.buffer = sampleData.buffer;
      const semiDiff = opts.midi - sampleData.meta.originalPitch + sampleData.meta.pitchCorrection / 100;
      src.playbackRate.setValueAtTime(Math.pow(2, semiDiff / 12), opts.time);
      if (sampleData.meta.loopEnd > sampleData.meta.loopStart + 64) {
        src.loop = true;
        src.loopStart = (sampleData.meta.loopStart - sampleData.meta.start) / sampleData.meta.sampleRate;
        src.loopEnd = (sampleData.meta.loopEnd - sampleData.meta.start) / sampleData.meta.sampleRate;
      }
      src.connect(filter);
      src.start(opts.time);
      src.stop(opts.time + opts.duration + rel + 0.03);
    } else {
      // Clean electric piano DSP fallback if SF2 not yet loaded
      const osc = ctx.createOscillator();
      osc.type = 'triangle';
      osc.frequency.setValueAtTime(midiToFreq(opts.midi), opts.time);
      osc.connect(filter);
      osc.start(opts.time);
      osc.stop(opts.time + opts.duration + rel + 0.03);
    }
  }
}
