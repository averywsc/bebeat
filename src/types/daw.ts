export type InstrumentEngine = 'SubSynth' | 'FMSynth' | 'DrumSynth' | 'Sampler' | 'SoundFont';

export type WorkspaceTab =
  | 'channel-rack'
  | 'piano-roll'
  | 'playlist'
  | 'mixer'
  | 'instruments'
  | 'audio-editor'
  | 'score'
  | 'performance'
  | 'live-code';

export type EditorTool =
  | 'draw'
  | 'paint'
  | 'delete'
  | 'mute'
  | 'slip'
  | 'slice'
  | 'select'
  | 'zoom'
  | 'playback';

export type TrackKind = 'software' | 'audio' | 'drummer' | 'master';

export interface PlaylistTrackMeta {
  index: number;
  name: string;
  kind: TrackKind;
  locked: boolean;
  muted: boolean;
  solo: boolean;
}

export type OscWaveform = 'sine' | 'triangle' | 'sawtooth' | 'square' | 'wavetable';
export type FilterMode = 'lowpass' | 'highpass' | 'bandpass' | 'notch';

export type ModSourceId =
  | 'beat.phase'
  | 'bar.phase'
  | 'beat.onBeat1'
  | 'onset'
  | 'env.master'
  | 'env.kick'
  | 'bands.sub'
  | 'bands.lowMid'
  | 'bands.highMid'
  | 'bands.air'
  | 'lfo.1';

export type ModTargetParam =
  | 'cutoff'
  | 'resonance'
  | 'fmIndex'
  | 'pitch'
  | 'detune'
  | 'pan'
  | 'gain'
  | 'reverbMix'
  | 'delayFeedback'
  | 'saturationDrive';

export interface ModRoute {
  id: string;
  enabled: boolean;
  source: ModSourceId;
  targetType: 'channel' | 'mixer';
  targetId: string; // channelId or mixerTrackId
  param: ModTargetParam;
  depth: number; // -1..1
  min: number;
  max: number;
}

export interface AdsrParams {
  attack: number;  // sec
  decay: number;   // sec
  sustain: number; // 0..1
  release: number; // sec
}

export interface SubSynthParams {
  presetName: string;
  osc1Wave: OscWaveform;
  osc2Wave: OscWaveform;
  oscMix: number;        // 0 = osc1, 1 = osc2
  osc2Semi: number;      // -24..24
  osc2Detune: number;    // cents
  wavetableName: string;
  wavetableMorph: number; // 0..1
  unisonVoices: number;  // 1..5
  unisonDetune: number;  // cents
  stereoSpread: number;  // 0..1
  filterMode: FilterMode;
  cutoff: number;        // Hz 40..18000
  resonance: number;     // 0.1..20
  filterEnvAmount: number; // Hz -8000..8000
  ampEnv: AdsrParams;
  filterEnv: AdsrParams;
  lfoRateHz: number;
  lfoDepth: number;
  lfoTarget: 'cutoff' | 'pitch' | 'pan';
  glide: number;         // sec
  drive: number;         // 0..1
}

export interface FmOperatorParams {
  ratio: number;
  detune: number;
  level: number;
  env: AdsrParams;
}

export interface FmSynthParams {
  presetName: string;
  algorithm: 0 | 1 | 2 | 3 | 4 | 5; // 6 classic 4-op FM routing topologies
  feedback: number;   // 0..1
  modIndex: number;   // 0..12
  cutoff: number;     // Hz
  resonance: number;
  operators: [FmOperatorParams, FmOperatorParams, FmOperatorParams, FmOperatorParams];
}

export type DrumVoiceName = 'bd' | 'sn' | 'cp' | 'hh' | 'oh' | 'rim' | 'lt' | 'perc';

export interface DrumSynthParams {
  kitId: string;
  voice: DrumVoiceName;
  useSample: boolean;
  tuneSemi: number;
  decay: number;
  tone: number;
  drive: number;
  snap: number;
}

export interface SamplerParams {
  sampleName: string;
  assetPath: string; // e.g., "808_clean/bd.wav" or custom uploaded name
  rootMidi: number;
  startNorm: number; // 0..1
  endNorm: number;   // 0..1
  loop: boolean;
  cutoff: number;
  ampEnv: AdsrParams;
}

export interface SoundFontParams {
  sf2Name: string;
  presetIndex: number;
  cutoff: number;
  release: number;
}

export interface StepCell {
  active: boolean;
  velocity: number;    // 0..1
  pitchOffset: number; // semitones -24..24
  pan: number;         // -1..1
  ratchet: 1 | 2 | 3 | 4;
  probability: number; // 0..1
}

export interface PianoNote {
  id: string;
  midi: number;      // 0..127
  startBeat: number; // in beats (1 bar = 4 beats)
  duration: number;  // in beats
  velocity: number;  // 0..1
  pan: number;       // -1..1
  slide?: boolean;
}

export interface Channel {
  id: string;
  name: string;
  engine: InstrumentEngine;
  color: string;
  mixerTrackId: string;
  volume: number; // 0..1.5
  pan: number;    // -1..1
  mute: boolean;
  solo: boolean;
  subSynth: SubSynthParams;
  fmSynth: FmSynthParams;
  drumSynth: DrumSynthParams;
  sampler: SamplerParams;
  soundFont: SoundFontParams;
  /** Optional binding name used by live code (e.g., "drums", "bass", "lead", "pad") */
  liveCodeAlias?: string;
  /** Plugin database identity (e.g., "FLEX", "Harmor", "Transistor Bass", "Sakura", "Layer") */
  pluginId?: string;
  pluginName?: string;
  /** Child channel IDs triggered simultaneously when engine/plugin is Layer */
  layerChildIds?: string[];
}

export interface Pattern {
  id: string;
  name: string;
  lengthSteps: 16 | 32 | 64;
  /** Map channelId -> StepCell[] */
  steps: Record<string, StepCell[]>;
  /** Map channelId -> PianoNote[] */
  notes: Record<string, PianoNote[]>;
}

export type FxType =
  | 'eq4'
  | 'compressor'
  | 'reverb'
  | 'delay'
  | 'saturation'
  | 'filter'
  | 'chorus';

export interface FxSlot {
  id: string;
  type: FxType;
  pluginId?: string;
  pluginName?: string;
  enabled: boolean;
  params: Record<string, number>;
}

export interface MixerTrack {
  id: string;
  index: number; // 0 = Master, 1..N = Insert tracks, 100+ = Sends
  name: string;
  kind: 'master' | 'insert' | 'send';
  volume: number; // linear 0..1.5 (1.0 = 0 dB)
  pan: number;    // -1..1
  mute: boolean;
  solo: boolean;
  sendA: number;  // 0..1
  sendB: number;  // 0..1
  sidechainDuck?: number; // 0..1 kick-driven ducking depth
  fx: FxSlot[];
}

export interface PlaylistClip {
  id: string;
  trackIndex: number;
  kind: 'pattern' | 'audio';
  patternId?: string;
  audioBufferId?: string;
  label: string;
  startBeat: number;
  durationBeats: number;
  offsetBeats: number;
  muted: boolean;
}

export interface AutomationPoint {
  beat: number;
  value: number; // 0..1 normalized
}

export interface AutomationLane {
  id: string;
  name: string;
  targetType: 'channel' | 'mixer';
  targetId: string;
  param: ModTargetParam;
  min: number;
  max: number;
  points: AutomationPoint[];
}

export type LiveCodeLang = 'javascript' | 'python';

export interface LiveCodeBuffer {
  id: string;
  name: string;
  lang: LiveCodeLang;
  code: string;
  quantize: 'beat' | 'bar' | 'immediate';
  active: boolean;
}

export interface CodePreset {
  id: string;
  name: string;
  category: string;
  lang: LiveCodeLang;
  description: string;
  bpm: number;
  code: string;
  isUser?: boolean;
}

export interface CodeSnippet {
  id: string;
  name: string;
  category: string;
  lang: LiveCodeLang;
  code: string;
}

export interface MidiMapping {
  cc: number;
  channel: number;
  targetType: 'channel' | 'mixer' | 'transport';
  targetId: string;
  param: string;
  min: number;
  max: number;
}

export interface ProjectState {
  version: string;
  name: string;
  bpm: number;
  swing: number; // 0..0.45
  timeSignature: [number, number];
  playbackMode: 'pattern' | 'song';
  loopEnabled: boolean;
  loopStartBeat: number;
  loopEndBeat: number;
  metronome: boolean;
  recording: boolean;
  recordQuantize: boolean;
  overdubRecording: boolean;
  automationRecording: boolean;
  stepEntryMode: boolean;
  typingKeyboardEnabled: boolean;
  typingOctave: number; // base octave e.g. 3 => C3..E5
  masterPitchSemi: number; // -12..+12 global pitch shift
  activeTool: EditorTool;
  themeId: string;
  browserOpen: boolean;
  notebookText: string;
  playlistTracks: PlaylistTrackMeta[];
  tempoTrackPoints: Array<{ beat: number; bpm: number }>;
  activePatternId: string;
  selectedChannelId: string;
  selectedMixerTrackId: string;
  channels: Channel[];
  patterns: Pattern[];
  mixerTracks: MixerTrack[];
  playlistClips: PlaylistClip[];
  automationLanes: AutomationLane[];
  modRoutes: ModRoute[];
  liveCodeBuffers: LiveCodeBuffer[];
  activeLiveCodeBufferId: string;
  userCodePresets: CodePreset[];
  midiMappings: MidiMapping[];
}

export interface TelemetryFrame {
  playing: boolean;
  beatPosition: number;
  beatPhase: number;
  barPhase: number;
  peakL: number;
  peakR: number;
  rmsL: number;
  rmsR: number;
  truePeakDb: number;
  lufsMomentary: number;
  lufsShortTerm: number;
  bands: {
    sub: number;
    lowMid: number;
    highMid: number;
    air: number;
  };
  env: number;
  kickEnv: number;
  onset: number;
  fft: Float32Array;
  wave: Float32Array;
  sabActive: boolean;
}

export interface ExportConfig {
  format: 'wav32f' | 'wav24' | 'wav16' | 'flac' | 'aiff' | 'mp3' | 'ogg';
  sampleRate: 44100 | 48000 | 96000;
  dither: 'none' | 'tpdf' | 'shaped';
  truePeakCeilingDb: number; // e.g., -1.0 or -0.3 dBTP
  range: 'loop' | 'selection' | 'full';
  exportStems: boolean;
  preserveTailSec: number; // auto reverb/delay tail
  selectionStartBeat: number;
  selectionEndBeat: number;
}

export interface LiveCodeCompiledEvent {
  channelName: string;
  engine: InstrumentEngine;
  kitId?: string;
  preset?: string;
  mixerIndex: number;
  gain: number;
  atBeat: number;     // beat offset inside loopBars
  durationBeats: number;
  midi?: number;      // melodic note
  drumVoice?: DrumVoiceName; // drum hit
  velocity: number;
  pan: number;
  cutoff?: number;
  cutoffMod?: { source: string; min: number; max: number };
}

export interface LiveCodeCompiledProgram {
  ok: boolean;
  lang: LiveCodeLang;
  bpm?: number;
  swing?: number;
  loopBars: number;
  events: LiveCodeCompiledEvent[];
  modOverrides: Array<{
    channelName: string;
    param: ModTargetParam;
    source: ModSourceId;
    min: number;
    max: number;
  }>;
  logs: string[];
  error?: string;
}
