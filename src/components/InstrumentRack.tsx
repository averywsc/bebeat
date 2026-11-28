import React, { useEffect, useState } from 'react';
import { Plus, Trash2, Upload, Activity, Sliders, Dices } from 'lucide-react';
import type {
  DrumVoiceName,
  FilterMode,
  InstrumentEngine,
  ModSourceId,
  ModTargetParam,
  OscWaveform,
  ProjectState,
} from '../types/daw';
import { projectStore, uid } from '../state/projectStore';
import { FM_SYNTH_PRESETS, SUB_SYNTH_PRESETS } from '../state/presets';
import { MOD_PARAM_RANGES, MOD_SOURCE_LABELS, sampleModSource } from '../audio/dsp/modulation';
import { audioEngine } from '../audio/engine';
import { SEMITONE_TO_KEY_LABEL, midiToNoteName } from '../livecode/musicTheory';

interface InstrumentRackProps {
  project: ProjectState;
}

const KEYBOARD_SEMIS = Array.from({ length: 29 }, (_, i) => i);
const DRUM_VOICES: DrumVoiceName[] = ['bd', 'sn', 'cp', 'hh', 'oh', 'rim', 'lt', 'perc'];

const FilterCurveSvg: React.FC<{ mode: FilterMode; cutoff: number; resonance: number }> = ({ mode, cutoff, resonance }) => {
  const w = 220;
  const h = 52;
  const pts: string[] = [];
  const logCut = Math.log2(Math.max(40, cutoff));
  const qBoost = Math.min(1.0, (resonance - 0.5) / 14);

  for (let i = 0; i <= 44; i++) {
    const t = i / 44;
    const freq = 30 * Math.pow(650, t);
    const d = Math.log2(freq) - logCut;
    let mag = 0.72;
    if (mode === 'lowpass') {
      mag = 0.72 / (1 + Math.exp(d * 3.0)) + qBoost * 0.45 * Math.exp(-Math.pow(d * 3.4, 2));
    } else if (mode === 'highpass') {
      mag = 0.72 / (1 + Math.exp(-d * 3.0)) + qBoost * 0.45 * Math.exp(-Math.pow(d * 3.4, 2));
    } else if (mode === 'bandpass') {
      mag = (0.68 + qBoost * 0.35) * Math.exp(-Math.pow(d * (1.8 + qBoost * 2.2), 2));
    } else {
      mag = 0.72 * (1 - 0.85 * Math.exp(-Math.pow(d * (2.2 + qBoost * 2.5), 2)));
    }
    const clamped = Math.max(0.03, Math.min(0.96, mag));
    pts.push(`${(t * w).toFixed(1)},${(h - clamped * (h - 6) - 2).toFixed(1)}`);
  }
  const area = `0,${h} ${pts.join(' ')} ${w},${h}`;

  return (
    <svg
      width="100%"
      height={h}
      viewBox={`0 0 ${w} ${h}`}
      style={{ display: 'block', background: '#141416', border: '1px solid var(--border)', borderRadius: 4, marginBottom: 8 }}
    >
      <polygon points={area} fill="rgba(47, 124, 246, 0.16)" />
      <polyline points={pts.join(' ')} fill="none" stroke="#2f7cf6" strokeWidth={1.6} />
    </svg>
  );
};

const AdsrCurveSvg: React.FC<{ attack: number; decay: number; sustain: number; release: number }> = ({
  attack,
  decay,
  sustain,
  release,
}) => {
  const w = 220;
  const h = 52;
  const pad = 5;
  const totalT = Math.max(0.3, attack + decay + 0.35 + release);
  const xA = (attack / totalT) * (w - pad * 2) + pad;
  const xD = ((attack + decay) / totalT) * (w - pad * 2) + pad;
  const xS = ((attack + decay + 0.35) / totalT) * (w - pad * 2) + pad;
  const xR = w - pad;
  const yBot = h - pad;
  const yTop = pad + 2;
  const ySus = yBot - sustain * (yBot - yTop);
  const pts = `${pad},${yBot} ${xA.toFixed(1)},${yTop} ${xD.toFixed(1)},${ySus.toFixed(1)} ${xS.toFixed(1)},${ySus.toFixed(1)} ${xR},${yBot}`;

  return (
    <svg
      width="100%"
      height={h}
      viewBox={`0 0 ${w} ${h}`}
      style={{ display: 'block', background: '#141416', border: '1px solid var(--border)', borderRadius: 4, marginBottom: 8 }}
    >
      <polygon points={`${pad},${yBot} ${pts} ${xR},${yBot}`} fill="rgba(47, 124, 246, 0.16)" />
      <polyline points={pts} fill="none" stroke="#2f7cf6" strokeWidth={1.6} />
      <circle cx={xA} cy={yTop} r={2.5} fill="#ececef" />
      <circle cx={xD} cy={ySus} r={2.5} fill="#ececef" />
      <circle cx={xS} cy={ySus} r={2.5} fill="#ececef" />
    </svg>
  );
};

export const InstrumentRack: React.FC<InstrumentRackProps> = ({ project }) => {
  const [modLiveVals, setModLiveVals] = useState<Record<string, number>>({});
  const [newModSrc, setNewModSrc] = useState<ModSourceId>('bands.sub');
  const [newModParam, setNewModParam] = useState<ModTargetParam>('cutoff');
  const [midiLearnActive, setMidiLearnActive] = useState<string | null>(null);
  const [pressedNotes, setPressedNotes] = useState<Set<number>>(new Set());

  const channel = project.channels.find((c) => c.id === project.selectedChannelId) || project.channels[0];
  const baseTypingMidi = (project.typingOctave + 1) * 12;

  useEffect(() => {
    return audioEngine.subscribePressedNotes(setPressedNotes);
  }, []);

  useEffect(() => {
    let raf = 0;
    const poll = () => {
      const t = audioEngine.readTelemetry();
      const now = performance.now() / 1000;
      const next: Record<string, number> = {};
      for (const r of project.modRoutes) {
        next[r.id] = sampleModSource(r.source, t, now);
      }
      setModLiveVals(next);
      raf = requestAnimationFrame(poll);
    };
    raf = requestAnimationFrame(poll);
    return () => cancelAnimationFrame(raf);
  }, [project.modRoutes]);

  if (!channel) return null;

  const updateCh = (fn: (ch: typeof channel) => void, record = false) => {
    projectStore.update((s) => {
      const target = s.channels.find((c) => c.id === channel.id);
      if (target) fn(target);
    }, record);
  };

  const handleImportSampleOrSf2 = async () => {
    const applyFile = async (name: string, bytes: Uint8Array) => {
      if (name.toLowerCase().endsWith('.sf2')) {
        const res = await audioEngine.loadCustomSoundFont(name, bytes);
        updateCh((c) => {
          c.engine = 'SoundFont';
          c.soundFont.sf2Name = res.id;
          c.soundFont.presetIndex = 0;
        }, true);
      } else {
        const key = await audioEngine.loadCustomSample(name, bytes);
        updateCh((c) => {
          c.engine = 'Sampler';
          c.sampler.sampleName = name;
          c.sampler.assetPath = key;
        }, true);
      }
    };

    if (window.bebeat?.pickAudioOrSf2) {
      const picked = await window.bebeat.pickAudioOrSf2();
      if (picked) await applyFile(picked.name, picked.bytes);
      return;
    }

    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.wav,.flac,.mp3,.ogg,.sf2';
    input.onchange = async () => {
      const file = input.files?.[0];
      if (!file) return;
      await applyFile(file.name, new Uint8Array(await file.arrayBuffer()));
    };
    input.click();
  };

  const toggleMidiLearn = (param: string, min: number, max: number) => {
    const key = `${channel.id}:${param}`;
    if (midiLearnActive === key) {
      audioEngine.armMidiLearn(null);
      setMidiLearnActive(null);
    } else {
      audioEngine.armMidiLearn({ targetType: 'channel', targetId: channel.id, param, min, max });
      setMidiLearnActive(key);
    }
  };

  const sf2List = audioEngine.sf2Player.listFonts();
  const activeSf2 = sf2List.find((f) => f.id === channel.soundFont.sf2Name) || sf2List[0];

  return (
    <div style={{ flex: 1, display: 'flex', minHeight: 0, overflow: 'hidden', background: 'var(--bg)' }}>
      {/* Left Channel Selector Rail */}
      <aside className="panel-col" style={{ width: 220, flex: 'none' }}>
        <div className="panel-header">
          <span className="panel-title">Instruments</span>
        </div>
        <div className="panel-scroll">
          {project.channels.map((ch) => (
            <button
              key={ch.id}
              className={`preset-item ${ch.id === channel.id ? 'active' : ''}`}
              onClick={() => projectStore.update((s) => { s.selectedChannelId = ch.id; }, false)}
            >
              <div style={{ display: 'flex', justifyContent: 'space-between', width: '100%' }}>
                <span style={{ fontWeight: 600 }}>{ch.name}</span>
                <span className="mono" style={{ fontSize: 10, opacity: 0.7 }}>{ch.engine}</span>
              </div>
              <span style={{ fontSize: 10, opacity: 0.7 }}>
                {ch.engine === 'SubSynth'
                  ? ch.subSynth.presetName
                  : ch.engine === 'FMSynth'
                  ? ch.fmSynth.presetName
                  : ch.engine === 'DrumSynth'
                  ? `${ch.drumSynth.kitId} / ${ch.drumSynth.voice.toUpperCase()}`
                  : ch.engine === 'SoundFont'
                  ? ch.soundFont.sf2Name
                  : ch.sampler.sampleName}
              </span>
            </button>
          ))}
        </div>
      </aside>

      {/* Center Synth Editor + Onscreen Keyboard */}
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minWidth: 0 }}>
        <div className="panel-header">
          <span className="panel-title">{channel.name}</span>
          <select
            value={channel.engine}
            onChange={(e) => updateCh((c) => { c.engine = e.target.value as InstrumentEngine; }, true)}
          >
            <option value="SubSynth">SubSynth (Subtractive + Wavetable)</option>
            <option value="FMSynth">FMSynth (4-Op FM/PM)</option>
            <option value="DrumSynth">DrumSynth + 24-bit Kit</option>
            <option value="Sampler">Sampler (.wav / .flac)</option>
            <option value="SoundFont">SoundFont (.sf2)</option>
          </select>

          {channel.engine === 'SubSynth' && (
            <select
              value={channel.subSynth.presetName}
              onChange={(e) => {
                const preset = SUB_SYNTH_PRESETS[e.target.value];
                if (preset) updateCh((c) => { c.subSynth = JSON.parse(JSON.stringify(preset)); }, true);
              }}
            >
              {Object.keys(SUB_SYNTH_PRESETS).map((name) => (
                <option key={name} value={name}>Preset: {name}</option>
              ))}
            </select>
          )}

          {channel.engine === 'FMSynth' && (
            <select
              value={channel.fmSynth.presetName}
              onChange={(e) => {
                const preset = FM_SYNTH_PRESETS[e.target.value];
                if (preset) updateCh((c) => { c.fmSynth = JSON.parse(JSON.stringify(preset)); }, true);
              }}
            >
              {Object.keys(FM_SYNTH_PRESETS).map((name) => (
                <option key={name} value={name}>Preset: {name}</option>
              ))}
            </select>
          )}

          <div className="spacer" />
          {(channel.engine === 'SubSynth' || channel.engine === 'FMSynth') && (
            <button
              className="sm"
              onClick={() => {
                updateCh((c) => {
                  if (c.engine === 'SubSynth') {
                    const waves: OscWaveform[] = ['sine', 'triangle', 'sawtooth', 'square', 'wavetable'];
                    c.subSynth.presetName = 'Randomized Patch';
                    c.subSynth.osc1Wave = waves[Math.floor(Math.random() * waves.length)];
                    c.subSynth.osc2Wave = waves[Math.floor(Math.random() * waves.length)];
                    c.subSynth.oscMix = Math.round(Math.random() * 100) / 100;
                    c.subSynth.cutoff = Math.round(220 + Math.random() * 5800);
                    c.subSynth.resonance = Math.round((0.8 + Math.random() * 9) * 10) / 10;
                    c.subSynth.unisonVoices = 1 + Math.floor(Math.random() * 4);
                    c.subSynth.drive = Math.round(Math.random() * 60) / 100;
                  } else if (c.engine === 'FMSynth') {
                    c.fmSynth.presetName = 'Randomized FM';
                    c.fmSynth.algorithm = Math.floor(Math.random() * 6) as 0 | 1 | 2 | 3 | 4 | 5;
                    c.fmSynth.modIndex = Math.round((0.8 + Math.random() * 7) * 10) / 10;
                    c.fmSynth.feedback = Math.round(Math.random() * 65) / 100;
                    c.fmSynth.cutoff = Math.round(900 + Math.random() * 9000);
                  }
                }, true);
              }}
              title="Randomize Synth Parameters"
            >
              <Dices size={12} /> Randomize
            </button>
          )}
          <button
            className={midiLearnActive === `${channel.id}:cutoff` ? 'active sm' : 'sm'}
            onClick={() => toggleMidiLearn('cutoff', 80, 14000)}
            title="Click then move any MIDI hardware knob to bind Filter Cutoff"
          >
            <Sliders size={12} /> {midiLearnActive === `${channel.id}:cutoff` ? 'Move MIDI CC...' : 'MIDI Learn Cutoff'}
          </button>
          <button className="sm" onClick={handleImportSampleOrSf2}>
            <Upload size={12} /> Load WAV / SF2
          </button>
        </div>

        <div className="panel-scroll">
          {/* SubSynth Editor */}
          {channel.engine === 'SubSynth' && (
            <div className="inst-grid">
              <div className="inst-section">
                <div className="inst-section-title">Oscillators &amp; Wavetable</div>
                <div className="param-row">
                  <label>Osc 1 Wave</label>
                  <select
                    value={channel.subSynth.osc1Wave}
                    onChange={(e) => updateCh((c) => { c.subSynth.osc1Wave = e.target.value as OscWaveform; }, true)}
                  >
                    <option value="sawtooth">Sawtooth</option>
                    <option value="square">Square</option>
                    <option value="triangle">Triangle</option>
                    <option value="sine">Sine</option>
                    <option value="wavetable">Wavetable</option>
                  </select>
                  <span className="val">O1</span>
                </div>
                <div className="param-row">
                  <label>Osc 2 Wave</label>
                  <select
                    value={channel.subSynth.osc2Wave}
                    onChange={(e) => updateCh((c) => { c.subSynth.osc2Wave = e.target.value as OscWaveform; }, true)}
                  >
                    <option value="sawtooth">Sawtooth</option>
                    <option value="square">Square</option>
                    <option value="triangle">Triangle</option>
                    <option value="sine">Sine</option>
                    <option value="wavetable">Wavetable</option>
                  </select>
                  <span className="val">O2</span>
                </div>
                <div className="param-row">
                  <label>Wavetable</label>
                  <select
                    value={channel.subSynth.wavetableName}
                    onChange={(e) => updateCh((c) => { c.subSynth.wavetableName = e.target.value; }, true)}
                  >
                    <option value="acid_morph">acid_morph</option>
                    <option value="glass_fm">glass_fm</option>
                    <option value="warm_organ">warm_organ</option>
                    <option value="formant_sweep">formant_sweep</option>
                  </select>
                  <span className="val">WT</span>
                </div>
                <div className="param-row">
                  <label>WT Morph</label>
                  <input type="range" min={0} max={1} step={0.01} value={channel.subSynth.wavetableMorph}
                    onChange={(e) => updateCh((c) => { c.subSynth.wavetableMorph = parseFloat(e.target.value); })} />
                  <span className="val">{Math.round(channel.subSynth.wavetableMorph * 100)}%</span>
                </div>
                <div className="param-row">
                  <label>Osc Mix</label>
                  <input type="range" min={0} max={1} step={0.01} value={channel.subSynth.oscMix}
                    onChange={(e) => updateCh((c) => { c.subSynth.oscMix = parseFloat(e.target.value); })} />
                  <span className="val">{Math.round(channel.subSynth.oscMix * 100)}%</span>
                </div>
                <div className="param-row">
                  <label>Unison Voices</label>
                  <input type="range" min={1} max={5} step={1} value={channel.subSynth.unisonVoices}
                    onChange={(e) => updateCh((c) => { c.subSynth.unisonVoices = parseInt(e.target.value, 10); })} />
                  <span className="val">{channel.subSynth.unisonVoices}v</span>
                </div>
                <div className="param-row">
                  <label>Stereo Spread</label>
                  <input type="range" min={0} max={1} step={0.02} value={channel.subSynth.stereoSpread}
                    onChange={(e) => updateCh((c) => { c.subSynth.stereoSpread = parseFloat(e.target.value); })} />
                  <span className="val">{Math.round(channel.subSynth.stereoSpread * 100)}%</span>
                </div>
              </div>

              <div className="inst-section">
                <div className="inst-section-title">Resonant Filter &amp; Drive</div>
                <FilterCurveSvg
                  mode={channel.subSynth.filterMode}
                  cutoff={channel.subSynth.cutoff}
                  resonance={channel.subSynth.resonance}
                />
                <div className="param-row">
                  <label>Filter Mode</label>
                  <select
                    value={channel.subSynth.filterMode}
                    onChange={(e) => updateCh((c) => { c.subSynth.filterMode = e.target.value as FilterMode; }, true)}
                  >
                    <option value="lowpass">Lowpass</option>
                    <option value="highpass">Highpass</option>
                    <option value="bandpass">Bandpass</option>
                    <option value="notch">Notch</option>
                  </select>
                  <span className="val">SVF</span>
                </div>
                <div className="param-row">
                  <label>Cutoff</label>
                  <input type="range" min={60} max={16000} step={10} value={channel.subSynth.cutoff}
                    onChange={(e) => updateCh((c) => { c.subSynth.cutoff = parseFloat(e.target.value); })} />
                  <span className="val">{Math.round(channel.subSynth.cutoff)}Hz</span>
                </div>
                <div className="param-row">
                  <label>Resonance</label>
                  <input type="range" min={0.2} max={18} step={0.1} value={channel.subSynth.resonance}
                    onChange={(e) => updateCh((c) => { c.subSynth.resonance = parseFloat(e.target.value); })} />
                  <span className="val">{channel.subSynth.resonance.toFixed(1)}</span>
                </div>
                <div className="param-row">
                  <label>Env Amount</label>
                  <input type="range" min={-6000} max={8000} step={50} value={channel.subSynth.filterEnvAmount}
                    onChange={(e) => updateCh((c) => { c.subSynth.filterEnvAmount = parseFloat(e.target.value); })} />
                  <span className="val">{Math.round(channel.subSynth.filterEnvAmount)}</span>
                </div>
                <div className="param-row">
                  <label>Analog Drive</label>
                  <input type="range" min={0} max={1} step={0.02} value={channel.subSynth.drive}
                    onChange={(e) => updateCh((c) => { c.subSynth.drive = parseFloat(e.target.value); })} />
                  <span className="val">{Math.round(channel.subSynth.drive * 100)}%</span>
                </div>
                <div className="param-row">
                  <label>Glide / Slide</label>
                  <input type="range" min={0} max={0.35} step={0.005} value={channel.subSynth.glide}
                    onChange={(e) => updateCh((c) => { c.subSynth.glide = parseFloat(e.target.value); })} />
                  <span className="val">{Math.round(channel.subSynth.glide * 1000)}ms</span>
                </div>
              </div>

              <div className="inst-section">
                <div className="inst-section-title">Amp ADSR &amp; Sync LFO</div>
                <AdsrCurveSvg
                  attack={channel.subSynth.ampEnv.attack}
                  decay={channel.subSynth.ampEnv.decay}
                  sustain={channel.subSynth.ampEnv.sustain}
                  release={channel.subSynth.ampEnv.release}
                />
                {(['attack', 'decay', 'sustain', 'release'] as const).map((k) => (
                  <div key={k} className="param-row">
                    <label>{k.toUpperCase()}</label>
                    <input
                      type="range"
                      min={k === 'sustain' ? 0 : 0.002}
                      max={k === 'sustain' ? 1 : 2.0}
                      step={0.005}
                      value={channel.subSynth.ampEnv[k]}
                      onChange={(e) => updateCh((c) => { c.subSynth.ampEnv[k] = parseFloat(e.target.value); })}
                    />
                    <span className="val">{channel.subSynth.ampEnv[k].toFixed(2)}</span>
                  </div>
                ))}
                <div className="param-row">
                  <label>LFO Rate</label>
                  <input type="range" min={0.05} max={16} step={0.05} value={channel.subSynth.lfoRateHz}
                    onChange={(e) => updateCh((c) => { c.subSynth.lfoRateHz = parseFloat(e.target.value); })} />
                  <span className="val">{channel.subSynth.lfoRateHz.toFixed(1)}Hz</span>
                </div>
                <div className="param-row">
                  <label>LFO Depth</label>
                  <input type="range" min={0} max={1} step={0.02} value={channel.subSynth.lfoDepth}
                    onChange={(e) => updateCh((c) => { c.subSynth.lfoDepth = parseFloat(e.target.value); })} />
                  <span className="val">{Math.round(channel.subSynth.lfoDepth * 100)}%</span>
                </div>
              </div>
            </div>
          )}

          {/* FMSynth Editor */}
          {channel.engine === 'FMSynth' && (
            <div className="inst-grid">
              <div className="inst-section">
                <div className="inst-section-title">4-Operator FM Topology</div>
                <div className="param-row">
                  <label>Algorithm</label>
                  <select
                    value={channel.fmSynth.algorithm}
                    onChange={(e) => updateCh((c) => { c.fmSynth.algorithm = parseInt(e.target.value, 10) as 0 | 1 | 2 | 3 | 4 | 5; }, true)}
                  >
                    <option value={0}>Alg 0: 4→3→2→1 Serial</option>
                    <option value={1}>Alg 1: (4→3)+(2→1) Keys</option>
                    <option value={2}>Alg 2: (4+3+2)→1 Bell</option>
                    <option value={3}>Alg 3: 4→(3+2)→1 Pluck</option>
                    <option value={4}>Alg 4: (4→3→2)+1 Bass</option>
                    <option value={5}>Alg 5: 4+3+2+1 Organ</option>
                  </select>
                  <span className="val">A{channel.fmSynth.algorithm}</span>
                </div>
                <div className="param-row">
                  <label>FM Index</label>
                  <input type="range" min={0} max={12} step={0.1} value={channel.fmSynth.modIndex}
                    onChange={(e) => updateCh((c) => { c.fmSynth.modIndex = parseFloat(e.target.value); })} />
                  <span className="val">{channel.fmSynth.modIndex.toFixed(1)}</span>
                </div>
                <div className="param-row">
                  <label>Op4 Feedback</label>
                  <input type="range" min={0} max={1} step={0.02} value={channel.fmSynth.feedback}
                    onChange={(e) => updateCh((c) => { c.fmSynth.feedback = parseFloat(e.target.value); })} />
                  <span className="val">{Math.round(channel.fmSynth.feedback * 100)}%</span>
                </div>
                <div className="param-row">
                  <label>Filter Cutoff</label>
                  <input type="range" min={120} max={18000} step={20} value={channel.fmSynth.cutoff}
                    onChange={(e) => updateCh((c) => { c.fmSynth.cutoff = parseFloat(e.target.value); })} />
                  <span className="val">{Math.round(channel.fmSynth.cutoff)}Hz</span>
                </div>
              </div>

              {channel.fmSynth.operators.map((op, opIdx) => (
                <div key={opIdx} className="inst-section">
                  <div className="inst-section-title">Operator {opIdx + 1}</div>
                  <div className="param-row">
                    <label>Ratio</label>
                    <input type="range" min={0.5} max={16} step={0.25} value={op.ratio}
                      onChange={(e) => updateCh((c) => { c.fmSynth.operators[opIdx].ratio = parseFloat(e.target.value); })} />
                    <span className="val">{op.ratio.toFixed(2)}x</span>
                  </div>
                  <div className="param-row">
                    <label>Level</label>
                    <input type="range" min={0} max={1} step={0.02} value={op.level}
                      onChange={(e) => updateCh((c) => { c.fmSynth.operators[opIdx].level = parseFloat(e.target.value); })} />
                    <span className="val">{Math.round(op.level * 100)}%</span>
                  </div>
                  <div className="param-row">
                    <label>Decay</label>
                    <input type="range" min={0.02} max={2.0} step={0.02} value={op.env.decay}
                      onChange={(e) => updateCh((c) => { c.fmSynth.operators[opIdx].env.decay = parseFloat(e.target.value); })} />
                    <span className="val">{op.env.decay.toFixed(2)}s</span>
                  </div>
                  <div className="param-row">
                    <label>Release</label>
                    <input type="range" min={0.02} max={1.5} step={0.02} value={op.env.release}
                      onChange={(e) => updateCh((c) => { c.fmSynth.operators[opIdx].env.release = parseFloat(e.target.value); })} />
                    <span className="val">{op.env.release.toFixed(2)}s</span>
                  </div>
                </div>
              ))}
            </div>
          )}

          {/* DrumSynth + Kit Editor */}
          {channel.engine === 'DrumSynth' && (
            <div className="inst-grid">
              <div className="inst-section">
                <div className="inst-section-title">24-Bit Kit &amp; Drum Voice</div>
                <div className="param-row">
                  <label>Kit Bank</label>
                  <select
                    value={channel.drumSynth.kitId}
                    onChange={(e) => updateCh((c) => { c.drumSynth.kitId = e.target.value; }, true)}
                  >
                    <option value="808_clean">808 Clean Studio (24-bit WAV)</option>
                    <option value="909_punch">909 Club Punch (24-bit WAV)</option>
                    <option value="ukg_break">UKG Tight Break (24-bit WAV)</option>
                    <option value="fm_perc">FM Metallic Modular (24-bit WAV)</option>
                  </select>
                  <span className="val">KIT</span>
                </div>
                <div className="param-row">
                  <label>Voice</label>
                  <select
                    value={channel.drumSynth.voice}
                    onChange={(e) => updateCh((c) => { c.drumSynth.voice = e.target.value as DrumVoiceName; }, true)}
                  >
                    {DRUM_VOICES.map((v) => (
                      <option key={v} value={v}>{v.toUpperCase()}</option>
                    ))}
                  </select>
                  <span className="val">{channel.drumSynth.voice.toUpperCase()}</span>
                </div>
                <div className="param-row">
                  <label>Engine Mode</label>
                  <button
                    className={channel.drumSynth.useSample ? 'active sm' : 'sm'}
                    onClick={() => updateCh((c) => { c.drumSynth.useSample = !c.drumSynth.useSample; }, true)}
                  >
                    {channel.drumSynth.useSample ? '24-Bit WAV Sample' : 'Pure DSP DrumSynth'}
                  </button>
                  <span className="val">{channel.drumSynth.useSample ? 'WAV' : 'DSP'}</span>
                </div>
                <div className="param-row">
                  <label>Tune (Semi)</label>
                  <input type="range" min={-12} max={12} step={1} value={channel.drumSynth.tuneSemi}
                    onChange={(e) => updateCh((c) => { c.drumSynth.tuneSemi = parseInt(e.target.value, 10); })} />
                  <span className="val">{channel.drumSynth.tuneSemi}st</span>
                </div>
                <div className="param-row">
                  <label>Decay</label>
                  <input type="range" min={0.05} max={1.0} step={0.02} value={channel.drumSynth.decay}
                    onChange={(e) => updateCh((c) => { c.drumSynth.decay = parseFloat(e.target.value); })} />
                  <span className="val">{channel.drumSynth.decay.toFixed(2)}s</span>
                </div>
              </div>
            </div>
          )}

          {/* SoundFont Editor */}
          {channel.engine === 'SoundFont' && (
            <div className="inst-grid">
              <div className="inst-section">
                <div className="inst-section-title">RIFF / SF2 SoundFont Player</div>
                <div className="param-row">
                  <label>SoundFont</label>
                  <span className="mono" style={{ fontSize: 11 }}>{channel.soundFont.sf2Name}</span>
                  <span className="val">SF2</span>
                </div>
                <div className="param-row">
                  <label>Preset</label>
                  <select
                    value={channel.soundFont.presetIndex}
                    onChange={(e) => updateCh((c) => { c.soundFont.presetIndex = parseInt(e.target.value, 10); }, true)}
                  >
                    {(activeSf2?.presets || [
                      { name: 'ElectricPiano', preset: 0 },
                      { name: 'AnalogBass', preset: 1 },
                      { name: 'GlassBell', preset: 2 },
                    ]).map((p, idx) => (
                      <option key={idx} value={idx}>
                        0:{String(p.preset).padStart(3, '0')} {p.name}
                      </option>
                    ))}
                  </select>
                  <span className="val">P{channel.soundFont.presetIndex}</span>
                </div>
                <div className="param-row">
                  <label>Filter Cutoff</label>
                  <input type="range" min={300} max={18000} step={50} value={channel.soundFont.cutoff}
                    onChange={(e) => updateCh((c) => { c.soundFont.cutoff = parseFloat(e.target.value); })} />
                  <span className="val">{Math.round(channel.soundFont.cutoff)}Hz</span>
                </div>
                <div className="param-row">
                  <label>Release</label>
                  <input type="range" min={0.05} max={2.0} step={0.05} value={channel.soundFont.release}
                    onChange={(e) => updateCh((c) => { c.soundFont.release = parseFloat(e.target.value); })} />
                  <span className="val">{channel.soundFont.release.toFixed(2)}s</span>
                </div>
              </div>
            </div>
          )}

          {/* Sampler Editor */}
          {channel.engine === 'Sampler' && (
            <div className="inst-grid">
              <div className="inst-section">
                <div className="inst-section-title">Sample Playback (.wav / .flac)</div>
                <div className="param-row">
                  <label>Active Sample</label>
                  <span className="mono" style={{ fontSize: 11 }}>{channel.sampler.sampleName}</span>
                  <span className="val">PCM</span>
                </div>
                <div className="param-row">
                  <label>Root Note</label>
                  <input type="range" min={24} max={84} step={1} value={channel.sampler.rootMidi}
                    onChange={(e) => updateCh((c) => { c.sampler.rootMidi = parseInt(e.target.value, 10); })} />
                  <span className="val">{midiToNoteName(channel.sampler.rootMidi)}</span>
                </div>
                <div className="param-row">
                  <label>Cutoff</label>
                  <input type="range" min={200} max={18000} step={50} value={channel.sampler.cutoff}
                    onChange={(e) => updateCh((c) => { c.sampler.cutoff = parseFloat(e.target.value); })} />
                  <span className="val">{Math.round(channel.sampler.cutoff)}Hz</span>
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Playable Onscreen Audition Keyboard with PC Keybinds */}
        <div className="piano-live-strip" style={{ height: 64 }}>
          {KEYBOARD_SEMIS.map((semi) => {
            const midi = baseTypingMidi + semi;
            const isBlack = [1, 3, 6, 8, 10].includes(midi % 12);
            const isPressed = pressedNotes.has(midi);
            const bind = SEMITONE_TO_KEY_LABEL[semi] || '';
            return (
              <button
                key={semi}
                className={`piano-live-key ${isBlack ? 'black' : 'white'} ${isPressed ? 'pressed' : ''}`}
                onMouseDown={() => void audioEngine.noteOnLive(channel.id, midi, 0.85)}
                onMouseUp={() => audioEngine.noteOffLive(channel.id, midi)}
                onMouseLeave={() => { if (isPressed) audioEngine.noteOffLive(channel.id, midi); }}
                title={`${midiToNoteName(midi)} (Keyboard key: ${bind})`}
              >
                <span style={{ fontWeight: 700, fontSize: 10 }}>{bind}</span>
                <span className="mono" style={{ fontSize: 9, opacity: 0.8 }}>
                  {midi % 12 === 0 ? midiToNoteName(midi) : ''}
                </span>
              </button>
            );
          })}
        </div>
      </div>

      {/* Right Beat-Reactive & Audio-Driven Modulation Matrix */}
      <aside className="mixer-fx-rack" style={{ width: 340 }}>
        <div className="panel-header">
          <Activity size={13} />
          <span className="panel-title">Beat-Reactive Mod Matrix</span>
        </div>

        <div style={{ padding: 10, borderBottom: '1px solid var(--border)', display: 'flex', flexDirection: 'column', gap: 6 }}>
          <div style={{ display: 'flex', gap: 5 }}>
            <select style={{ flex: 1 }} value={newModSrc} onChange={(e) => setNewModSrc(e.target.value as ModSourceId)}>
              {(Object.keys(MOD_SOURCE_LABELS) as ModSourceId[]).map((src) => (
                <option key={src} value={src}>{MOD_SOURCE_LABELS[src]}</option>
              ))}
            </select>
            <select style={{ width: 120 }} value={newModParam} onChange={(e) => setNewModParam(e.target.value as ModTargetParam)}>
              {(Object.keys(MOD_PARAM_RANGES) as ModTargetParam[]).map((p) => (
                <option key={p} value={p}>{p}</option>
              ))}
            </select>
          </div>
          <button
            className="sm"
            onClick={() => {
              const range = MOD_PARAM_RANGES[newModParam];
              projectStore.update((s) => {
                s.modRoutes.push({
                  id: uid('mod'),
                  enabled: true,
                  source: newModSrc,
                  targetType: 'channel',
                  targetId: channel.id,
                  param: newModParam,
                  depth: 0.65,
                  min: range.min,
                  max: range.max,
                });
              });
            }}
          >
            <Plus size={12} /> Route to {channel.name}
          </button>
        </div>

        <div className="panel-scroll">
          {project.modRoutes.map((route) => {
            const targetCh = project.channels.find((c) => c.id === route.targetId);
            const liveVal = modLiveVals[route.id] ?? 0;
            return (
              <div key={route.id} className="fx-card">
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
                  <div>
                    <div className="mono" style={{ fontSize: 11, color: '#FFFFFF', fontWeight: 600 }}>
                      {route.source} → {route.param}
                    </div>
                    <div style={{ fontSize: 10, color: '#94A3B8' }}>
                      Target: {targetCh?.name || route.targetId}
                    </div>
                  </div>
                  <div style={{ display: 'flex', gap: 4 }}>
                    <button
                      className={route.enabled ? 'active sm' : 'sm'}
                      onClick={() =>
                        projectStore.update((s) => {
                          const r = s.modRoutes.find((x) => x.id === route.id);
                          if (r) r.enabled = !r.enabled;
                        })
                      }
                    >
                      {route.enabled ? 'ON' : 'OFF'}
                    </button>
                    <button
                      className="sm icon-only danger-outline"
                      onClick={() =>
                        projectStore.update((s) => {
                          s.modRoutes = s.modRoutes.filter((x) => x.id !== route.id);
                        })
                      }
                    >
                      <Trash2 size={11} />
                    </button>
                  </div>
                </div>

                {/* Live Mod Activity Meter */}
                <div style={{ height: 5, background: 'var(--bg)', border: '1px solid var(--border)', marginBottom: 6 }}>
                  <div style={{ width: `${Math.min(100, Math.round(liveVal * 100))}%`, height: '100%', background: '#60A5FA' }} />
                </div>

                <div className="param-row" style={{ marginBottom: 0 }}>
                  <label>Depth</label>
                  <input
                    type="range"
                    min={-1}
                    max={1}
                    step={0.05}
                    value={route.depth}
                    onChange={(e) => {
                      const d = parseFloat(e.target.value);
                      projectStore.update((s) => {
                        const r = s.modRoutes.find((x) => x.id === route.id);
                        if (r) r.depth = d;
                      }, false);
                    }}
                  />
                  <span className="val">{Math.round(route.depth * 100)}%</span>
                </div>
              </div>
            );
          })}
        </div>
      </aside>
    </div>
  );
};
