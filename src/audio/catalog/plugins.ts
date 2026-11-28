import type { FxType, InstrumentEngine } from '../../types/daw';

export interface InstrumentCatalogItem {
  id: string;
  name: string;
  category:
    | 'Synth'
    | 'Additive & Physical'
    | 'Bass & Acid'
    | 'Drums & Percussion'
    | 'Sampler & Slicer'
    | 'Amp & Guitar'
    | 'Orchestral & Keys'
    | 'Utility & Visual';
  description: string;
  baseEngine: InstrumentEngine;
  presetName?: string;
  kitId?: string;
  tags: string[];
}

export interface EffectCatalogItem {
  id: string;
  name: string;
  category:
    | 'EQ & Filter'
    | 'Dynamics & Mastering'
    | 'Delay & Reverb'
    | 'Distortion & Amp'
    | 'Modulation & Pitch'
    | 'Time & Creative'
    | 'Internal Controllers'
    | 'Meters & Visualizers'
    | 'Utility & Notes';
  description: string;
  dspEngine: FxType;
  defaultParams: Record<string, number>;
}

export interface LoopStarterItem {
  id: string;
  name: string;
  genre: string;
  bpm: number;
  swing: number;
  kitId: string;
  kickSteps: number[];
  snareSteps: number[];
  hatSteps: number[];
  bassNotes: Array<{ midi: number; startBeat: number; duration: number }>;
  chordRoot: string;
  chordQuality: string;
}

export interface ThemePreset {
  id: string;
  name: string;
  vars: Record<string, string>;
}

/** Complete FL Studio + GarageBand/Logic Instrument & Generator Database */
export const INSTRUMENT_CATALOG: InstrumentCatalogItem[] = [
  // Synthesizers & Generators
  { id: 'flex', name: 'FLEX', category: 'Synth', description: 'Production preset synthesizer with macro filter & unison engine', baseEngine: 'SubSynth', presetName: 'SuperSaw Anthem', tags: ['macro', 'presets', 'lead', 'pad'] },
  { id: 'harmor', name: 'Harmor', category: 'Additive & Physical', description: 'Additive / subtractive wavetable & resynthesis powerhouse', baseEngine: 'SubSynth', presetName: 'Glass Pad', tags: ['additive', 'wavetable', 'resynthesis'] },
  { id: 'harmless', name: 'Harmless', category: 'Additive & Physical', description: 'Harmonic subtractive synthesizer with bright formant sweep', baseEngine: 'SubSynth', presetName: 'Formant Wobble Bass', tags: ['additive', 'harmonic', 'bass'] },
  { id: 'transistor_bass', name: 'Transistor Bass', category: 'Bass & Acid', description: 'Resonant 303-style acid bassline synthesizer with slide & accent', baseEngine: 'SubSynth', presetName: 'Acid 303 Bass', tags: ['303', 'acid', 'bass', 'slide'] },
  { id: 'morphine', name: 'Morphine', category: 'Additive & Physical', description: 'Morphing additive harmonic spectrum synthesizer', baseEngine: 'SubSynth', presetName: 'Lush Juno Pad', tags: ['morph', 'additive', 'pad'] },
  { id: 'ogun', name: 'Ogun', category: 'Additive & Physical', description: 'Metallic rich harmonic & bell additive generator', baseEngine: 'FMSynth', presetName: 'Metallic Bell', tags: ['metallic', 'bells', 'chimes'] },
  { id: 'poizone', name: 'Poizone', category: 'Synth', description: 'Punchy dual-oscillator subtractive synth for leads and plucks', baseEngine: 'SubSynth', presetName: 'Hyper Lead', tags: ['subtractive', 'lead', 'trance'] },
  { id: 'sakura', name: 'Sakura', category: 'Additive & Physical', description: 'Physical-modeled plucked & bowed string resonator', baseEngine: 'FMSynth', presetName: 'Crystal Harp', tags: ['strings', 'pluck', 'physical'] },
  { id: 'toxic_biohazard', name: 'Toxic Biohazard', category: 'Synth', description: 'Hybrid FM / subtractive aggressive dark synth', baseEngine: 'FMSynth', presetName: 'Punchy FM Bass', tags: ['fm', 'dark', 'hybrid'] },
  { id: '3xosc', name: '3xOsc', category: 'Synth', description: 'Classic triple-oscillator versatile generator', baseEngine: 'SubSynth', presetName: 'Clean 808 Sub', tags: ['classic', 'oscillator', 'sub'] },
  { id: 'simsynth_live', name: 'SimSynth Live', category: 'Synth', description: 'Warm analog-modeled 3-oscillator synthesizer', baseEngine: 'SubSynth', presetName: 'Studio Pluck', tags: ['analog', 'warm', 'retro'] },
  { id: 'lsd', name: 'LSD', category: 'Orchestral & Keys', description: 'General MIDI SoundFont multi-timbral sound module', baseEngine: 'SoundFont', tags: ['gm', 'sf2', 'midi'] },

  // Drums & Percussion
  { id: 'drumaxx', name: 'Drumaxx', category: 'Drums & Percussion', description: 'Physical modeling drum kit synthesizer', baseEngine: 'DrumSynth', kitId: '909_punch', tags: ['drums', 'modeling'] },
  { id: 'drumpad', name: 'Drumpad', category: 'Drums & Percussion', description: 'Single-pad expressive modeled percussion cell', baseEngine: 'DrumSynth', kitId: 'fm_perc', tags: ['percussion', 'pad'] },
  { id: 'drumsynth_live', name: 'DrumSynth Live', category: 'Drums & Percussion', description: '8-voice analog synthesized drum machine', baseEngine: 'DrumSynth', kitId: '808_clean', tags: ['drums', 'analog', '808'] },
  { id: 'kick', name: 'Kick', category: 'Drums & Percussion', description: 'Dedicated pitch-envelope sub & punch kick generator', baseEngine: 'DrumSynth', kitId: '808_clean', tags: ['kick', 'sub', '808'] },
  { id: 'fpc', name: 'FPC', category: 'Drums & Percussion', description: '16-pad velocity-layered MPC-style drum sampler', baseEngine: 'DrumSynth', kitId: 'ukg_break', tags: ['mpc', 'pads', 'sampler'] },
  { id: 'drummer', name: 'Drummer', category: 'Drums & Percussion', description: 'Intelligent virtual session drummer with complexity/loudness X-Y pad', baseEngine: 'DrumSynth', kitId: '909_punch', tags: ['ai', 'session', 'groove'] },

  // Samplers & Slicers
  { id: 'sampler', name: 'Sampler', category: 'Sampler & Slicer', description: 'Full-range .wav / .flac chromatic sampler with ADSR & loop points', baseEngine: 'Sampler', tags: ['sample', 'wav', 'flac'] },
  { id: 'slicer', name: 'Slicer', category: 'Sampler & Slicer', description: 'Auto-transient beat slicer mapping slices to MIDI notes', baseEngine: 'Sampler', tags: ['slice', 'breaks', 'chop'] },
  { id: 'slicex', name: 'Slicex', category: 'Sampler & Slicer', description: 'Dual-deck advanced transient beat slicer & deck articulator', baseEngine: 'Sampler', tags: ['slicex', 'breaks', 'jungle'] },
  { id: 'wave_traveler', name: 'Wave Traveler', category: 'Sampler & Slicer', description: 'Envelope-controlled turntable scratch & sample path generator', baseEngine: 'Sampler', tags: ['scratch', 'turntable'] },

  // GarageBand / Logic Instruments & Amp Tools
  { id: 'strings', name: 'Strings', category: 'Orchestral & Keys', description: 'Lush studio ensemble strings with slow bow attack & stereo spread', baseEngine: 'SubSynth', presetName: 'Lush Juno Pad', tags: ['orchestral', 'violin', 'cello'] },
  { id: 'bass_inst', name: 'Bass', category: 'Bass & Acid', description: 'Deep studio electric & synth bass with warm low-end presence', baseEngine: 'SubSynth', presetName: 'Midnight Reese', tags: ['electric', 'sub', 'bass'] },
  { id: 'guitar', name: 'Guitar', category: 'Amp & Guitar', description: 'Plucked electric & acoustic guitar tone generator', baseEngine: 'FMSynth', presetName: 'Kalimba Wood Mallet', tags: ['guitar', 'pluck', 'strum'] },
  { id: 'amp_designer_inst', name: 'Amp Designer', category: 'Amp & Guitar', description: 'Guitar rig channel pre-routed with tube amplifier & cabinet tone', baseEngine: 'FMSynth', presetName: 'Electric Tine Keys', tags: ['amp', 'guitar', 'tube'] },
  { id: 'bass_amp_inst', name: 'Bass Amp Designer', category: 'Amp & Guitar', description: 'Dedicated bass amplifier & 8x10 cabinet rig channel', baseEngine: 'SubSynth', presetName: 'Clean 808 Sub', tags: ['bass', 'amp', 'cabinet'] },
  { id: 'pedalboard_inst', name: 'Pedalboard', category: 'Amp & Guitar', description: 'Stompbox performance channel with chained modulation & drive', baseEngine: 'SubSynth', presetName: 'Lo-Fi Tape Keys', tags: ['pedals', 'stompbox'] },

  // Utility & Visual Generators
  { id: 'layer', name: 'Layer', category: 'Utility & Visual', description: 'Meta-channel that triggers multiple child instruments simultaneously', baseEngine: 'SubSynth', presetName: 'SuperSaw Anthem', tags: ['layer', 'stack', 'routing'] },
  { id: 'dance', name: 'Dance', category: 'Utility & Visual', description: 'Beat-reactive dancer & rhythm pulse companion generator', baseEngine: 'DrumSynth', kitId: '808_clean', tags: ['visual', 'beat'] },
  { id: 'video_player_2', name: 'Video Player 2', category: 'Utility & Visual', description: 'Transport-synced video playback track for film scoring', baseEngine: 'Sampler', tags: ['video', 'scoring', 'sync'] },
];

/** Complete FL Studio + Logic/GarageBand Effect Plugin Database (76+ named plugins) */
export const EFFECT_CATALOG: EffectCatalogItem[] = [
  // EQ & Filter
  { id: 'parametric_eq_2', name: 'Parametric EQ 2', category: 'EQ & Filter', description: 'Precision 7-band visual parametric equalizer', dspEngine: 'eq4', defaultParams: { lowGain: 1.5, lowMidGain: -0.5, highMidGain: 0.8, highGain: 1.2, lowFreq: 90, highFreq: 8000 } },
  { id: 'parametric_eq', name: 'Parametric EQ', category: 'EQ & Filter', description: 'Classic multi-band parametric EQ', dspEngine: 'eq4', defaultParams: { lowGain: 0, lowMidGain: 0, highMidGain: 0, highGain: 0, lowFreq: 100, highFreq: 7500 } },
  { id: '7_band_eq', name: '7 Band EQ', category: 'EQ & Filter', description: 'Fixed-frequency graphic 7-band equalizer', dspEngine: 'eq4', defaultParams: { lowGain: 1, lowMidGain: 0, highMidGain: 0.5, highGain: 1, lowFreq: 80, highFreq: 9000 } },
  { id: 'equo', name: 'EQUO', category: 'EQ & Filter', description: 'Morphing graphic spectral equalizer', dspEngine: 'eq4', defaultParams: { lowGain: 2, lowMidGain: -1, highMidGain: 1.5, highGain: 0.5, lowFreq: 95, highFreq: 8500 } },
  { id: 'filter', name: 'Filter', category: 'EQ & Filter', description: 'Smooth state-variable LP/HP/BP/Notch filter', dspEngine: 'filter', defaultParams: { cutoff: 2800, resonance: 2.0, mode: 0 } },
  { id: 'free_filter', name: 'Free Filter', category: 'EQ & Filter', description: 'Clean resonant multi-mode filter', dspEngine: 'filter', defaultParams: { cutoff: 3400, resonance: 1.5, mode: 0 } },
  { id: 'fast_lp', name: 'Fast LP', category: 'EQ & Filter', description: 'Zero-latency DJ-style lowpass sweep filter', dspEngine: 'filter', defaultParams: { cutoff: 1800, resonance: 3.2, mode: 0 } },
  { id: 'love_philter', name: 'Love Philter', category: 'EQ & Filter', description: 'Modulated rhythmic resonant filter bank & gate', dspEngine: 'filter', defaultParams: { cutoff: 1400, resonance: 5.5, mode: 0 } },
  { id: 'frequency_splitter', name: 'Frequency Splitter', category: 'EQ & Filter', description: 'Linear-phase low/mid/high crossover splitter', dspEngine: 'eq4', defaultParams: { lowGain: 0, lowMidGain: 0, highMidGain: 0, highGain: 0, lowFreq: 200, highFreq: 4000 } },
  { id: 'bass_boost', name: 'Bass Boost', category: 'EQ & Filter', description: 'Focused sub-bass harmonic low shelf', dspEngine: 'eq4', defaultParams: { lowGain: 6.0, lowMidGain: 0, highMidGain: 0, highGain: 0, lowFreq: 85, highFreq: 8000 } },
  { id: 'low_lifter', name: 'Low Lifter', category: 'EQ & Filter', description: 'Psychoacoustic sub-harmonic bass enhancer', dspEngine: 'eq4', defaultParams: { lowGain: 4.5, lowMidGain: 1.5, highMidGain: 0, highGain: 0, lowFreq: 75, highFreq: 8000 } },

  // Dynamics & Mastering
  { id: 'compressor', name: 'Compressor', category: 'Dynamics & Mastering', description: 'Studio VCA dynamics compressor', dspEngine: 'compressor', defaultParams: { threshold: -16, ratio: 4, attack: 0.008, release: 0.14, makeup: 2 } },
  { id: 'limiter', name: 'Limiter', category: 'Dynamics & Mastering', description: 'Brickwall mastering ceiling limiter & noise gate', dspEngine: 'compressor', defaultParams: { threshold: -2, ratio: 20, attack: 0.002, release: 0.06, makeup: 1.5 } },
  { id: 'multiband_compressor', name: 'Multiband Compressor', category: 'Dynamics & Mastering', description: '3-band dynamics control for tight masters', dspEngine: 'compressor', defaultParams: { threshold: -14, ratio: 3.5, attack: 0.01, release: 0.15, makeup: 2.5 } },
  { id: 'maximus', name: 'Maximus', category: 'Dynamics & Mastering', description: 'Flagship multiband maximizer & mastering limiter', dspEngine: 'compressor', defaultParams: { threshold: -8, ratio: 8, attack: 0.004, release: 0.09, makeup: 4.5 } },
  { id: 'soundgoodizer', name: 'Soundgoodizer', category: 'Dynamics & Mastering', description: 'One-knob psychoacoustic punch & sheen maximizer (Modes A-D)', dspEngine: 'compressor', defaultParams: { threshold: -18, ratio: 6, attack: 0.005, release: 0.11, makeup: 5.0 } },
  { id: 'soft_clipper', name: 'Soft Clipper', category: 'Dynamics & Mastering', description: 'Warm analog soft-knee ceiling clipper', dspEngine: 'saturation', defaultParams: { drive: 0.32, mix: 0.75, tone: 14000 } },
  { id: 'transient_processor', name: 'Transient Processor', category: 'Dynamics & Mastering', description: 'Punch attack & release transient shaper', dspEngine: 'compressor', defaultParams: { threshold: -20, ratio: 3, attack: 0.025, release: 0.08, makeup: 3 } },
  { id: 'emphasis', name: 'Emphasis', category: 'Dynamics & Mastering', description: 'Transparent loudness & harmonic emphasis maximizer', dspEngine: 'compressor', defaultParams: { threshold: -10, ratio: 5, attack: 0.006, release: 0.1, makeup: 3.5 } },
  { id: 'emphasizer', name: 'Emphasizer', category: 'Dynamics & Mastering', description: 'Presence & clarity dynamic shaper', dspEngine: 'eq4', defaultParams: { lowGain: 1, lowMidGain: -1, highMidGain: 2.5, highGain: 2, lowFreq: 90, highFreq: 7000 } },
  { id: 'squeeze', name: 'Squeeze', category: 'Dynamics & Mastering', description: 'Bit-crushing & punchy bus squashing compressor', dspEngine: 'saturation', defaultParams: { drive: 0.55, mix: 0.65, tone: 5500 } },

  // Delay & Reverb
  { id: 'delay', name: 'Delay', category: 'Delay & Reverb', description: 'Classic tempo-synced feedback delay', dspEngine: 'delay', defaultParams: { mix: 0.25, division: 0.375, feedback: 0.38, tone: 4200 } },
  { id: 'delay_2', name: 'Delay 2', category: 'Delay & Reverb', description: 'Ping-pong stereo tempo delay with filter', dspEngine: 'delay', defaultParams: { mix: 0.28, division: 0.25, feedback: 0.45, tone: 3400 } },
  { id: 'delay_3', name: 'Delay 3', category: 'Delay & Reverb', description: 'Analog tape delay with diffusion, tone & saturation', dspEngine: 'delay', defaultParams: { mix: 0.3, division: 0.375, feedback: 0.52, tone: 2800 } },
  { id: 'delay_bank', name: 'Delay Bank', category: 'Delay & Reverb', description: 'Multi-tap 8-unit complex rhythmic delay matrix', dspEngine: 'delay', defaultParams: { mix: 0.32, division: 0.5, feedback: 0.55, tone: 3800 } },
  { id: 'multiband_delay', name: 'Multiband Delay', category: 'Delay & Reverb', description: 'Frequency-split spectral delay lines', dspEngine: 'delay', defaultParams: { mix: 0.34, division: 0.1875, feedback: 0.48, tone: 5200 } },
  { id: 'reeverb', name: 'Reeverb', category: 'Delay & Reverb', description: 'Clean studio room & hall reverb', dspEngine: 'reverb', defaultParams: { mix: 0.25, decay: 1.6, damping: 5000 } },
  { id: 'reeverb_2', name: 'Reeverb 2', category: 'Delay & Reverb', description: 'Dense algorithmic hall reverb with high-cut damping', dspEngine: 'reverb', defaultParams: { mix: 0.3, decay: 2.6, damping: 4200 } },
  { id: 'luxeverb', name: 'LuxeVerb', category: 'Delay & Reverb', description: 'Lush cinematic shimmer & modulated tail reverb', dspEngine: 'reverb', defaultParams: { mix: 0.38, decay: 4.2, damping: 6800 } },
  { id: 'convolver', name: 'Convolver', category: 'Delay & Reverb', description: 'Zero-latency impulse response convolution reverb', dspEngine: 'reverb', defaultParams: { mix: 0.28, decay: 2.2, damping: 4800 } },

  // Distortion & Amp
  { id: 'blood_overdrive', name: 'Blood Overdrive', category: 'Distortion & Amp', description: 'Pre-amp warm tube overdrive with post-color filter', dspEngine: 'saturation', defaultParams: { drive: 0.52, mix: 0.85, tone: 4600 } },
  { id: 'fast_dist', name: 'Fast Dist', category: 'Distortion & Amp', description: 'Hard-edge transistor fuzz & crunch distortion', dspEngine: 'saturation', defaultParams: { drive: 0.72, mix: 0.9, tone: 5800 } },
  { id: 'waveshaper', name: 'WaveShaper', category: 'Distortion & Amp', description: 'Non-linear harmonic curve waveshaping saturator', dspEngine: 'saturation', defaultParams: { drive: 0.45, mix: 0.7, tone: 8000 } },
  { id: 'distructor', name: 'Distructor', category: 'Distortion & Amp', description: '4-module Distortion, Filter, Chorus & Speaker simulator', dspEngine: 'saturation', defaultParams: { drive: 0.62, mix: 0.8, tone: 3900 } },
  { id: 'hardcore', name: 'Hardcore', category: 'Distortion & Amp', description: '11-stompbox guitar pedalboard & cabinet simulator', dspEngine: 'saturation', defaultParams: { drive: 0.78, mix: 0.95, tone: 3400 } },
  { id: 'amp_designer', name: 'Amp Designer', category: 'Distortion & Amp', description: 'Vintage & modern tube guitar amp heads + speaker cabinets', dspEngine: 'saturation', defaultParams: { drive: 0.48, mix: 0.9, tone: 4200 } },
  { id: 'bass_amp_designer', name: 'Bass Amp Designer', category: 'Distortion & Amp', description: 'Warm bass amp head with 8x10 punch cabinet voicing', dspEngine: 'saturation', defaultParams: { drive: 0.3, mix: 0.8, tone: 2200 } },
  { id: 'pedalboard', name: 'Pedalboard', category: 'Distortion & Amp', description: 'Modular stompbox chain (Drive, Chorus, Tape Echo)', dspEngine: 'chorus', defaultParams: { mix: 0.4, rate: 1.2, depth: 0.6 } },

  // Modulation & Pitch
  { id: 'chorus', name: 'Chorus', category: 'Modulation & Pitch', description: 'Warm stereo ensemble chorus', dspEngine: 'chorus', defaultParams: { mix: 0.32, rate: 0.8, depth: 0.48 } },
  { id: 'hyper_chorus', name: 'Hyper Chorus', category: 'Modulation & Pitch', description: 'Multi-voice lush wide detune chorus', dspEngine: 'chorus', defaultParams: { mix: 0.45, rate: 1.4, depth: 0.75 } },
  { id: 'vintage_chorus', name: 'Vintage Chorus', category: 'Modulation & Pitch', description: 'Bucket-brigade Juno-60 style analog chorus', dspEngine: 'chorus', defaultParams: { mix: 0.42, rate: 0.55, depth: 0.65 } },
  { id: 'flanger', name: 'Flanger', category: 'Modulation & Pitch', description: 'Jet-sweep resonant comb flanger', dspEngine: 'chorus', defaultParams: { mix: 0.5, rate: 0.35, depth: 0.88 } },
  { id: 'flangus', name: 'Flangus', category: 'Modulation & Pitch', description: 'Stereo multi-unison thick flanging ensemble', dspEngine: 'chorus', defaultParams: { mix: 0.48, rate: 0.6, depth: 0.82 } },
  { id: 'phaser', name: 'Phaser', category: 'Modulation & Pitch', description: 'All-pass sweeping studio phaser', dspEngine: 'chorus', defaultParams: { mix: 0.44, rate: 0.45, depth: 0.7 } },
  { id: 'vintage_phaser', name: 'Vintage Phaser', category: 'Modulation & Pitch', description: 'Warm 1970s Small Stone analog phaser', dspEngine: 'chorus', defaultParams: { mix: 0.5, rate: 0.3, depth: 0.78 } },
  { id: 'frequency_shifter', name: 'Frequency Shifter', category: 'Modulation & Pitch', description: 'Ring-mod & linear Hz frequency shifter', dspEngine: 'chorus', defaultParams: { mix: 0.4, rate: 3.8, depth: 0.6 } },
  { id: 'pitch_shifter', name: 'Pitch Shifter', category: 'Modulation & Pitch', description: 'Real-time formant & harmonic pitch shifter', dspEngine: 'chorus', defaultParams: { mix: 0.35, rate: 0.2, depth: 0.4 } },
  { id: 'pitcher', name: 'Pitcher', category: 'Modulation & Pitch', description: 'Real-time scale-locked auto pitch correction & harmonizer', dspEngine: 'filter', defaultParams: { cutoff: 9500, resonance: 0.8, mode: 0 } },
  { id: 'vocoder', name: 'Vocoder', category: 'Modulation & Pitch', description: 'Classic multi-band spectral vocoder', dspEngine: 'filter', defaultParams: { cutoff: 1800, resonance: 4.5, mode: 2 } },
  { id: 'vocodex', name: 'Vocodex', category: 'Modulation & Pitch', description: 'Advanced 100-band lush carrier/modulator vocoder', dspEngine: 'filter', defaultParams: { cutoff: 2400, resonance: 3.5, mode: 2 } },
  { id: 'spreader', name: 'Spreader', category: 'Modulation & Pitch', description: 'Mono-compatible Haas stereo width spreader', dspEngine: 'chorus', defaultParams: { mix: 0.35, rate: 0.15, depth: 0.35 } },
  { id: 'stereo_enhancer', name: 'Stereo Enhancer', category: 'Modulation & Pitch', description: 'Mid/Side stereo separation & phase offset', dspEngine: 'chorus', defaultParams: { mix: 0.25, rate: 0.1, depth: 0.25 } },
  { id: 'stereo_shaper', name: 'Stereo Shaper', category: 'Modulation & Pitch', description: 'Mid/Side routing matrix & L/R phase shaper', dspEngine: 'chorus', defaultParams: { mix: 0.22, rate: 0.1, depth: 0.2 } },
  { id: 'panomatic', name: 'PanOMatic', category: 'Modulation & Pitch', description: 'Auto-panner & rhythmic stereo tremolo LFO', dspEngine: 'chorus', defaultParams: { mix: 0.5, rate: 2.2, depth: 0.7 } },

  // Time & Creative
  { id: 'gross_beat', name: 'Gross Beat', category: 'Time & Creative', description: 'Beat-synced stutter, sidechain gate, half-time & scratch envelopes', dspEngine: 'delay', defaultParams: { mix: 0.45, division: 0.125, feedback: 0.25, tone: 6500 } },
  { id: 'effector', name: 'Effector', category: 'Time & Creative', description: 'Live X-Y pad performance multi-FX (Vox, Grain, Ring, Lo-Fi)', dspEngine: 'filter', defaultParams: { cutoff: 2200, resonance: 4.2, mode: 0 } },
  { id: 'edison', name: 'Edison', category: 'Time & Creative', description: 'Integrated sample recorder, editor & spectral tool', dspEngine: 'eq4', defaultParams: { lowGain: 0, lowMidGain: 0, highMidGain: 0, highGain: 0, lowFreq: 90, highFreq: 8000 } },
  { id: 'newtime', name: 'Newtime', category: 'Time & Creative', description: 'Flex Time transient time-warping & groove quantizer', dspEngine: 'eq4', defaultParams: { lowGain: 0, lowMidGain: 0, highMidGain: 0, highGain: 0, lowFreq: 90, highFreq: 8000 } },
  { id: 'newtone', name: 'Newtone', category: 'Time & Creative', description: 'Offline vocal & melody pitch correction editor', dspEngine: 'eq4', defaultParams: { lowGain: 0, lowMidGain: 0, highMidGain: 0, highGain: 0, lowFreq: 90, highFreq: 8000 } },
  { id: 'scratcher', name: 'Scratcher', category: 'Time & Creative', description: 'Turntable vinyl scratch simulator', dspEngine: 'filter', defaultParams: { cutoff: 5500, resonance: 2.0, mode: 0 } },
  { id: 'transporter', name: 'Transporter', category: 'Time & Creative', description: 'Real-time rhythmic loop slicer & reverse buffer', dspEngine: 'delay', defaultParams: { mix: 0.35, division: 0.25, feedback: 0.3, tone: 7500 } },
  { id: 'transmitter', name: 'Transmitter', category: 'Time & Creative', description: 'Audio signal bus sender & radio filter', dspEngine: 'filter', defaultParams: { cutoff: 1900, resonance: 2.5, mode: 2 } },
  { id: 'patcher', name: 'Patcher', category: 'Time & Creative', description: 'Modular parallel FX & instrument routing rack', dspEngine: 'eq4', defaultParams: { lowGain: 0, lowMidGain: 0, highMidGain: 0, highGain: 0, lowFreq: 90, highFreq: 8000 } },

  // Internal Controllers
  { id: 'peak_controller', name: 'Peak Controller', category: 'Internal Controllers', description: 'Audio follower & LFO internal modulation source for sidechaining', dspEngine: 'compressor', defaultParams: { threshold: -18, ratio: 2, attack: 0.005, release: 0.12, makeup: 0 } },
  { id: 'envelope_controller', name: 'Envelope Controller', category: 'Internal Controllers', description: '8-articulator MIDI-triggered modulation envelope generator', dspEngine: 'eq4', defaultParams: { lowGain: 0, lowMidGain: 0, highMidGain: 0, highGain: 0, lowFreq: 90, highFreq: 8000 } },
  { id: 'formula_controller', name: 'Formula Controller', category: 'Internal Controllers', description: 'Math-driven real-time parameter modulation controller', dspEngine: 'eq4', defaultParams: { lowGain: 0, lowMidGain: 0, highMidGain: 0, highGain: 0, lowFreq: 90, highFreq: 8000 } },
  { id: 'keyboard_controller', name: 'Keyboard Controller', category: 'Internal Controllers', description: 'Maps incoming MIDI note pitch & velocity to any parameter', dspEngine: 'eq4', defaultParams: { lowGain: 0, lowMidGain: 0, highMidGain: 0, highGain: 0, lowFreq: 90, highFreq: 8000 } },
  { id: 'xy_controller', name: 'X-Y Controller', category: 'Internal Controllers', description: '2-axis interactive modulation surface', dspEngine: 'filter', defaultParams: { cutoff: 3200, resonance: 2.2, mode: 0 } },
  { id: 'xyz_controller', name: 'X-Y-Z Controller', category: 'Internal Controllers', description: '3-axis depth-mapped modulation controller', dspEngine: 'filter', defaultParams: { cutoff: 3200, resonance: 2.2, mode: 0 } },
  { id: 'voltage_controller', name: 'Voltage Controller', category: 'Internal Controllers', description: 'CV / DC offset modulation generator for modular routing', dspEngine: 'eq4', defaultParams: { lowGain: 0, lowMidGain: 0, highMidGain: 0, highGain: 0, lowFreq: 90, highFreq: 8000 } },
  { id: 'control_surface', name: 'Control Surface', category: 'Internal Controllers', description: 'Custom macro knob & slider control panel', dspEngine: 'eq4', defaultParams: { lowGain: 0, lowMidGain: 0, highMidGain: 0, highGain: 0, lowFreq: 90, highFreq: 8000 } },

  // Meters, Visualizers & Utility
  { id: 'db_meter', name: 'dB Meter', category: 'Meters & Visualizers', description: 'Precision peak & RMS dBFS bus meter', dspEngine: 'eq4', defaultParams: { lowGain: 0, lowMidGain: 0, highMidGain: 0, highGain: 0, lowFreq: 90, highFreq: 8000 } },
  { id: 'wave_candy', name: 'Wave Candy', category: 'Meters & Visualizers', description: 'Oscilloscope, spectrum & stereo vectorscope analyzer', dspEngine: 'eq4', defaultParams: { lowGain: 0, lowMidGain: 0, highMidGain: 0, highGain: 0, lowFreq: 90, highFreq: 8000 } },
  { id: 'spectroman', name: 'Spectroman', category: 'Meters & Visualizers', description: 'Real-time multi-band spectrum analyzer', dspEngine: 'eq4', defaultParams: { lowGain: 0, lowMidGain: 0, highMidGain: 0, highGain: 0, lowFreq: 90, highFreq: 8000 } },
  { id: 'big_clock', name: 'Big Clock', category: 'Meters & Visualizers', description: 'Large BAR:BEAT:STEP & timecode display', dspEngine: 'eq4', defaultParams: { lowGain: 0, lowMidGain: 0, highMidGain: 0, highGain: 0, lowFreq: 90, highFreq: 8000 } },
  { id: 'tuner', name: 'Tuner', category: 'Meters & Visualizers', description: 'Real-time chromatic pitch & cents tuner', dspEngine: 'eq4', defaultParams: { lowGain: 0, lowMidGain: 0, highMidGain: 0, highGain: 0, lowFreq: 90, highFreq: 8000 } },
  { id: 'zgameeditor', name: 'ZGameEditor Visualizer', category: 'Meters & Visualizers', description: '60fps beat-reactive visual shader & audio video renderer', dspEngine: 'eq4', defaultParams: { lowGain: 0, lowMidGain: 0, highMidGain: 0, highGain: 0, lowFreq: 90, highFreq: 8000 } },
  { id: 'balance', name: 'Balance', category: 'Utility & Notes', description: 'Precision stereo balance & volume automation utility', dspEngine: 'eq4', defaultParams: { lowGain: 0, lowMidGain: 0, highMidGain: 0, highGain: 0, lowFreq: 90, highFreq: 8000 } },
  { id: 'center', name: 'Center', category: 'Utility & Notes', description: 'DC offset removal & low-end mono centering', dspEngine: 'eq4', defaultParams: { lowGain: 0, lowMidGain: 0, highMidGain: 0, highGain: 0, lowFreq: 90, highFreq: 8000 } },
  { id: 'mute_2', name: 'Mute 2', category: 'Utility & Notes', description: 'Automatable zero-click mute gate', dspEngine: 'eq4', defaultParams: { lowGain: 0, lowMidGain: 0, highMidGain: 0, highGain: 0, lowFreq: 90, highFreq: 8000 } },
  { id: 'phase_inverter', name: 'Phase Inverter', category: 'Utility & Notes', description: 'L/R polarity inversion utility', dspEngine: 'eq4', defaultParams: { lowGain: 0, lowMidGain: 0, highMidGain: 0, highGain: 0, lowFreq: 90, highFreq: 8000 } },
  { id: 'send', name: 'Send', category: 'Utility & Notes', description: 'Pre/post fader auxiliary bus send', dspEngine: 'eq4', defaultParams: { lowGain: 0, lowMidGain: 0, highMidGain: 0, highGain: 0, lowFreq: 90, highFreq: 8000 } },
  { id: 'notebook', name: 'NoteBook', category: 'Utility & Notes', description: 'Session lyrics & mixing notes pad', dspEngine: 'eq4', defaultParams: { lowGain: 0, lowMidGain: 0, highMidGain: 0, highGain: 0, lowFreq: 90, highFreq: 8000 } },
  { id: 'notebook_2', name: 'NoteBook 2', category: 'Utility & Notes', description: 'Multi-page automatable lyric & cue sheet', dspEngine: 'eq4', defaultParams: { lowGain: 0, lowMidGain: 0, highMidGain: 0, highGain: 0, lowFreq: 90, highFreq: 8000 } },
  { id: 'html_notebook', name: 'HTML Notebook', category: 'Utility & Notes', description: 'Rich formatted production notes & project checklist', dspEngine: 'eq4', defaultParams: { lowGain: 0, lowMidGain: 0, highMidGain: 0, highGain: 0, lowFreq: 90, highFreq: 8000 } },
];

export const LOOP_STARTER_LIBRARY: LoopStarterItem[] = [
  {
    id: 'loop-house',
    name: 'Deep House 124',
    genre: 'House',
    bpm: 124,
    swing: 0.14,
    kitId: '909_punch',
    kickSteps: [0, 4, 8, 12],
    snareSteps: [4, 12],
    hatSteps: [2, 6, 10, 14, 15],
    bassNotes: [
      { midi: 36, startBeat: 0, duration: 0.5 },
      { midi: 36, startBeat: 0.75, duration: 0.5 },
      { midi: 39, startBeat: 1.5, duration: 0.5 },
      { midi: 43, startBeat: 2.5, duration: 0.5 },
      { midi: 41, startBeat: 3.25, duration: 0.5 },
    ],
    chordRoot: 'C3',
    chordQuality: 'min9',
  },
  {
    id: 'loop-trap',
    name: 'Dark 808 Trap 142',
    genre: 'Trap',
    bpm: 142,
    swing: 0.05,
    kitId: '808_clean',
    kickSteps: [0, 6, 10],
    snareSteps: [8],
    hatSteps: [0, 1, 2, 4, 5, 6, 8, 9, 10, 12, 13, 14, 15],
    bassNotes: [
      { midi: 33, startBeat: 0, duration: 1.5 },
      { midi: 33, startBeat: 1.5, duration: 1.0 },
      { midi: 36, startBeat: 2.5, duration: 0.75 },
      { midi: 35, startBeat: 3.25, duration: 0.75 },
    ],
    chordRoot: 'A2',
    chordQuality: 'min7',
  },
  {
    id: 'loop-ukg',
    name: 'UK Garage 2-Step 134',
    genre: 'UKG',
    bpm: 134,
    swing: 0.28,
    kitId: 'ukg_break',
    kickSteps: [0, 7, 10],
    snareSteps: [4, 12],
    hatSteps: [2, 3, 6, 10, 14, 15],
    bassNotes: [
      { midi: 41, startBeat: 0, duration: 0.5 },
      { midi: 41, startBeat: 1.75, duration: 0.5 },
      { midi: 44, startBeat: 2.5, duration: 0.5 },
      { midi: 43, startBeat: 3.25, duration: 0.5 },
    ],
    chordRoot: 'F3',
    chordQuality: 'min9',
  },
  {
    id: 'loop-lofi',
    name: 'Lo-Fi Boom Bap 86',
    genre: 'Lo-Fi',
    bpm: 86,
    swing: 0.24,
    kitId: '808_clean',
    kickSteps: [0, 7, 10],
    snareSteps: [4, 12],
    hatSteps: [0, 2, 4, 6, 8, 10, 12, 14],
    bassNotes: [
      { midi: 41, startBeat: 0, duration: 1.5 },
      { midi: 40, startBeat: 1.5, duration: 0.5 },
      { midi: 38, startBeat: 2.0, duration: 1.5 },
      { midi: 36, startBeat: 3.5, duration: 0.5 },
    ],
    chordRoot: 'F3',
    chordQuality: 'maj7',
  },
  {
    id: 'loop-dnb',
    name: 'Liquid DnB 172',
    genre: 'DnB',
    bpm: 172,
    swing: 0.04,
    kitId: 'ukg_break',
    kickSteps: [0, 10],
    snareSteps: [4, 12],
    hatSteps: [0, 2, 4, 6, 8, 10, 12, 14],
    bassNotes: [
      { midi: 36, startBeat: 0, duration: 2.0 },
      { midi: 41, startBeat: 2.0, duration: 1.0 },
      { midi: 39, startBeat: 3.0, duration: 1.0 },
    ],
    chordRoot: 'C3',
    chordQuality: 'min7',
  },
  {
    id: 'loop-techno',
    name: 'Warehouse Techno 136',
    genre: 'Techno',
    bpm: 136,
    swing: 0.06,
    kitId: 'fm_perc',
    kickSteps: [0, 4, 8, 12],
    snareSteps: [4, 12],
    hatSteps: [2, 6, 10, 14],
    bassNotes: [
      { midi: 36, startBeat: 0.5, duration: 0.25 },
      { midi: 36, startBeat: 1.5, duration: 0.25 },
      { midi: 36, startBeat: 2.5, duration: 0.25 },
      { midi: 39, startBeat: 3.5, duration: 0.25 },
    ],
    chordRoot: 'C3',
    chordQuality: 'sus2',
  },
];

export const THEME_PRESETS: ThemePreset[] = [
  {
    id: 'totone-pro',
    name: 'Totone Studio Pro (Matte Default)',
    vars: {
      '--bg': '#141416',
      '--bg-alt': '#19191c',
      '--panel': '#202024',
      '--panel-elev': '#28282d',
      '--panel-hover': '#313138',
      '--btn-bg': '#28282d',
      '--btn-hover': '#313138',
      '--border': '#2c2c32',
      '--border-strong': '#3b3b44',
      '--ink': '#ececef',
      '--ink-dim': '#bdbdc6',
      '--ink-mute': '#82828e',
      '--accent': '#2f7cf6',
      '--accent-h': '#256be0',
      '--accent-soft': 'rgba(47, 124, 246, 0.16)',
      '--accent-blue': '#2f7cf6',
    },
  },
  {
    id: 'totone-navy',
    name: 'Totone Classic Navy',
    vars: {
      '--bg': '#080C18',
      '--bg-alt': '#0B1020',
      '--panel': '#0E1528',
      '--panel-elev': '#11192E',
      '--panel-hover': '#17223D',
      '--btn-bg': 'rgba(15, 23, 42, 0.72)',
      '--btn-hover': 'rgba(30, 41, 68, 0.88)',
      '--border': '#24324D',
      '--border-strong': '#2E3F61',
      '--ink': '#F8FAFC',
      '--ink-dim': '#94A3B8',
      '--ink-mute': '#64748B',
      '--accent': '#2f7cf6',
      '--accent-h': '#256be0',
      '--accent-soft': 'rgba(47, 124, 246, 0.18)',
      '--accent-blue': '#60A5FA',
    },
  },
  {
    id: 'obsidian',
    name: 'Pitch Obsidian',
    vars: {
      '--bg': '#0B0B0D',
      '--bg-alt': '#111114',
      '--panel': '#17171B',
      '--panel-elev': '#1F1F25',
      '--panel-hover': '#292931',
      '--btn-bg': '#1F1F25',
      '--btn-hover': '#292931',
      '--border': '#26262E',
      '--border-strong': '#363642',
      '--ink': '#F4F4F6',
      '--ink-dim': '#A9A9B5',
      '--ink-mute': '#70707C',
      '--accent': '#2f7cf6',
      '--accent-h': '#256be0',
      '--accent-soft': 'rgba(47, 124, 246, 0.16)',
      '--accent-blue': '#60A5FA',
    },
  },
  {
    id: 'cobalt-pro',
    name: 'Deep Cobalt',
    vars: {
      '--bg': '#050C1F',
      '--bg-alt': '#08122B',
      '--panel': '#0B1838',
      '--panel-elev': '#10214A',
      '--panel-hover': '#172E61',
      '--btn-bg': '#10214A',
      '--btn-hover': '#172E61',
      '--border': '#1E3466',
      '--border-strong': '#2D4B8C',
      '--ink': '#F4F7FF',
      '--ink-dim': '#9BB0DC',
      '--ink-mute': '#6B82B3',
      '--accent': '#38BDF8',
      '--accent-h': '#0EA5E9',
      '--accent-soft': 'rgba(56, 189, 248, 0.18)',
      '--accent-blue': '#38BDF8',
    },
  },
];
