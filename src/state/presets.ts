import type { CodePreset, CodeSnippet, FmSynthParams, SubSynthParams } from '../types/daw';

export const SUB_SYNTH_PRESETS: Record<string, SubSynthParams> = {
  'Acid 303 Bass': {
    presetName: 'Acid 303 Bass',
    osc1Wave: 'sawtooth',
    osc2Wave: 'square',
    oscMix: 0.25,
    osc2Semi: -12,
    osc2Detune: 4,
    wavetableName: 'acid_morph',
    wavetableMorph: 0.35,
    unisonVoices: 1,
    unisonDetune: 6,
    stereoSpread: 0.2,
    filterMode: 'lowpass',
    cutoff: 520,
    resonance: 9.5,
    filterEnvAmount: 3600,
    ampEnv: { attack: 0.004, decay: 0.24, sustain: 0.35, release: 0.12 },
    filterEnv: { attack: 0.003, decay: 0.19, sustain: 0.12, release: 0.14 },
    lfoRateHz: 1.5,
    lfoDepth: 0.12,
    lfoTarget: 'cutoff',
    glide: 0.035,
    drive: 0.42,
  },
  'Midnight Reese': {
    presetName: 'Midnight Reese',
    osc1Wave: 'sawtooth',
    osc2Wave: 'sawtooth',
    oscMix: 0.5,
    osc2Semi: 0,
    osc2Detune: 19,
    wavetableName: 'acid_morph',
    wavetableMorph: 0.5,
    unisonVoices: 3,
    unisonDetune: 16,
    stereoSpread: 0.72,
    filterMode: 'lowpass',
    cutoff: 680,
    resonance: 2.8,
    filterEnvAmount: 900,
    ampEnv: { attack: 0.03, decay: 0.4, sustain: 0.82, release: 0.35 },
    filterEnv: { attack: 0.08, decay: 0.6, sustain: 0.45, release: 0.4 },
    lfoRateHz: 0.5,
    lfoDepth: 0.2,
    lfoTarget: 'cutoff',
    glide: 0.07,
    drive: 0.3,
  },
  'Studio Pluck': {
    presetName: 'Studio Pluck',
    osc1Wave: 'triangle',
    osc2Wave: 'sawtooth',
    oscMix: 0.65,
    osc2Semi: 12,
    osc2Detune: 5,
    wavetableName: 'glass_fm',
    wavetableMorph: 0.4,
    unisonVoices: 2,
    unisonDetune: 9,
    stereoSpread: 0.6,
    filterMode: 'lowpass',
    cutoff: 480,
    resonance: 2.1,
    filterEnvAmount: 4800,
    ampEnv: { attack: 0.002, decay: 0.26, sustain: 0.05, release: 0.24 },
    filterEnv: { attack: 0.002, decay: 0.18, sustain: 0.04, release: 0.18 },
    lfoRateHz: 3.0,
    lfoDepth: 0.04,
    lfoTarget: 'pan',
    glide: 0,
    drive: 0.12,
  },
  'Glass Pad': {
    presetName: 'Glass Pad',
    osc1Wave: 'wavetable',
    osc2Wave: 'triangle',
    oscMix: 0.45,
    osc2Semi: 7,
    osc2Detune: 8,
    wavetableName: 'warm_organ',
    wavetableMorph: 0.6,
    unisonVoices: 4,
    unisonDetune: 14,
    stereoSpread: 0.9,
    filterMode: 'lowpass',
    cutoff: 1650,
    resonance: 1.5,
    filterEnvAmount: 1400,
    ampEnv: { attack: 0.38, decay: 0.7, sustain: 0.78, release: 1.1 },
    filterEnv: { attack: 0.5, decay: 0.9, sustain: 0.5, release: 1.0 },
    lfoRateHz: 0.35,
    lfoDepth: 0.22,
    lfoTarget: 'cutoff',
    glide: 0.04,
    drive: 0.08,
  },
  'Clean 808 Sub': {
    presetName: 'Clean 808 Sub',
    osc1Wave: 'sine',
    osc2Wave: 'triangle',
    oscMix: 0.18,
    osc2Semi: 12,
    osc2Detune: 0,
    wavetableName: 'warm_organ',
    wavetableMorph: 0.1,
    unisonVoices: 1,
    unisonDetune: 0,
    stereoSpread: 0,
    filterMode: 'lowpass',
    cutoff: 320,
    resonance: 0.8,
    filterEnvAmount: 240,
    ampEnv: { attack: 0.004, decay: 0.55, sustain: 0.55, release: 0.25 },
    filterEnv: { attack: 0.004, decay: 0.2, sustain: 0.2, release: 0.15 },
    lfoRateHz: 0.5,
    lfoDepth: 0,
    lfoTarget: 'cutoff',
    glide: 0.06,
    drive: 0.28,
  },
  'Hyper Lead': {
    presetName: 'Hyper Lead',
    osc1Wave: 'sawtooth',
    osc2Wave: 'square',
    oscMix: 0.42,
    osc2Semi: 0,
    osc2Detune: 11,
    wavetableName: 'formant_sweep',
    wavetableMorph: 0.7,
    unisonVoices: 4,
    unisonDetune: 22,
    stereoSpread: 0.85,
    filterMode: 'lowpass',
    cutoff: 3600,
    resonance: 3.4,
    filterEnvAmount: 2800,
    ampEnv: { attack: 0.006, decay: 0.25, sustain: 0.72, release: 0.22 },
    filterEnv: { attack: 0.01, decay: 0.3, sustain: 0.4, release: 0.25 },
    lfoRateHz: 5.5,
    lfoDepth: 0.06,
    lfoTarget: 'pitch',
    glide: 0.03,
    drive: 0.25,
  },
};

export const FM_SYNTH_PRESETS: Record<string, FmSynthParams> = {
  'Electric Tine Keys': {
    presetName: 'Electric Tine Keys',
    algorithm: 1,
    feedback: 0.12,
    modIndex: 2.2,
    cutoff: 6400,
    resonance: 1.0,
    operators: [
      { ratio: 1.0, detune: 0, level: 0.9, env: { attack: 0.003, decay: 0.85, sustain: 0.28, release: 0.42 } },
      { ratio: 14.0, detune: 2, level: 0.32, env: { attack: 0.001, decay: 0.11, sustain: 0.0, release: 0.08 } },
      { ratio: 1.0, detune: 4, level: 0.55, env: { attack: 0.004, decay: 0.75, sustain: 0.22, release: 0.38 } },
      { ratio: 2.0, detune: -2, level: 0.48, env: { attack: 0.002, decay: 0.32, sustain: 0.06, release: 0.18 } },
    ],
  },
  'Punchy FM Bass': {
    presetName: 'Punchy FM Bass',
    algorithm: 0,
    feedback: 0.32,
    modIndex: 4.8,
    cutoff: 2400,
    resonance: 1.6,
    operators: [
      { ratio: 1.0, detune: 0, level: 1.0, env: { attack: 0.002, decay: 0.32, sustain: 0.42, release: 0.14 } },
      { ratio: 2.0, detune: 0, level: 0.82, env: { attack: 0.001, decay: 0.14, sustain: 0.08, release: 0.08 } },
      { ratio: 1.0, detune: 3, level: 0.45, env: { attack: 0.002, decay: 0.2, sustain: 0.15, release: 0.1 } },
      { ratio: 0.5, detune: 0, level: 0.35, env: { attack: 0.002, decay: 0.28, sustain: 0.3, release: 0.12 } },
    ],
  },
  'Metallic Bell': {
    presetName: 'Metallic Bell',
    algorithm: 2,
    feedback: 0.2,
    modIndex: 5.4,
    cutoff: 11000,
    resonance: 1.2,
    operators: [
      { ratio: 1.0, detune: 0, level: 0.85, env: { attack: 0.002, decay: 1.15, sustain: 0.08, release: 0.8 } },
      { ratio: 3.5, detune: 6, level: 0.75, env: { attack: 0.001, decay: 0.52, sustain: 0.02, release: 0.45 } },
      { ratio: 2.0, detune: -5, level: 0.6, env: { attack: 0.002, decay: 0.9, sustain: 0.05, release: 0.6 } },
      { ratio: 7.07, detune: 3, level: 0.45, env: { attack: 0.001, decay: 0.24, sustain: 0.0, release: 0.2 } },
    ],
  },
  'Modular FM Pluck': {
    presetName: 'Modular FM Pluck',
    algorithm: 3,
    feedback: 0.42,
    modIndex: 3.9,
    cutoff: 5200,
    resonance: 2.2,
    operators: [
      { ratio: 1.0, detune: 0, level: 0.92, env: { attack: 0.002, decay: 0.28, sustain: 0.06, release: 0.2 } },
      { ratio: 3.0, detune: 2, level: 0.68, env: { attack: 0.001, decay: 0.11, sustain: 0.0, release: 0.09 } },
      { ratio: 1.5, detune: -3, level: 0.55, env: { attack: 0.002, decay: 0.22, sustain: 0.04, release: 0.15 } },
      { ratio: 5.0, detune: 4, level: 0.4, env: { attack: 0.001, decay: 0.08, sustain: 0.0, release: 0.06 } },
    ],
  },
};

export const BUILTIN_CODE_PRESETS: CodePreset[] = [
  {
    id: 'js-acid-groove',
    name: 'Acid Bassline + Beat Reactive',
    category: 'Electronic',
    lang: 'javascript',
    description: '4-on-the-floor 808 groove with LFO acid bassline and sub-band reactive FM arp.',
    bpm: 128,
    code: `// Bebeat JS Live Code — Acid Bassline + Beat Reactive Lead
clock.bpm = 128;
clock.swing = 0.08;

drums.kit("808_clean").mixer(1)
  .pattern("bd ~ [bd bd] ~, ~ cp ~ [cp*2 ~], hh*8")
  .gain(0.92);

bass.synth("SubSynth", "Acid 303 Bass").mixer(2)
  .notes("c2 ~ c2 eb2 | g2 ~ f2 d2", "8n")
  .cutoff(lfo.sine(0.25, 240, 1850))
  .gain(0.84);

lead.synth("FMSynth", "Modular FM Pluck").mixer(3)
  .euclid(5, 8, ["c4", "eb4", "g4", "bb4", "d5"], "16n")
  .cutoff(bands.sub.map(420, 4200))
  .gain(0.68);`,
  },
  {
    id: 'js-ukg-break',
    name: 'UK Garage 2-Step Breakbeat',
    category: 'Breakbeat',
    lang: 'javascript',
    description: 'Swung 134 BPM 2-step UKG drum pocket with warm minor-9 chord stabs and rolling sub.',
    bpm: 134,
    code: `// UK Garage 2-Step Breakbeat
clock.bpm = 134;
clock.swing = 0.28;

drums.kit("ukg_break").mixer(1)
  .pattern("bd ~ ~ [~ bd], ~ ~ sn ~, [~ hh]*4, ~ rim ~ [perc ~]")
  .gain(0.95);

bass.synth("SubSynth", "Clean 808 Sub").mixer(2)
  .notes("f1 ~ ~ f1 | ~ ab1 g1 ~", "8n")
  .gain(0.92);

pad.synth("FMSynth", "Electric Tine Keys").mixer(4)
  .chords([Chord.min9("F3"), Chord.min7("Eb3"), Chord.maj7("Db3"), Chord.min7("C3")], "2n")
  .cutoff(env.follow("kick").map(900, 4800))
  .gain(0.64);`,
  },
  {
    id: 'js-polyrhythm-arp',
    name: 'Polyrhythmic FM Arp (5:8 / 7:16)',
    category: 'Polyrhythm',
    lang: 'javascript',
    description: 'Interlocking Euclidean polyrhythms across FM metallic percussion and crystalline bells.',
    bpm: 122,
    code: `// Polyrhythmic FM Arp & Modular Percussion
clock.bpm = 122;

drums.kit("fm_perc").mixer(1)
  .pattern("bd(5,16), rim(7,16), hh*16")
  .gain(0.88);

bass.synth("SubSynth", "Midnight Reese").mixer(2)
  .notes("d2 ~ ~ a1 | c2 ~ g1 ~", "4n")
  .cutoff(beat.phase.map(320, 1400))
  .gain(0.8);

lead.synth("FMSynth", "Metallic Bell").mixer(3)
  .euclid(7, 16, Scale.dorian("D4"), "16n")
  .cutoff(bands.highs.map(800, 7200))
  .gain(0.66);`,
  },
  {
    id: 'js-ambient-texture',
    name: 'Ambient Pad + Texture Drift',
    category: 'Ambient',
    lang: 'javascript',
    description: 'Slow atmospheric wavetable chords, sparse percussion droplets, and Markov melody.',
    bpm: 92,
    code: `// Ambient Pad + Markov Generative Bells
clock.bpm = 92;

drums.kit("fm_perc").mixer(1)
  .pattern("bd ~ ~ ~, ~ ~ rim ~, ~ perc ~ ~")
  .gain(0.58);

pad.synth("SubSynth", "Glass Pad").mixer(4)
  .chords([Chord.maj7("C3"), Chord.min9("A2"), Chord.maj7("F2"), Chord.sus2("G2")], "1n")
  .cutoff(lfo.tri(0.125, 550, 2600))
  .gain(0.75);

const melody = markov(["e4", "g4", "b4", "d5", "a4"], [
  [0.1, 0.4, 0.3, 0.1, 0.1],
  [0.3, 0.1, 0.3, 0.2, 0.1],
  [0.1, 0.2, 0.1, 0.4, 0.2],
  [0.2, 0.2, 0.3, 0.1, 0.2],
  [0.4, 0.3, 0.1, 0.1, 0.1],
], 16, 42);

lead.synth("FMSynth", "Metallic Bell").mixer(3)
  .euclid(5, 16, melody, "8n")
  .gain(0.55);`,
  },
  {
    id: 'js-sidechain-pump',
    name: 'Beat-Reactive Filter & Sidechain Groove',
    category: 'Modulation',
    lang: 'javascript',
    description: 'Demonstrates beat.phase, env.follow("kick"), and bands.sub modulating synths live.',
    bpm: 126,
    code: `// Beat-Reactive Filter & Kick-Follower Sidechain Groove
clock.bpm = 126;

drums.kit("909_punch").mixer(1)
  .pattern("bd*4, ~ cp ~ cp, [~ oh]*4, hh*16")
  .gain(0.94);

bass.synth("FMSynth", "Punchy FM Bass").mixer(2)
  .notes("~ c2 c2 ~ | ~ g1 bb1 c2", "8n")
  .cutoff(beat.phase.map(1800, 340))
  .gain(0.88);

pad.synth("SubSynth", "Hyper Lead").mixer(4)
  .chords([Chord.min7("C3"), Chord.min7("Ab2"), Chord.maj7("Eb3"), Chord.dom7("G2")], "2n")
  .cutoff(env.follow("kick").map(400, 5200))
  .gain(0.62);`,
  },
  {
    id: 'py-euclid-arp',
    name: 'Python Euclidean & Scale Arp',
    category: 'Python',
    lang: 'python',
    description: 'Algorithmic 2-bar C minor arpeggio using @loop, Scale.minor, and Euclidean hi-hats.',
    bpm: 128,
    code: `# Bebeat Python Live Code — Euclidean & Scale Arp
clock.bpm = 128
drums.kit("808_clean").mixer(1).pattern("bd ~ sn ~, hh*8")

@loop(bars=2)
def arp(bar):
    scale = Scale.minor("C3")
    degrees = [0, 2, 4, 6, 4, 2, 3, 5] if bar == 0 else [0, 4, 7, 5, 4, 2, 1, 0]
    for step, deg in enumerate(degrees):
        lead.synth("FMSynth", "Modular FM Pluck").mixer(3).play(
            scale[deg] + 12,
            dur="16n",
            at=step * 0.5,
            vel=0.88 if step % 2 == 0 else 0.56,
        )
    bass.synth("SubSynth", "Acid 303 Bass").mixer(2).play(
        scale[0 if bar == 0 else 5] - 12,
        dur="2n",
        at=0.0,
        vel=0.9,
    )`,
  },
  {
    id: 'py-markov-seq',
    name: 'Python Markov & Math Sequencer',
    category: 'Python',
    lang: 'python',
    description: 'Stochastic Markov chain melody paired with Euclidean kick/bass syncopation.',
    bpm: 124,
    code: `# Python Markov Chain + Euclidean Polyrhythm Sequencer
clock.bpm = 124
drums.kit("909_punch").mixer(1).pattern("bd*4, ~ cp ~ cp, [~ hh]*4")

scale = Scale.dorian("F3")
chain = markov(
    [0, 2, 3, 4, 6, 7],
    [
        [0.1, 0.4, 0.2, 0.2, 0.1, 0.0],
        [0.2, 0.1, 0.3, 0.2, 0.1, 0.1],
        [0.1, 0.2, 0.1, 0.4, 0.1, 0.1],
        [0.2, 0.1, 0.2, 0.1, 0.3, 0.1],
        [0.1, 0.1, 0.2, 0.2, 0.1, 0.3],
        [0.4, 0.2, 0.1, 0.2, 0.1, 0.0],
    ],
    length=16,
    seed=21,
)
rhythm = euclid(9, 16)

@loop(bars=2)
def generative(bar):
    for i, hit in enumerate(rhythm):
        if hit:
            deg = chain[(i + bar * 5) % len(chain)]
            lead.synth("FMSynth", "Electric Tine Keys").mixer(3).play(
                scale[deg], dur="16n", at=i * 0.25, vel=0.82 if i % 4 == 0 else 0.6
            )
    if bar == 0:
        pad.synth("SubSynth", "Glass Pad").mixer(4).play(Chord.min7("F3"), dur="1n", at=0.0, vel=0.55)
    else:
        pad.synth("SubSynth", "Glass Pad").mixer(4).play(Chord.maj7("Eb3"), dur="1n", at=0.0, vel=0.55)`,
  },
];

export const CODE_SNIPPETS: CodeSnippet[] = [
  {
    id: 'snip-js-drum-fill',
    name: '4-Bar Drum Fill',
    category: 'Drums',
    lang: 'javascript',
    code: `drums.kit("909_punch").mixer(1).pattern("bd ~ bd ~, ~ sn ~ [sn*2 cp], hh*8").gain(0.9);`,
  },
  {
    id: 'snip-js-euclid-bass',
    name: 'Euclidean Acid Bass',
    category: 'Bass',
    lang: 'javascript',
    code: `bass.synth("SubSynth", "Acid 303 Bass").mixer(2).euclid(5, 8, ["c2", "eb2", "g2", "f2"], "16n").cutoff(lfo.sine(0.5, 220, 1900));`,
  },
  {
    id: 'snip-js-chord-stab',
    name: 'Minor-9 Chord Stabs',
    category: 'Chords',
    lang: 'javascript',
    code: `pad.synth("FMSynth", "Electric Tine Keys").mixer(4).chords([Chord.min9("C3"), Chord.min7("G2")], "2n").gain(0.65);`,
  },
  {
    id: 'snip-js-filter-sweep',
    name: 'Sub-Band Reactive Filter',
    category: 'Modulation',
    lang: 'javascript',
    code: `lead.synth("SubSynth", "Studio Pluck").mixer(3).notes("c4 eb4 g4 bb4", "8n").cutoff(bands.sub.map(300, 4800));`,
  },
  {
    id: 'snip-js-sidechain',
    name: 'Kick Envelope Follower',
    category: 'Modulation',
    lang: 'javascript',
    code: `pad.synth("SubSynth", "Glass Pad").mixer(4).chords([Chord.min7("C3")], "1n").cutoff(env.follow("kick").map(380, 4400));`,
  },
  {
    id: 'snip-py-arp',
    name: 'Python @loop Arp',
    category: 'Python',
    lang: 'python',
    code: `@loop(bars=2)
def quick_arp(bar):
    sc = Scale.minor("C4")
    for i, d in enumerate([0, 2, 4, 7, 4, 2, 3, 5]):
        lead.play(sc[d], dur="16n", at=i * 0.5, vel=0.78)`,
  },
  {
    id: 'snip-py-euclid',
    name: 'Python Euclidean Bass',
    category: 'Python',
    lang: 'python',
    code: `@loop(bars=1)
def euc_bass(bar):
    for i, hit in enumerate(euclid(5, 16)):
        if hit:
            bass.play("C2" if i < 8 else "Eb2", dur="16n", at=i * 0.25, vel=0.86)`,
  },
];
