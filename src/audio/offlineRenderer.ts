import type {
  Channel,
  ExportConfig,
  LiveCodeCompiledProgram,
  ProjectState,
} from '../types/daw';
import { MixerTrackNode } from './dsp/mixerTrack';
import { triggerSubSynthNote } from './dsp/subSynth';
import { triggerFmSynthNote } from './dsp/fmSynth';
import { triggerSampleBuffer, triggerSynthesizedDrum } from './dsp/drumSynth';
import type { SoundFontPlayer } from './dsp/sf2Player';

export interface OfflineRenderStats {
  peakDb: number;
  truePeakDb: number;
  lufsIntegrated: number;
  durationSec: number;
  sampleRate: number;
}

/** Apply lookahead True Peak brickwall limiter in-place to stereo channels */
export function applyTruePeakCeiling(left: Float32Array, right: Float32Array, ceilingDb: number): { peakDb: number; truePeakDb: number; lufs: number } {
  const ceiling = Math.pow(10, Math.min(0, ceilingDb) / 20);
  const n = left.length;
  let env = 1.0;
  const release = 0.9994;
  let maxAbs = 1e-7;
  let sumSq = 0;

  for (let i = 0; i < n; i++) {
    const p = Math.max(Math.abs(left[i]), Math.abs(right[i]));
    const target = p > ceiling ? ceiling / p : 1.0;
    env = target < env ? target : env * release + target * (1 - release);
    const l = Math.max(-ceiling, Math.min(ceiling, left[i] * env));
    const r = Math.max(-ceiling, Math.min(ceiling, right[i] * env));
    left[i] = l;
    right[i] = r;
    const a = Math.max(Math.abs(l), Math.abs(r));
    if (a > maxAbs) maxAbs = a;
    sumSq += 0.5 * (l * l + r * r);
  }

  // Estimate 4x cubic true peak on limited signal
  let tpMax = maxAbs;
  for (let i = 1; i < n - 2; i++) {
    for (const ch of [left, right]) {
      const y0 = ch[i - 1], y1 = ch[i], y2 = ch[i + 1], y3 = ch[i + 2];
      const mid = Math.abs(-0.0625 * y0 + 0.5625 * y1 + 0.5625 * y2 - 0.0625 * y3);
      if (mid > tpMax) tpMax = mid;
    }
  }

  const peakDb = 20 * Math.log10(Math.max(1e-7, maxAbs));
  const truePeakDb = 20 * Math.log10(Math.max(1e-7, tpMax));
  const meanSq = sumSq / Math.max(1, n);
  const lufs = Math.max(-70, -0.691 + 10 * Math.log10(Math.max(1e-10, meanSq)));
  return { peakDb, truePeakDb, lufs };
}

/**
 * Lossless WAV encoder supporting:
 *  - 32-bit IEEE Float (format tag 3)
 *  - 24-bit PCM (format tag 1) with optional TPDF or high-pass shaped dither
 *  - 16-bit PCM (format tag 1) with optional TPDF or high-pass shaped dither
 */
export function encodeWavBuffer(
  left: Float32Array,
  right: Float32Array,
  sampleRate: number,
  bitDepth: 16 | 24 | 32,
  dither: 'none' | 'tpdf' | 'shaped' = 'tpdf'
): Uint8Array {
  const numFrames = left.length;
  const numChannels = 2;
  const bytesPerSample = bitDepth / 8;
  const blockAlign = numChannels * bytesPerSample;
  const dataSize = numFrames * blockAlign;
  const buffer = new ArrayBuffer(44 + dataSize);
  const view = new DataView(buffer);

  const writeStr = (offset: number, s: string) => {
    for (let i = 0; i < s.length; i++) view.setUint8(offset + i, s.charCodeAt(i));
  };

  writeStr(0, 'RIFF');
  view.setUint32(4, 36 + dataSize, true);
  writeStr(8, 'WAVE');
  writeStr(12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, bitDepth === 32 ? 3 : 1, true); // 3 = IEEE float, 1 = PCM
  view.setUint16(22, numChannels, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * blockAlign, true);
  view.setUint16(32, blockAlign, true);
  view.setUint16(34, bitDepth, true);
  writeStr(36, 'data');
  view.setUint32(40, dataSize, true);

  // Deterministic fast LCG for TPDF dither
  let seed = 987654321;
  const rand = () => {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    return seed / 4294967296;
  };
  const prevNoise = [0, 0];
  const prevErr = [0, 0];

  const quantize = (sample: number, chIdx: number, maxInt: number): number => {
    const lsb = 1 / maxInt;
    let s = sample;
    if (dither === 'tpdf') {
      s += (rand() - rand()) * lsb;
    } else if (dither === 'shaped') {
      const r = rand() - 0.5;
      const hpNoise = r - prevNoise[chIdx];
      prevNoise[chIdx] = r;
      s += hpNoise * lsb + prevErr[chIdx] * 0.5;
    }
    const clamped = Math.max(-1, Math.min(1, s));
    const q = Math.round(clamped * maxInt);
    if (dither === 'shaped') {
      prevErr[chIdx] = clamped - q / maxInt;
    }
    return Math.max(-maxInt - 1, Math.min(maxInt, q));
  };

  let offset = 44;
  if (bitDepth === 32) {
    for (let i = 0; i < numFrames; i++) {
      view.setFloat32(offset, left[i], true);
      offset += 4;
      view.setFloat32(offset, right[i], true);
      offset += 4;
    }
  } else if (bitDepth === 24) {
    for (let i = 0; i < numFrames; i++) {
      const l = quantize(left[i], 0, 8388607);
      const r = quantize(right[i], 1, 8388607);
      const lu = l < 0 ? l + 0x1000000 : l;
      const ru = r < 0 ? r + 0x1000000 : r;
      view.setUint8(offset++, lu & 0xff);
      view.setUint8(offset++, (lu >> 8) & 0xff);
      view.setUint8(offset++, (lu >> 16) & 0xff);
      view.setUint8(offset++, ru & 0xff);
      view.setUint8(offset++, (ru >> 8) & 0xff);
      view.setUint8(offset++, (ru >> 16) & 0xff);
    }
  } else {
    for (let i = 0; i < numFrames; i++) {
      view.setInt16(offset, quantize(left[i], 0, 32767), true);
      offset += 2;
      view.setInt16(offset, quantize(right[i], 1, 32767), true);
      offset += 2;
    }
  }

  return new Uint8Array(buffer);
}

export async function renderProjectOffline(opts: {
  project: ProjectState;
  config: ExportConfig;
  kitBuffers: Map<string, AudioBuffer>;
  sf2Player: SoundFontPlayer;
  liveProgram: LiveCodeCompiledProgram | null;
  onlyMixerTrackId?: string;
}): Promise<{ wavBytes: Uint8Array; stats: OfflineRenderStats; audioBuffer: AudioBuffer }> {
  const { project, config, kitBuffers, sf2Player, liveProgram, onlyMixerTrackId } = opts;
  const sr = config.sampleRate;
  const secPerBeat = 60 / Math.max(30, project.bpm);

  // Determine beat range
  let startBeat = 0;
  let endBeat = 16;
  if (config.range === 'loop') {
    if (project.playbackMode === 'pattern') {
      const pat = project.patterns.find((p) => p.id === project.activePatternId) || project.patterns[0];
      startBeat = 0;
      endBeat = (pat?.lengthSteps ?? 16) / 4;
    } else {
      startBeat = project.loopStartBeat;
      endBeat = Math.max(startBeat + 4, project.loopEndBeat);
    }
  } else if (config.range === 'selection') {
    startBeat = config.selectionStartBeat;
    endBeat = Math.max(startBeat + 1, config.selectionEndBeat);
  } else {
    // Full song
    if (project.playbackMode === 'pattern') {
      const pat = project.patterns.find((p) => p.id === project.activePatternId) || project.patterns[0];
      endBeat = (pat?.lengthSteps ?? 16) / 4;
    } else {
      const maxClip = project.playlistClips.reduce((m, c) => Math.max(m, c.startBeat + c.durationBeats), 16);
      endBeat = Math.max(4, maxClip);
    }
  }

  const contentSec = Math.max(0.5, (endBeat - startBeat) * secPerBeat);
  const totalSec = contentSec + Math.max(0, config.preserveTailSec);
  const totalFrames = Math.ceil(totalSec * sr);

  const offline = new OfflineAudioContext(2, totalFrames, sr);

  // Build mixer graph in offline context
  const trackNodes = new Map<string, MixerTrackNode>();
  const anySolo = project.mixerTracks.some((t) => t.kind === 'insert' && t.solo);
  for (const t of project.mixerTracks) {
    const effTrack =
      onlyMixerTrackId && t.kind === 'insert'
        ? { ...t, mute: t.id !== onlyMixerTrackId, solo: false }
        : t;
    trackNodes.set(t.id, new MixerTrackNode(offline, effTrack, project.bpm));
  }

  const master = trackNodes.get('mx_master')!;
  const sendA = trackNodes.get('mx_send_a');
  const sendB = trackNodes.get('mx_send_b');
  for (const t of project.mixerTracks) {
    const node = trackNodes.get(t.id)!;
    if (t.kind === 'master') {
      node.output.connect(offline.destination);
    } else if (t.kind === 'send') {
      node.output.connect(master.input);
    } else {
      node.output.connect(master.input);
      if (sendA) node.sendAGain.connect(sendA.input);
      if (sendB) node.sendBGain.connect(sendB.input);
    }
    node.applyState(
      onlyMixerTrackId && t.kind === 'insert' ? { ...t, mute: t.id !== onlyMixerTrackId, solo: false } : t,
      project.bpm,
      onlyMixerTrackId ? false : anySolo
    );
  }

  const getDestForChannel = (ch: Channel): AudioNode => {
    return (trackNodes.get(ch.mixerTrackId) || master).input;
  };

  const triggerChannel = (
    ch: Channel,
    time: number,
    duration: number,
    velocity: number,
    midi: number,
    pan: number,
    drumVoiceOverride?: Channel['drumSynth']['voice']
  ) => {
    if (ch.mute) return;
    const dest = getDestForChannel(ch);
    const vel = velocity * ch.volume;
    const finalPan = Math.max(-1, Math.min(1, ch.pan + pan));

    if (ch.engine === 'SubSynth') {
      triggerSubSynthNote(offline, dest, ch.subSynth, { midi, time, duration, velocity: vel, pan: finalPan });
    } else if (ch.engine === 'FMSynth') {
      triggerFmSynthNote(offline, dest, ch.fmSynth, { midi, time, duration, velocity: vel, pan: finalPan });
    } else if (ch.engine === 'SoundFont') {
      sf2Player.triggerNote(offline, dest, {
        fontId: ch.soundFont.sf2Name,
        presetIndex: ch.soundFont.presetIndex,
        midi,
        time,
        duration,
        velocity: vel,
        cutoff: ch.soundFont.cutoff,
        release: ch.soundFont.release,
        pan: finalPan,
      });
    } else if (ch.engine === 'Sampler') {
      const buf = kitBuffers.get(ch.sampler.assetPath);
      if (buf) {
        triggerSampleBuffer(offline, dest, buf, {
          time,
          velocity: vel,
          pitchSemi: midi - ch.sampler.rootMidi,
          pan: finalPan,
          cutoff: ch.sampler.cutoff,
          startNorm: ch.sampler.startNorm,
          endNorm: ch.sampler.endNorm,
          duration,
          samplerParams: ch.sampler,
        });
      }
    } else {
      const voice = drumVoiceOverride ?? ch.drumSynth.voice;
      const key = `kits/${ch.drumSynth.kitId}/${voice}.wav`;
      const buf = ch.drumSynth.useSample ? kitBuffers.get(key) : undefined;
      if (buf) {
        triggerSampleBuffer(offline, dest, buf, {
          time,
          velocity: vel,
          pitchSemi: ch.drumSynth.tuneSemi + (midi - 60),
          pan: finalPan,
        });
      } else {
        triggerSynthesizedDrum(offline, dest, voice, ch.drumSynth, {
          time,
          velocity: vel,
          pitchSemi: midi - 60,
          pan: finalPan,
        });
      }
    }
  };

  const schedulePatternAt = (patternId: string, clipStartBeat: number, clipDurBeats: number) => {
    const pat = project.patterns.find((p) => p.id === patternId);
    if (!pat) return;
    const patBeats = pat.lengthSteps / 4;
    const anyChSolo = project.channels.some((c) => c.solo);

    for (const ch of project.channels) {
      if (ch.mute || (anyChSolo && !ch.solo)) continue;
      const steps = pat.steps[ch.id] || [];
      const notes = pat.notes[ch.id] || [];

      // Tile pattern across clipDurBeats
      for (let tile = 0; tile * patBeats < clipDurBeats; tile++) {
        const baseBeat = clipStartBeat + tile * patBeats;
        steps.forEach((cell, idx) => {
          if (!cell.active) return;
          const b = baseBeat + idx * 0.25;
          if (b < startBeat || b >= endBeat || b >= clipStartBeat + clipDurBeats) return;
          const swingOff = idx % 2 === 1 ? project.swing * 0.125 : 0;
          const rCount = cell.ratchet || 1;
          for (let r = 0; r < rCount; r++) {
            const t = (b + swingOff + (r * 0.25) / rCount - startBeat) * secPerBeat;
            triggerChannel(ch, Math.max(0, t), (0.25 / rCount) * secPerBeat, cell.velocity, 60 + cell.pitchOffset, cell.pan);
          }
        });

        notes.forEach((note) => {
          const b = baseBeat + note.startBeat;
          if (b < startBeat || b >= endBeat || b >= clipStartBeat + clipDurBeats) return;
          const t = (b - startBeat) * secPerBeat;
          triggerChannel(ch, Math.max(0, t), note.duration * secPerBeat, note.velocity, note.midi, note.pan);
        });
      }
    }
  };

  // Schedule Pattern or Song clips
  if (project.playbackMode === 'pattern') {
    schedulePatternAt(project.activePatternId, 0, endBeat);
  } else {
    for (const clip of project.playlistClips) {
      if (clip.muted || clip.kind !== 'pattern' || !clip.patternId) continue;
      schedulePatternAt(clip.patternId, clip.startBeat, clip.durationBeats);
    }
  }

  // Schedule active Live Code events if live code buffer is active
  const activeBuf = project.liveCodeBuffers.find((b) => b.active);
  if (activeBuf && liveProgram && liveProgram.ok && liveProgram.events.length > 0) {
    const loopBeats = Math.max(4, liveProgram.loopBars * 4);
    for (let cycleStart = Math.floor(startBeat / loopBeats) * loopBeats; cycleStart < endBeat; cycleStart += loopBeats) {
      for (const ev of liveProgram.events) {
        const b = cycleStart + ev.atBeat;
        if (b < startBeat || b >= endBeat) continue;
        const t = (b - startBeat) * secPerBeat;
        const ch =
          project.channels.find((c) => c.liveCodeAlias === ev.channelName || c.name.toLowerCase().includes(ev.channelName)) ||
          project.channels[0];
        if (!ch) continue;
        const mx = project.mixerTracks.find((m) => m.index === ev.mixerIndex);
        const dest = (mx ? trackNodes.get(mx.id) : trackNodes.get(ch.mixerTrackId))?.input || master.input;
        if (ev.drumVoice) {
          const key = `kits/${ev.kitId || ch.drumSynth.kitId}/${ev.drumVoice}.wav`;
          const buf = kitBuffers.get(key);
          if (buf) triggerSampleBuffer(offline, dest, buf, { time: Math.max(0, t), velocity: ev.velocity * ev.gain, pan: ev.pan });
          else triggerSynthesizedDrum(offline, dest, ev.drumVoice, ch.drumSynth, { time: Math.max(0, t), velocity: ev.velocity * ev.gain, pan: ev.pan });
        } else if (ev.midi !== undefined) {
          if (ev.engine === 'FMSynth') {
            triggerFmSynthNote(offline, dest, ch.fmSynth, { midi: ev.midi, time: Math.max(0, t), duration: ev.durationBeats * secPerBeat, velocity: ev.velocity * ev.gain, pan: ev.pan, cutoffOverride: ev.cutoff });
          } else {
            triggerSubSynthNote(offline, dest, ch.subSynth, { midi: ev.midi, time: Math.max(0, t), duration: ev.durationBeats * secPerBeat, velocity: ev.velocity * ev.gain, pan: ev.pan, cutoffOverride: ev.cutoff });
          }
        }
      }
    }
  }

  const rendered = await offline.startRendering();
  const left = new Float32Array(rendered.getChannelData(0));
  const right = new Float32Array(rendered.numberOfChannels > 1 ? rendered.getChannelData(1) : rendered.getChannelData(0));

  const limStats = applyTruePeakCeiling(left, right, config.truePeakCeilingDb);
  const bitDepth: 16 | 24 | 32 =
    config.format === 'wav16' ? 16 : config.format === 'wav24' ? 24 : 32;
  const wavBytes = encodeWavBuffer(left, right, sr, bitDepth, bitDepth === 32 ? 'none' : config.dither);

  return {
    wavBytes,
    audioBuffer: rendered,
    stats: {
      peakDb: limStats.peakDb,
      truePeakDb: limStats.truePeakDb,
      lufsIntegrated: limStats.lufs,
      durationSec: totalSec,
      sampleRate: sr,
    },
  };
}
