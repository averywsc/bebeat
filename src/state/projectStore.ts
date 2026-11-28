import type {
  AutomationLane,
  Channel,
  CodePreset,
  FxSlot,
  FxType,
  InstrumentEngine,
  LiveCodeBuffer,
  MidiMapping,
  MixerTrack,
  ModRoute,
  Pattern,
  PianoNote,
  PlaylistClip,
  ProjectState,
  StepCell,
} from '../types/daw';
import { BUILTIN_CODE_PRESETS, FM_SYNTH_PRESETS, SUB_SYNTH_PRESETS } from './presets';

let idCounter = 1;
export function uid(prefix: string): string {
  return `${prefix}_${Date.now().toString(36)}_${(idCounter++).toString(36)}`;
}

export function createEmptySteps(length: 16 | 32 | 64 = 16): StepCell[] {
  return Array.from({ length }, () => ({
    active: false,
    velocity: 0.84,
    pitchOffset: 0,
    pan: 0,
    ratchet: 1,
    probability: 1,
  }));
}

function stepsFromIndices(length: 16 | 32 | 64, indices: number[], velMap?: Record<number, number>): StepCell[] {
  const arr = createEmptySteps(length);
  for (const idx of indices) {
    if (idx >= 0 && idx < length) {
      arr[idx].active = true;
      if (velMap && velMap[idx] !== undefined) arr[idx].velocity = velMap[idx];
    }
  }
  return arr;
}

export function createDefaultFxSlot(type: FxType): FxSlot {
  const defaults: Record<FxType, Record<string, number>> = {
    eq4: { lowGain: 0, lowMidGain: 0, highMidGain: 0, highGain: 0, lowFreq: 90, highFreq: 8000 },
    compressor: { threshold: -14, ratio: 4, attack: 0.008, release: 0.14, makeup: 2 },
    reverb: { mix: 0.22, decay: 1.8, damping: 4500 },
    delay: { mix: 0.2, division: 0.375, feedback: 0.36, tone: 3600 },
    saturation: { drive: 0.28, mix: 0.5, tone: 6500 },
    filter: { cutoff: 4200, resonance: 1.4, mode: 0 },
    chorus: { mix: 0.28, rate: 0.8, depth: 0.45 },
  };
  return {
    id: uid('fx'),
    type,
    enabled: true,
    params: { ...defaults[type] },
  };
}

export function createChannel(opts: {
  id?: string;
  name: string;
  engine: InstrumentEngine;
  mixerTrackId: string;
  color: string;
  subPreset?: string;
  fmPreset?: string;
  kitId?: string;
  drumVoice?: Channel['drumSynth']['voice'];
  liveCodeAlias?: string;
}): Channel {
  const sub = SUB_SYNTH_PRESETS[opts.subPreset || 'Acid 303 Bass'] || SUB_SYNTH_PRESETS['Acid 303 Bass'];
  const fm = FM_SYNTH_PRESETS[opts.fmPreset || 'Electric Tine Keys'] || FM_SYNTH_PRESETS['Electric Tine Keys'];
  return {
    id: opts.id || uid('ch'),
    name: opts.name,
    engine: opts.engine,
    color: opts.color,
    mixerTrackId: opts.mixerTrackId,
    volume: 0.88,
    pan: 0,
    mute: false,
    solo: false,
    subSynth: JSON.parse(JSON.stringify(sub)),
    fmSynth: JSON.parse(JSON.stringify(fm)),
    drumSynth: {
      kitId: opts.kitId || '808_clean',
      voice: opts.drumVoice || 'bd',
      useSample: true,
      tuneSemi: 0,
      decay: 0.35,
      tone: 0.5,
      drive: 0.2,
      snap: 0.65,
    },
    sampler: {
      sampleName: '808_clean/bd.wav',
      assetPath: 'kits/808_clean/bd.wav',
      rootMidi: 60,
      startNorm: 0,
      endNorm: 1,
      loop: false,
      cutoff: 16000,
      ampEnv: { attack: 0.002, decay: 0.2, sustain: 0.9, release: 0.15 },
    },
    soundFont: {
      sf2Name: 'bebeat_starter.sf2',
      presetIndex: 0,
      cutoff: 12000,
      release: 0.35,
    },
    liveCodeAlias: opts.liveCodeAlias,
  };
}

export function createInitialProject(): ProjectState {
  const mixerTracks: MixerTrack[] = [
    {
      id: 'mx_master',
      index: 0,
      name: 'Master',
      kind: 'master',
      volume: 0.96,
      pan: 0,
      mute: false,
      solo: false,
      sendA: 0,
      sendB: 0,
      fx: [
        { ...createDefaultFxSlot('eq4'), id: 'fx_m_eq', params: { lowGain: 0.8, lowMidGain: -0.5, highMidGain: 0.4, highGain: 1.0, lowFreq: 85, highFreq: 9500 } },
        { ...createDefaultFxSlot('compressor'), id: 'fx_m_comp', params: { threshold: -10, ratio: 2.5, attack: 0.015, release: 0.12, makeup: 1.5 } },
      ],
    },
    {
      id: 'mx_1',
      index: 1,
      name: 'Drums',
      kind: 'insert',
      volume: 0.92,
      pan: 0,
      mute: false,
      solo: false,
      sendA: 0.08,
      sendB: 0.05,
      fx: [createDefaultFxSlot('saturation')],
    },
    {
      id: 'mx_2',
      index: 2,
      name: 'Bass',
      kind: 'insert',
      volume: 0.86,
      pan: 0,
      mute: false,
      solo: false,
      sendA: 0.04,
      sendB: 0,
      fx: [createDefaultFxSlot('filter')],
    },
    {
      id: 'mx_3',
      index: 3,
      name: 'FM Lead',
      kind: 'insert',
      volume: 0.78,
      pan: 0.08,
      mute: false,
      solo: false,
      sendA: 0.28,
      sendB: 0.24,
      fx: [createDefaultFxSlot('delay')],
    },
    {
      id: 'mx_4',
      index: 4,
      name: 'Keys / Pad',
      kind: 'insert',
      volume: 0.76,
      pan: -0.06,
      mute: false,
      solo: false,
      sendA: 0.35,
      sendB: 0.14,
      fx: [createDefaultFxSlot('chorus')],
    },
    {
      id: 'mx_5',
      index: 5,
      name: 'Aux / Code',
      kind: 'insert',
      volume: 0.85,
      pan: 0,
      mute: false,
      solo: false,
      sendA: 0.15,
      sendB: 0.15,
      fx: [],
    },
    {
      id: 'mx_send_a',
      index: 101,
      name: 'Send A (Verb)',
      kind: 'send',
      volume: 0.75,
      pan: 0,
      mute: false,
      solo: false,
      sendA: 0,
      sendB: 0,
      fx: [{ ...createDefaultFxSlot('reverb'), params: { mix: 1.0, decay: 2.4, damping: 4200 } }],
    },
    {
      id: 'mx_send_b',
      index: 102,
      name: 'Send B (Delay)',
      kind: 'send',
      volume: 0.7,
      pan: 0,
      mute: false,
      solo: false,
      sendA: 0,
      sendB: 0,
      fx: [{ ...createDefaultFxSlot('delay'), params: { mix: 1.0, division: 0.375, feedback: 0.45, tone: 3200 } }],
    },
  ];

  const channels: Channel[] = [
    createChannel({ id: 'ch_kick', name: '808 Kick', engine: 'DrumSynth', mixerTrackId: 'mx_1', color: '#E2E8F0', kitId: '808_clean', drumVoice: 'bd', liveCodeAlias: 'drums' }),
    createChannel({ id: 'ch_clap', name: '808 Clap / Snare', engine: 'DrumSynth', mixerTrackId: 'mx_1', color: '#CBD5E1', kitId: '808_clean', drumVoice: 'cp' }),
    createChannel({ id: 'ch_hat', name: '808 Hi-Hat', engine: 'DrumSynth', mixerTrackId: 'mx_1', color: '#94A3B8', kitId: '808_clean', drumVoice: 'hh' }),
    createChannel({ id: 'ch_bass', name: 'SubSynth Acid Bass', engine: 'SubSynth', mixerTrackId: 'mx_2', color: '#60A5FA', subPreset: 'Acid 303 Bass', liveCodeAlias: 'bass' }),
    createChannel({ id: 'ch_lead', name: 'FMSynth Modular Arp', engine: 'FMSynth', mixerTrackId: 'mx_3', color: '#38BDF8', fmPreset: 'Modular FM Pluck', liveCodeAlias: 'lead' }),
    createChannel({ id: 'ch_keys', name: 'SoundFont EPiano', engine: 'SoundFont', mixerTrackId: 'mx_4', color: '#A5B4FC', liveCodeAlias: 'pad' }),
  ];

  const pat1NotesBass: PianoNote[] = [
    { id: 'n_b1', midi: 36, startBeat: 0.0, duration: 0.5, velocity: 0.92, pan: 0 },
    { id: 'n_b2', midi: 36, startBeat: 0.75, duration: 0.25, velocity: 0.76, pan: 0 },
    { id: 'n_b3', midi: 39, startBeat: 1.5, duration: 0.5, velocity: 0.88, pan: 0 },
    { id: 'n_b4', midi: 43, startBeat: 2.0, duration: 0.5, velocity: 0.9, pan: 0 },
    { id: 'n_b5', midi: 41, startBeat: 2.75, duration: 0.5, velocity: 0.82, pan: 0, slide: true },
    { id: 'n_b6', midi: 38, startBeat: 3.5, duration: 0.5, velocity: 0.84, pan: 0 },
  ];

  const pat1NotesLead: PianoNote[] = [
    { id: 'n_l1', midi: 60, startBeat: 0.0, duration: 0.25, velocity: 0.82, pan: -0.15 },
    { id: 'n_l2', midi: 63, startBeat: 0.5, duration: 0.25, velocity: 0.74, pan: 0.15 },
    { id: 'n_l3', midi: 67, startBeat: 1.0, duration: 0.25, velocity: 0.86, pan: -0.1 },
    { id: 'n_l4', midi: 70, startBeat: 1.75, duration: 0.25, velocity: 0.72, pan: 0.2 },
    { id: 'n_l5', midi: 74, startBeat: 2.25, duration: 0.25, velocity: 0.84, pan: -0.2 },
    { id: 'n_l6', midi: 67, startBeat: 3.0, duration: 0.25, velocity: 0.78, pan: 0.1 },
    { id: 'n_l7', midi: 63, startBeat: 3.5, duration: 0.25, velocity: 0.7, pan: -0.1 },
  ];

  const pat1NotesKeys: PianoNote[] = [
    // Cm9 chord across bar
    { id: 'n_k1', midi: 48, startBeat: 0, duration: 2.0, velocity: 0.62, pan: -0.1 },
    { id: 'n_k2', midi: 51, startBeat: 0, duration: 2.0, velocity: 0.58, pan: 0.0 },
    { id: 'n_k3', midi: 55, startBeat: 0, duration: 2.0, velocity: 0.6, pan: 0.1 },
    { id: 'n_k4', midi: 58, startBeat: 0, duration: 2.0, velocity: 0.55, pan: 0.15 },
    // AbMaj7
    { id: 'n_k5', midi: 44, startBeat: 2.0, duration: 2.0, velocity: 0.62, pan: -0.1 },
    { id: 'n_k6', midi: 48, startBeat: 2.0, duration: 2.0, velocity: 0.58, pan: 0.0 },
    { id: 'n_k7', midi: 51, startBeat: 2.0, duration: 2.0, velocity: 0.6, pan: 0.1 },
    { id: 'n_k8', midi: 55, startBeat: 2.0, duration: 2.0, velocity: 0.55, pan: 0.15 },
  ];

  const pat1: Pattern = {
    id: 'pat_1',
    name: 'Pattern 1 — Main Groove',
    lengthSteps: 16,
    steps: {
      ch_kick: stepsFromIndices(16, [0, 4, 8, 10, 12], { 0: 0.98, 4: 0.92, 8: 0.95, 10: 0.72, 12: 0.94 }),
      ch_clap: stepsFromIndices(16, [4, 12], { 4: 0.88, 12: 0.92 }),
      ch_hat: stepsFromIndices(16, [0, 2, 4, 6, 8, 10, 12, 14, 15], { 2: 0.9, 6: 0.9, 10: 0.9, 14: 0.92, 15: 0.55 }),
      ch_bass: createEmptySteps(16),
      ch_lead: createEmptySteps(16),
      ch_keys: createEmptySteps(16),
    },
    notes: {
      ch_bass: pat1NotesBass,
      ch_lead: pat1NotesLead,
      ch_keys: pat1NotesKeys,
    },
  };

  const pat2: Pattern = {
    id: 'pat_2',
    name: 'Pattern 2 — Break & Lift',
    lengthSteps: 16,
    steps: {
      ch_kick: stepsFromIndices(16, [0, 6, 10, 14]),
      ch_clap: stepsFromIndices(16, [4, 12, 15]),
      ch_hat: stepsFromIndices(16, [0, 1, 2, 4, 5, 6, 8, 9, 10, 12, 13, 14, 15]),
      ch_bass: createEmptySteps(16),
      ch_lead: createEmptySteps(16),
      ch_keys: createEmptySteps(16),
    },
    notes: {
      ch_bass: pat1NotesBass.map((n, i) => ({ ...n, id: `n_b2_${i}`, midi: n.midi + 5 })),
      ch_lead: pat1NotesLead.map((n, i) => ({ ...n, id: `n_l2_${i}`, midi: n.midi + 3 })),
      ch_keys: pat1NotesKeys.map((n, i) => ({ ...n, id: `n_k2_${i}` })),
    },
  };

  const playlistClips: PlaylistClip[] = [
    { id: 'clip_1', trackIndex: 0, kind: 'pattern', patternId: 'pat_1', label: 'Pattern 1 — Main Groove', startBeat: 0, durationBeats: 4, offsetBeats: 0, muted: false },
    { id: 'clip_2', trackIndex: 0, kind: 'pattern', patternId: 'pat_1', label: 'Pattern 1 — Main Groove', startBeat: 4, durationBeats: 4, offsetBeats: 0, muted: false },
    { id: 'clip_3', trackIndex: 0, kind: 'pattern', patternId: 'pat_2', label: 'Pattern 2 — Break & Lift', startBeat: 8, durationBeats: 4, offsetBeats: 0, muted: false },
    { id: 'clip_4', trackIndex: 0, kind: 'pattern', patternId: 'pat_1', label: 'Pattern 1 — Main Groove', startBeat: 12, durationBeats: 4, offsetBeats: 0, muted: false },
  ];

  const automationLanes: AutomationLane[] = [
    {
      id: 'auto_1',
      name: 'Bass Filter Cutoff',
      targetType: 'channel',
      targetId: 'ch_bass',
      param: 'cutoff',
      min: 220,
      max: 4200,
      points: [
        { beat: 0, value: 0.25 },
        { beat: 4, value: 0.48 },
        { beat: 8, value: 0.88 },
        { beat: 12, value: 0.35 },
        { beat: 16, value: 0.65 },
      ],
    },
  ];

  const modRoutes: ModRoute[] = [
    {
      id: 'mod_1',
      enabled: true,
      source: 'bands.sub',
      targetType: 'channel',
      targetId: 'ch_lead',
      param: 'cutoff',
      depth: 0.65,
      min: 400,
      max: 5800,
    },
    {
      id: 'mod_2',
      enabled: true,
      source: 'beat.phase',
      targetType: 'channel',
      targetId: 'ch_bass',
      param: 'cutoff',
      depth: 0.4,
      min: 260,
      max: 2600,
    },
  ];

  const liveCodeBuffers: LiveCodeBuffer[] = [
    {
      id: 'buf_js_main',
      name: 'main.js',
      lang: 'javascript',
      code: BUILTIN_CODE_PRESETS[0].code,
      quantize: 'bar',
      active: false,
    },
    {
      id: 'buf_py_main',
      name: 'algo.py',
      lang: 'python',
      code: BUILTIN_CODE_PRESETS[5].code,
      quantize: 'bar',
      active: false,
    },
  ];

  return {
    version: '1.3.0',
    name: 'Untitled Studio Session',
    bpm: 128,
    swing: 0.08,
    timeSignature: [4, 4],
    playbackMode: 'pattern',
    loopEnabled: true,
    loopStartBeat: 0,
    loopEndBeat: 16,
    metronome: false,
    recording: false,
    recordQuantize: true,
    overdubRecording: true,
    automationRecording: false,
    stepEntryMode: false,
    typingKeyboardEnabled: true,
    typingOctave: 3,
    masterPitchSemi: 0,
    activeTool: 'draw',
    themeId: 'totone-pro',
    browserOpen: true,
    notebookText: 'Session Notes:\n- 128 BPM C minor studio groove\n- Use Z..M / Q..P to play or record live\n- Insert any of 76 FX plugins from the Browser or Mixer',
    playlistTracks: [
      { index: 0, name: 'Drums & Groove', kind: 'drummer', locked: false, muted: false, solo: false },
      { index: 1, name: 'Synth & Patterns', kind: 'software', locked: false, muted: false, solo: false },
      { index: 2, name: 'Audio / Vocals', kind: 'audio', locked: false, muted: false, solo: false },
      { index: 3, name: 'Chords & Keys', kind: 'software', locked: false, muted: false, solo: false },
      { index: 4, name: 'FX & Risers', kind: 'audio', locked: false, muted: false, solo: false },
      { index: 5, name: 'Master Bus Track', kind: 'master', locked: false, muted: false, solo: false },
    ],
    tempoTrackPoints: [
      { beat: 0, bpm: 128 },
      { beat: 16, bpm: 128 },
      { beat: 32, bpm: 128 },
    ],
    activePatternId: 'pat_1',
    selectedChannelId: 'ch_bass',
    selectedMixerTrackId: 'mx_master',
    channels,
    patterns: [pat1, pat2],
    mixerTracks,
    playlistClips,
    automationLanes,
    modRoutes,
    liveCodeBuffers,
    activeLiveCodeBufferId: 'buf_js_main',
    userCodePresets: [],
    midiMappings: [],
  };
}

type Listener = () => void;

class ProjectStore {
  private state: ProjectState;
  private past: ProjectState[] = [];
  private future: ProjectState[] = [];
  private listeners = new Set<Listener>();

  constructor() {
    this.state = createInitialProject();
  }

  getState = (): ProjectState => this.state;

  subscribe = (listener: Listener): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  private emit() {
    for (const l of this.listeners) l();
  }

  update(mutator: (draft: ProjectState) => void, recordHistory = true): void {
    if (recordHistory) {
      this.past.push(JSON.parse(JSON.stringify(this.state)));
      if (this.past.length > 40) this.past.shift();
      this.future = [];
    }
    const next: ProjectState = JSON.parse(JSON.stringify(this.state));
    mutator(next);
    this.state = next;
    this.emit();
  }

  replaceState(next: ProjectState): void {
    this.past = [];
    this.future = [];
    this.state = next;
    this.emit();
  }

  undo(): void {
    const prev = this.past.pop();
    if (!prev) return;
    this.future.push(JSON.parse(JSON.stringify(this.state)));
    this.state = prev;
    this.emit();
  }

  redo(): void {
    const next = this.future.pop();
    if (!next) return;
    this.past.push(JSON.parse(JSON.stringify(this.state)));
    this.state = next;
    this.emit();
  }

  canUndo(): boolean {
    return this.past.length > 0;
  }

  canRedo(): boolean {
    return this.future.length > 0;
  }

  addUserCodePreset(preset: Omit<CodePreset, 'id' | 'isUser'>): void {
    this.update((s) => {
      s.userCodePresets.unshift({
        ...preset,
        id: uid('upreset'),
        isUser: true,
      });
    });
  }

  addMidiMapping(mapping: MidiMapping): void {
    this.update((s) => {
      s.midiMappings = s.midiMappings.filter(
        (m) => !(m.cc === mapping.cc && m.channel === mapping.channel)
      );
      s.midiMappings.push(mapping);
    });
  }
}

export const projectStore = new ProjectStore();
