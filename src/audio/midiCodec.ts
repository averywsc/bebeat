import type { PianoNote } from '../types/daw';
import { uid } from '../state/projectStore';

export interface MidiDeviceSummary {
  id: string;
  name: string;
  manufacturer: string;
  state: string;
}

export interface MidiCallbacks {
  onNoteOn: (midi: number, velocity: number, channel: number) => void;
  onNoteOff: (midi: number, channel: number) => void;
  onControlChange: (cc: number, valueNorm: number, channel: number) => void;
  onDevicesChanged: (devices: MidiDeviceSummary[]) => void;
}

export class WebMidiManager {
  private access: MIDIAccess | null = null;
  private callbacks: MidiCallbacks | null = null;

  async init(callbacks: MidiCallbacks): Promise<MidiDeviceSummary[]> {
    this.callbacks = callbacks;
    if (typeof navigator === 'undefined' || !('requestMIDIAccess' in navigator)) {
      return [];
    }
    try {
      this.access = await navigator.requestMIDIAccess({ sysex: false });
      this.bindInputs();
      this.access.onstatechange = () => {
        this.bindInputs();
      };
      return this.listDevices();
    } catch {
      return [];
    }
  }

  listDevices(): MidiDeviceSummary[] {
    if (!this.access) return [];
    const list: MidiDeviceSummary[] = [];
    this.access.inputs.forEach((input) => {
      list.push({
        id: input.id,
        name: input.name || 'MIDI Input',
        manufacturer: input.manufacturer || 'Hardware',
        state: input.state,
      });
    });
    return list;
  }

  private bindInputs(): void {
    if (!this.access) return;
    this.access.inputs.forEach((input) => {
      input.onmidimessage = (event: MIDIMessageEvent) => {
        const data = event.data;
        if (!data || data.length < 2) return;
        const status = data[0] & 0xf0;
        const ch = (data[0] & 0x0f) + 1;
        const d1 = data[1];
        const d2 = data.length > 2 ? data[2] : 0;

        if (status === 0x90 && d2 > 0) {
          this.callbacks?.onNoteOn(d1, d2 / 127, ch);
        } else if (status === 0x80 || (status === 0x90 && d2 === 0)) {
          this.callbacks?.onNoteOff(d1, ch);
        } else if (status === 0xb0) {
          this.callbacks?.onControlChange(d1, d2 / 127, ch);
        }
      };
    });
    this.callbacks?.onDevicesChanged(this.listDevices());
  }
}

/* ==========================================================================
   Zero-Dependency Standard MIDI File (SMF Type 0 / 1 / 2 + RIFF RMID)
   Binary Reader & Writer — Works identically in Electron, Browser & Node
   ========================================================================== */

const GM_INSTRUMENT_NAMES: string[] = [
  'Acoustic Grand Piano', 'Bright Acoustic Piano', 'Electric Grand Piano', 'Honky-Tonk Piano',
  'Electric Piano 1', 'Electric Piano 2', 'Harpsichord', 'Clavinet',
  'Celesta', 'Glockenspiel', 'Music Box', 'Vibraphone',
  'Marimba', 'Xylophone', 'Tubular Bells', 'Dulcimer',
  'Drawbar Organ', 'Percussive Organ', 'Rock Organ', 'Church Organ',
  'Reed Organ', 'Accordion', 'Harmonica', 'Tango Accordion',
  'Acoustic Guitar (nylon)', 'Acoustic Guitar (steel)', 'Electric Guitar (jazz)', 'Electric Guitar (clean)',
  'Electric Guitar (muted)', 'Overdriven Guitar', 'Distortion Guitar', 'Guitar Harmonics',
  'Acoustic Bass', 'Electric Bass (finger)', 'Electric Bass (pick)', 'Fretless Bass',
  'Slap Bass 1', 'Slap Bass 2', 'Synth Bass 1', 'Synth Bass 2',
  'Violin', 'Viola', 'Cello', 'Contrabass',
  'Tremolo Strings', 'Pizzicato Strings', 'Orchestral Harp', 'Timpani',
  'String Ensemble 1', 'String Ensemble 2', 'Synth Strings 1', 'Synth Strings 2',
  'Choir Aahs', 'Voice Oohs', 'Synth Choir', 'Orchestra Hit',
  'Trumpet', 'Trombone', 'Tuba', 'Muted Trumpet',
  'French Horn', 'Brass Section', 'Synth Brass 1', 'Synth Brass 2',
  'Soprano Sax', 'Alto Sax', 'Tenor Sax', 'Baritone Sax',
  'Oboe', 'English Horn', 'Bassoon', 'Clarinet',
  'Piccolo', 'Flute', 'Recorder', 'Pan Flute',
  'Blown Bottle', 'Shakuhachi', 'Whistle', 'Ocarina',
  'Lead 1 (square)', 'Lead 2 (sawtooth)', 'Lead 3 (calliope)', 'Lead 4 (chiff)',
  'Lead 5 (charang)', 'Lead 6 (voice)', 'Lead 7 (fifths)', 'Lead 8 (bass + lead)',
  'Pad 1 (new age)', 'Pad 2 (warm)', 'Pad 3 (polysynth)', 'Pad 4 (choir)',
  'Pad 5 (bowed)', 'Pad 6 (metallic)', 'Pad 7 (halo)', 'Pad 8 (sweep)',
  'FX 1 (rain)', 'FX 2 (soundtrack)', 'FX 3 (crystal)', 'FX 4 (atmosphere)',
  'FX 5 (brightness)', 'FX 6 (goblins)', 'FX 7 (echoes)', 'FX 8 (sci-fi)',
  'Sitar', 'Banjo', 'Shamisen', 'Koto',
  'Kalimba', 'Bagpipe', 'Fiddle', 'Shanai',
  'Tinkle Bell', 'Agogo', 'Steel Drums', 'Woodblock',
  'Taiko Drum', 'Melodic Tom', 'Synth Drum', 'Reverse Cymbal',
  'Guitar Fret Noise', 'Breath Noise', 'Seashore', 'Bird Tweet',
  'Telephone Ring', 'Helicopter', 'Applause', 'Gunshot',
];

function normalizeBytes(input: Uint8Array | ArrayBuffer | ArrayLike<number>): Uint8Array {
  if (input instanceof Uint8Array) return input;
  if (input instanceof ArrayBuffer) return new Uint8Array(input);
  if (ArrayBuffer.isView(input)) {
    const v = input as ArrayBufferView;
    return new Uint8Array(v.buffer, v.byteOffset, v.byteLength);
  }
  return Uint8Array.from(input);
}

function readAscii(bytes: Uint8Array, pos: number, len: number): string {
  let out = '';
  const end = Math.min(bytes.length, pos + len);
  for (let i = pos; i < end; i++) {
    const c = bytes[i];
    if (c >= 32 && c <= 126) out += String.fromCharCode(c);
  }
  return out;
}

function readU16BE(bytes: Uint8Array, pos: number): number {
  return ((bytes[pos] ?? 0) << 8) | (bytes[pos + 1] ?? 0);
}

function readU32BE(bytes: Uint8Array, pos: number): number {
  return (
    (((bytes[pos] ?? 0) << 24) >>> 0) +
    ((bytes[pos + 1] ?? 0) << 16) +
    ((bytes[pos + 2] ?? 0) << 8) +
    (bytes[pos + 3] ?? 0)
  );
}

function writeVarLen(value: number, out: number[]): void {
  let v = Math.max(0, Math.round(value)) >>> 0;
  const buf = [v & 0x7f];
  v >>>= 7;
  while (v > 0) {
    buf.push((v & 0x7f) | 0x80);
    v >>>= 7;
  }
  for (let i = buf.length - 1; i >= 0; i--) out.push(buf[i]);
}

function writeU32BE(value: number, out: number[]): void {
  out.push((value >>> 24) & 0xff, (value >>> 16) & 0xff, (value >>> 8) & 0xff, value & 0xff);
}

function writeU16BE(value: number, out: number[]): void {
  out.push((value >>> 8) & 0xff, value & 0xff);
}

interface RawSmfNote {
  midi: number;
  channel: number;
  startTick: number;
  durationTicks: number;
  velocity: number;
}

interface RawSmfTrack {
  trackIndex: number;
  name: string;
  instrumentName: string;
  programByChannel: Map<number, number>;
  notes: RawSmfNote[];
}

interface ParsedRawSmf {
  format: number;
  ticksPerBeat: number;
  bpm: number;
  timeSignature: [number, number];
  tracks: RawSmfTrack[];
}

function findMThdOffset(bytes: Uint8Array): number {
  // Fast check at byte 0
  if (
    bytes.length >= 14 &&
    bytes[0] === 0x4d &&
    bytes[1] === 0x54 &&
    bytes[2] === 0x68 &&
    bytes[3] === 0x64
  ) {
    return 0;
  }
  // Support RIFF RMID wrappers or leading junk bytes by scanning first 4 KB for "MThd"
  const limit = Math.min(bytes.length - 14, 4096);
  for (let i = 1; i <= limit; i++) {
    if (
      bytes[i] === 0x4d &&
      bytes[i + 1] === 0x54 &&
      bytes[i + 2] === 0x68 &&
      bytes[i + 3] === 0x64
    ) {
      return i;
    }
  }
  return -1;
}

function parseRawSmf(input: Uint8Array | ArrayBuffer | ArrayLike<number>, fallbackBpm: number): ParsedRawSmf {
  const bytes = normalizeBytes(input);
  const hdrOffset = findMThdOffset(bytes);
  if (hdrOffset < 0) {
    throw new Error('Not a valid Standard MIDI File (missing MThd header).');
  }

  const hdrLen = readU32BE(bytes, hdrOffset + 4);
  const format = readU16BE(bytes, hdrOffset + 8);
  const numTracks = readU16BE(bytes, hdrOffset + 10);
  const division = readU16BE(bytes, hdrOffset + 12);

  // If bit 15 is 0, division is ticks per quarter note (PPQ). If bit 15 is 1, SMPTE ticks/sec.
  const ticksPerBeat =
    (division & 0x8000) === 0
      ? Math.max(1, division)
      : Math.max(1, (-(division >> 8) || 25) * (division & 0xff));

  let bpm = fallbackBpm;
  let foundTempo = false;
  let timeSignature: [number, number] = [4, 4];
  let foundTimeSig = false;

  const tracks: RawSmfTrack[] = [];
  let pos = hdrOffset + 8 + Math.max(6, hdrLen);

  for (let t = 0; t < numTracks && pos + 8 <= bytes.length; t++) {
    // Advance until next MTrk chunk (skip any unknown vendor chunks cleanly)
    while (pos + 8 <= bytes.length) {
      const tag = readAscii(bytes, pos, 4);
      const chunkLen = readU32BE(bytes, pos + 4);
      if (tag === 'MTrk') {
        pos += 8;
        const trackEnd = Math.min(bytes.length, pos + chunkLen);
        let p = pos;
        let absTick = 0;
        let runningStatus = 0;
        let trackName = '';
        let instMetaName = '';
        const programByChannel = new Map<number, number>();
        const activeNotes = new Map<number, Array<{ startTick: number; velocity: number }>>();
        const notes: RawSmfNote[] = [];

        while (p < trackEnd) {
          // Read VLQ delta time
          let delta = 0;
          let count = 0;
          while (p < trackEnd && count < 4) {
            const b = bytes[p++];
            delta = (delta << 7) | (b & 0x7f);
            count++;
            if ((b & 0x80) === 0) break;
          }
          absTick += delta;
          if (p >= trackEnd) break;

          let status = bytes[p];
          if (status & 0x80) {
            p++;
            // Channel voice messages update running status; system common/meta do not
            if (status < 0xf0) runningStatus = status;
          } else {
            if (runningStatus === 0) break;
            status = runningStatus;
          }

          if (status === 0xff) {
            // Meta event
            if (p >= trackEnd) break;
            const metaType = bytes[p++];
            let metaLen = 0;
            let mc = 0;
            while (p < trackEnd && mc < 4) {
              const b = bytes[p++];
              metaLen = (metaLen << 7) | (b & 0x7f);
              mc++;
              if ((b & 0x80) === 0) break;
            }
            const metaEnd = Math.min(trackEnd, p + metaLen);
            if (metaType === 0x03 && !trackName) {
              trackName = readAscii(bytes, p, metaEnd - p).trim();
            } else if (metaType === 0x04 && !instMetaName) {
              instMetaName = readAscii(bytes, p, metaEnd - p).trim();
            } else if (metaType === 0x51 && metaEnd - p >= 3 && !foundTempo) {
              const usPerBeat = (bytes[p] << 16) | (bytes[p + 1] << 8) | bytes[p + 2];
              if (usPerBeat > 0) {
                bpm = 60_000_000 / usPerBeat;
                foundTempo = true;
              }
            } else if (metaType === 0x58 && metaEnd - p >= 2 && !foundTimeSig) {
              const num = bytes[p];
              const den = 1 << Math.min(6, bytes[p + 1]);
              if (num > 0 && den > 0) {
                timeSignature = [num, den];
                foundTimeSig = true;
              }
            } else if (metaType === 0x2f) {
              p = metaEnd;
              break;
            }
            p = metaEnd;
          } else if (status === 0xf0 || status === 0xf7) {
            // SysEx
            let sxLen = 0;
            let sc = 0;
            while (p < trackEnd && sc < 4) {
              const b = bytes[p++];
              sxLen = (sxLen << 7) | (b & 0x7f);
              sc++;
              if ((b & 0x80) === 0) break;
            }
            p = Math.min(trackEnd, p + sxLen);
          } else {
            const type = status & 0xf0;
            const ch = status & 0x0f;
            if (type === 0xc0 || type === 0xd0) {
              // 1 data byte
              const d1 = p < trackEnd ? bytes[p++] : 0;
              if (type === 0xc0) programByChannel.set(ch, d1 & 0x7f);
            } else if (type === 0x80 || type === 0x90 || type === 0xa0 || type === 0xb0 || type === 0xe0) {
              // 2 data bytes
              const d1 = p < trackEnd ? bytes[p++] : 0;
              const d2 = p < trackEnd ? bytes[p++] : 0;
              const key = (ch << 8) | (d1 & 0x7f);
              if (type === 0x90 && d2 > 0) {
                const stack = activeNotes.get(key) || [];
                stack.push({ startTick: absTick, velocity: d2 / 127 });
                activeNotes.set(key, stack);
              } else if (type === 0x80 || (type === 0x90 && d2 === 0)) {
                const stack = activeNotes.get(key);
                const on = stack?.shift();
                if (on) {
                  notes.push({
                    midi: d1 & 0x7f,
                    channel: ch,
                    startTick: on.startTick,
                    durationTicks: Math.max(1, absTick - on.startTick),
                    velocity: on.velocity,
                  });
                }
              }
            } else if (status === 0xf2) {
              p = Math.min(trackEnd, p + 2);
            } else if (status === 0xf1 || status === 0xf3) {
              p = Math.min(trackEnd, p + 1);
            }
          }
        }

        // Flush any dangling unclosed notes at track end
        for (const [key, stack] of activeNotes.entries()) {
          const ch = (key >> 8) & 0x0f;
          const midi = key & 0x7f;
          for (const on of stack) {
            notes.push({
              midi,
              channel: ch,
              startTick: on.startTick,
              durationTicks: Math.max(Math.round(ticksPerBeat * 0.25), absTick - on.startTick),
              velocity: on.velocity,
            });
          }
        }

        tracks.push({
          trackIndex: t,
          name: trackName,
          instrumentName: instMetaName,
          programByChannel,
          notes,
        });

        pos = trackEnd;
        break;
      } else {
        // Unknown chunk, skip safely
        pos += 8 + chunkLen;
      }
    }
  }

  return { format, ticksPerBeat, bpm, timeSignature, tracks };
}

/** Export Piano Roll notes to Standard MIDI File (SMF Type 1) */
export function exportNotesToSmf(notes: PianoNote[], bpm: number, trackName = 'Bebeat Pattern'): Uint8Array {
  const ppq = 480;
  const clampedBpm = Math.max(30, Math.min(300, bpm || 128));
  const usPerBeat = Math.round(60_000_000 / clampedBpm);

  const trackData: number[] = [];

  // Track name meta event
  const nameBytes = Array.from(trackName.slice(0, 64)).map((ch) => ch.charCodeAt(0) & 0x7f);
  writeVarLen(0, trackData);
  trackData.push(0xff, 0x03);
  writeVarLen(nameBytes.length, trackData);
  trackData.push(...nameBytes);

  // Tempo meta event
  writeVarLen(0, trackData);
  trackData.push(0xff, 0x51, 0x03, (usPerBeat >>> 16) & 0xff, (usPerBeat >>> 8) & 0xff, usPerBeat & 0xff);

  // Time signature 4/4
  writeVarLen(0, trackData);
  trackData.push(0xff, 0x58, 0x04, 4, 2, 24, 8);

  // Build sorted note on/off events
  const events: Array<{ tick: number; order: number; status: number; d1: number; d2: number }> = [];
  for (const n of notes) {
    const midi = Math.max(0, Math.min(127, Math.round(n.midi)));
    const startTick = Math.max(0, Math.round(n.startBeat * ppq));
    const endTick = Math.max(startTick + 12, Math.round((n.startBeat + Math.max(0.05, n.duration)) * ppq));
    const vel = Math.max(1, Math.min(127, Math.round(n.velocity * 127)));
    events.push({ tick: startTick, order: 1, status: 0x90, d1: midi, d2: vel });
    events.push({ tick: endTick, order: 0, status: 0x80, d1: midi, d2: 0 });
  }
  events.sort((a, b) => a.tick - b.tick || a.order - b.order || a.d1 - b.d1);

  let prevTick = 0;
  for (const ev of events) {
    writeVarLen(ev.tick - prevTick, trackData);
    trackData.push(ev.status, ev.d1, ev.d2);
    prevTick = ev.tick;
  }

  // End of track
  writeVarLen(0, trackData);
  trackData.push(0xff, 0x2f, 0x00);

  const out: number[] = [];
  // MThd header (format 1, 1 track, ppq 480)
  out.push(0x4d, 0x54, 0x68, 0x64);
  writeU32BE(6, out);
  writeU16BE(1, out);
  writeU16BE(1, out);
  writeU16BE(ppq, out);

  // MTrk chunk
  out.push(0x4d, 0x54, 0x72, 0x6b);
  writeU32BE(trackData.length, out);
  out.push(...trackData);

  return new Uint8Array(out);
}

/** Import Standard MIDI File (SMF Type 0/1/2 or RIFF RMID) into Piano Roll notes */
export function importSmfToNotes(
  bytes: Uint8Array | ArrayBuffer | ArrayLike<number>,
  fallbackBpm = 128
): { bpm: number; notes: PianoNote[] } {
  const parsed = parseRawSmf(bytes, fallbackBpm);
  const notes: PianoNote[] = [];

  for (const tr of parsed.tracks) {
    for (const n of tr.notes) {
      const sb = Math.max(0, Math.round((n.startTick / parsed.ticksPerBeat) * 16) / 16);
      const dur = Math.max(0.125, Math.round((n.durationTicks / parsed.ticksPerBeat) * 16) / 16);
      notes.push({
        id: uid('mid'),
        midi: n.midi,
        startBeat: sb,
        duration: dur,
        velocity: Math.max(0.08, Math.min(1, n.velocity)),
        pan: 0,
      });
    }
  }

  return {
    bpm: Math.max(40, Math.min(260, Math.round(parsed.bpm))),
    notes: notes.sort((a, b) => a.startBeat - b.startBeat || a.midi - b.midi),
  };
}

export interface ParsedMidiTrack {
  index: number;
  name: string;
  instrumentName: string;
  gmProgram: number;
  isPercussion: boolean;
  recommendedEngine: 'SubSynth' | 'FMSynth' | 'SoundFont' | 'DrumSynth';
  recommendedPreset?: string;
  noteCount: number;
  minMidi: number;
  maxMidi: number;
  notes: PianoNote[];
}

export interface ParsedMidiFile {
  name: string;
  bpm: number;
  timeSignature: [number, number];
  totalBeats: number;
  tracks: ParsedMidiTrack[];
}

function classifyGmEngine(
  prog: number,
  isPerc: boolean
): { engine: ParsedMidiTrack['recommendedEngine']; preset?: string } {
  if (isPerc) return { engine: 'DrumSynth' };
  if (prog >= 32 && prog <= 39) return { engine: 'SubSynth', preset: 'Acid 303 Bass' };
  if (prog >= 40 && prog <= 55) return { engine: 'SubSynth', preset: 'Lush Juno Pad' };
  if (prog >= 80 && prog <= 95) return { engine: 'FMSynth', preset: 'Modular FM Pluck' };
  if (prog >= 4 && prog <= 15) return { engine: 'FMSynth', preset: 'Electric Tine Keys' };
  return { engine: 'SoundFont' };
}

/**
 * Full multi-track Standard MIDI File (SMF Type 0/1/2 + RIFF RMID) parser with tempo,
 * time signature, automatic multi-channel splitting for Format 0 files, GM program
 * classification, and exact PPQ-to-beat timing.
 */
export function parseSmfMultiTrack(
  bytes: Uint8Array | ArrayBuffer | ArrayLike<number>,
  fileName = 'Imported.mid',
  fallbackBpm = 128
): ParsedMidiFile {
  const raw = parseRawSmf(bytes, fallbackBpm);

  let maxBeat = 4;
  const tracks: ParsedMidiTrack[] = [];
  let outIdx = 0;

  for (const tr of raw.tracks) {
    if (tr.notes.length === 0) continue;

    // Group notes by MIDI channel inside each track (cleanly splits Format 0 multi-channel files)
    const byChannel = new Map<number, RawSmfNote[]>();
    for (const n of tr.notes) {
      const list = byChannel.get(n.channel) || [];
      list.push(n);
      byChannel.set(n.channel, list);
    }

    const multiChannel = byChannel.size > 1;

    for (const [chNum, chNotes] of Array.from(byChannel.entries()).sort((a, b) => a[0] - b[0])) {
      const isPerc = chNum === 9;
      const prog = tr.programByChannel.get(chNum) ?? 0;
      const gmName = isPerc ? 'Drum Kit' : GM_INSTRUMENT_NAMES[prog] || 'Acoustic Grand Piano';
      const instName = tr.instrumentName || gmName;
      const { engine: recommendedEngine, preset: recommendedPreset } = classifyGmEngine(prog, isPerc);

      let minMidi = 127;
      let maxMidi = 0;
      const notes: PianoNote[] = chNotes.map((n) => {
        if (n.midi < minMidi) minMidi = n.midi;
        if (n.midi > maxMidi) maxMidi = n.midi;
        const sb = Math.max(0, Math.round((n.startTick / raw.ticksPerBeat) * 16) / 16);
        const dur = Math.max(0.125, Math.round((n.durationTicks / raw.ticksPerBeat) * 16) / 16);
        if (sb + dur > maxBeat) maxBeat = sb + dur;
        return {
          id: uid('mid'),
          midi: n.midi,
          startBeat: sb,
          duration: dur,
          velocity: Math.max(0.1, Math.min(1, n.velocity)),
          pan: 0,
        };
      });

      notes.sort((a, b) => a.startBeat - b.startBeat || a.midi - b.midi);

      const baseLabel = tr.name?.trim() || instName;
      const finalName = multiChannel ? `${baseLabel} (Ch ${chNum + 1})` : baseLabel;

      tracks.push({
        index: outIdx++,
        name: finalName,
        instrumentName: instName,
        gmProgram: prog,
        isPercussion: isPerc,
        recommendedEngine,
        recommendedPreset,
        noteCount: notes.length,
        minMidi,
        maxMidi,
        notes,
      });
    }
  }

  return {
    name: fileName.replace(/\.(mid|midi|rmi)$/i, ''),
    bpm: Math.max(40, Math.min(260, Math.round(raw.bpm))),
    timeSignature: raw.timeSignature,
    totalBeats: Math.max(4, Math.ceil(maxBeat / 4) * 4),
    tracks,
  };
}
