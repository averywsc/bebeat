import * as ToneMidiModule from '@tonejs/midi';
import type { Midi as MidiType } from '@tonejs/midi';
import type { PianoNote } from '../types/daw';
import { uid } from '../state/projectStore';

const MidiCtor: typeof MidiType =
  (ToneMidiModule as unknown as { Midi?: typeof MidiType; default?: { Midi: typeof MidiType } }).Midi ||
  (ToneMidiModule as unknown as { default: { Midi: typeof MidiType } }).default.Midi;

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

/** Export Piano Roll notes to Standard MIDI File (SMF Type 1) */
export function exportNotesToSmf(notes: PianoNote[], bpm: number, trackName = 'Bebeat Pattern'): Uint8Array {
  const midi = new MidiCtor();
  midi.header.setTempo(bpm);
  midi.header.name = trackName;
  const track = midi.addTrack();
  track.name = trackName;
  const secPerBeat = 60 / Math.max(30, bpm);

  for (const n of notes) {
    track.addNote({
      midi: Math.max(0, Math.min(127, Math.round(n.midi))),
      time: Math.max(0, n.startBeat * secPerBeat),
      duration: Math.max(0.02, n.duration * secPerBeat),
      velocity: Math.max(0.05, Math.min(1, n.velocity)),
    });
  }
  return midi.toArray();
}

/** Import Standard MIDI File (SMF Type 0/1) into Piano Roll notes */
export function importSmfToNotes(bytes: Uint8Array, fallbackBpm = 128): { bpm: number; notes: PianoNote[] } {
  const midi = new MidiCtor(bytes);
  const bpm = midi.header.tempos[0]?.bpm || fallbackBpm;
  const secPerBeat = 60 / Math.max(30, bpm);
  const notes: PianoNote[] = [];

  for (const track of midi.tracks) {
    for (const n of track.notes) {
      notes.push({
        id: uid('mid'),
        midi: n.midi,
        startBeat: Math.round((n.time / secPerBeat) * 16) / 16,
        duration: Math.max(0.125, Math.round((n.duration / secPerBeat) * 16) / 16),
        velocity: Math.max(0.08, Math.min(1, n.velocity)),
        pan: 0,
      });
    }
  }

  return { bpm: Math.round(bpm), notes: notes.sort((a, b) => a.startBeat - b.startBeat) };
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

/**
 * Full multi-track Standard MIDI File (SMF Type 0/1) parser with tempo, time signature,
 * GM program classification, and automatic instrument engine mapping.
 */
export function parseSmfMultiTrack(bytes: Uint8Array, fileName = 'Imported.mid', fallbackBpm = 128): ParsedMidiFile {
  const midi = new MidiCtor(bytes);
  const bpm = Math.round(midi.header.tempos[0]?.bpm || fallbackBpm);
  const tsRaw = midi.header.timeSignatures[0]?.timeSignature;
  const timeSignature: [number, number] =
    Array.isArray(tsRaw) && tsRaw.length >= 2 ? [tsRaw[0], tsRaw[1]] : [4, 4];
  const secPerBeat = 60 / Math.max(30, bpm);

  let maxBeat = 4;
  const tracks: ParsedMidiTrack[] = [];

  midi.tracks.forEach((tr, idx) => {
    if (!tr.notes || tr.notes.length === 0) return;
    const isPerc = tr.channel === 9 || tr.instrument?.percussion === true;
    const prog = tr.instrument?.number ?? 0;
    const instName = tr.instrument?.name || (isPerc ? 'Drums' : 'Piano');

    let recommendedEngine: ParsedMidiTrack['recommendedEngine'] = 'SoundFont';
    let recommendedPreset: string | undefined;
    if (isPerc) {
      recommendedEngine = 'DrumSynth';
    } else if (prog >= 32 && prog <= 39) {
      recommendedEngine = 'SubSynth';
      recommendedPreset = 'Acid 303 Bass';
    } else if (prog >= 40 && prog <= 55) {
      recommendedEngine = 'SubSynth';
      recommendedPreset = 'Lush Juno Pad';
    } else if (prog >= 80 && prog <= 95) {
      recommendedEngine = 'FMSynth';
      recommendedPreset = 'Modular FM Pluck';
    } else if (prog >= 4 && prog <= 15) {
      recommendedEngine = 'FMSynth';
      recommendedPreset = 'Electric Tine Keys';
    } else {
      recommendedEngine = 'SoundFont';
    }

    let minMidi = 127;
    let maxMidi = 0;
    const notes: PianoNote[] = tr.notes.map((n) => {
      if (n.midi < minMidi) minMidi = n.midi;
      if (n.midi > maxMidi) maxMidi = n.midi;
      const sb = Math.max(0, Math.round((n.time / secPerBeat) * 16) / 16);
      const dur = Math.max(0.125, Math.round((n.duration / secPerBeat) * 16) / 16);
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

    tracks.push({
      index: idx,
      name: tr.name?.trim() || `${instName} ${tracks.length + 1}`,
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
  });

  return {
    name: fileName.replace(/\.(mid|midi)$/i, ''),
    bpm: Math.max(40, Math.min(260, bpm)),
    timeSignature,
    totalBeats: Math.max(4, Math.ceil(maxBeat / 4) * 4),
    tracks,
  };
}
