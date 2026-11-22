import React, { useEffect, useState } from 'react';
import { Plus, Trash2, Power } from 'lucide-react';
import type { FxType, ProjectState } from '../types/daw';
import { createDefaultFxSlot, projectStore, uid } from '../state/projectStore';
import { audioEngine } from '../audio/engine';

interface MixerViewProps {
  project: ProjectState;
}

const FX_LABELS: Record<FxType, string> = {
  eq4: '4-Band Parametric EQ',
  compressor: 'Compressor / Limiter',
  reverb: 'Algorithmic Reverb',
  delay: 'Tempo Stereo Delay',
  saturation: 'Analog Saturation',
  filter: 'Multi-Mode Filter',
  chorus: 'Stereo Chorus',
};

const FX_PARAM_META: Record<FxType, Array<{ key: string; label: string; min: number; max: number; step: number; unit?: string }>> = {
  eq4: [
    { key: 'lowGain', label: 'Low (90Hz)', min: -12, max: 12, step: 0.5, unit: 'dB' },
    { key: 'lowMidGain', label: 'LowMid', min: -12, max: 12, step: 0.5, unit: 'dB' },
    { key: 'highMidGain', label: 'HighMid', min: -12, max: 12, step: 0.5, unit: 'dB' },
    { key: 'highGain', label: 'High (8k)', min: -12, max: 12, step: 0.5, unit: 'dB' },
  ],
  compressor: [
    { key: 'threshold', label: 'Threshold', min: -42, max: 0, step: 1, unit: 'dB' },
    { key: 'ratio', label: 'Ratio', min: 1, max: 20, step: 0.5, unit: ':1' },
    { key: 'attack', label: 'Attack', min: 0.001, max: 0.1, step: 0.002, unit: 's' },
    { key: 'release', label: 'Release', min: 0.02, max: 0.6, step: 0.02, unit: 's' },
    { key: 'makeup', label: 'Makeup', min: 0, max: 12, step: 0.5, unit: 'dB' },
  ],
  reverb: [
    { key: 'mix', label: 'Wet Mix', min: 0, max: 1, step: 0.02 },
    { key: 'decay', label: 'Decay', min: 0.3, max: 5.5, step: 0.1, unit: 's' },
    { key: 'damping', label: 'Damping', min: 800, max: 14000, step: 100, unit: 'Hz' },
  ],
  delay: [
    { key: 'mix', label: 'Wet Mix', min: 0, max: 1, step: 0.02 },
    { key: 'division', label: 'Sync Beat', min: 0.125, max: 1.0, step: 0.125, unit: 'b' },
    { key: 'feedback', label: 'Feedback', min: 0, max: 0.85, step: 0.02 },
    { key: 'tone', label: 'Tone LP', min: 500, max: 12000, step: 100, unit: 'Hz' },
  ],
  saturation: [
    { key: 'drive', label: 'Drive', min: 0, max: 1, step: 0.02 },
    { key: 'mix', label: 'Mix', min: 0, max: 1, step: 0.02 },
    { key: 'tone', label: 'Tone LP', min: 800, max: 16000, step: 200, unit: 'Hz' },
  ],
  filter: [
    { key: 'cutoff', label: 'Cutoff', min: 40, max: 16000, step: 20, unit: 'Hz' },
    { key: 'resonance', label: 'Resonance', min: 0.3, max: 16, step: 0.2 },
    { key: 'mode', label: 'Mode (0-3)', min: 0, max: 3, step: 1 },
  ],
  chorus: [
    { key: 'mix', label: 'Mix', min: 0, max: 1, step: 0.02 },
    { key: 'rate', label: 'Rate', min: 0.1, max: 5, step: 0.1, unit: 'Hz' },
    { key: 'depth', label: 'Depth', min: 0, max: 1, step: 0.02 },
  ],
};

function volToDb(v: number): string {
  if (v <= 0.001) return '-inf';
  const db = 20 * Math.log10(v);
  return `${db >= 0 ? '+' : ''}${db.toFixed(1)}`;
}

export const MixerView: React.FC<MixerViewProps> = ({ project }) => {
  const [peaks, setPeaks] = useState<Record<string, number>>({});
  const [newFxType, setNewFxType] = useState<FxType>('reverb');

  const selectedTrack =
    project.mixerTracks.find((t) => t.id === project.selectedMixerTrackId) || project.mixerTracks[0];

  useEffect(() => {
    let raf = 0;
    const poll = () => {
      const next: Record<string, number> = {};
      for (const t of project.mixerTracks) {
        next[t.id] = audioEngine.readMixerTrackPeak(t.id);
      }
      setPeaks(next);
      raf = requestAnimationFrame(poll);
    };
    raf = requestAnimationFrame(poll);
    return () => cancelAnimationFrame(raf);
  }, [project.mixerTracks]);

  const addInsertTrack = () => {
    projectStore.update((s) => {
      const insertCount = s.mixerTracks.filter((t) => t.kind === 'insert').length;
      const sendIdx = s.mixerTracks.findIndex((t) => t.kind === 'send');
      const newTrack = {
        id: uid('mx'),
        index: insertCount + 1,
        name: `Insert ${insertCount + 1}`,
        kind: 'insert' as const,
        volume: 0.85,
        pan: 0,
        mute: false,
        solo: false,
        sendA: 0,
        sendB: 0,
        fx: [],
      };
      if (sendIdx >= 0) s.mixerTracks.splice(sendIdx, 0, newTrack);
      else s.mixerTracks.push(newTrack);
      s.selectedMixerTrackId = newTrack.id;
    });
  };

  return (
    <div className="mixer-wrap">
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minWidth: 0 }}>
        <div className="panel-header">
          <span className="panel-title">Console Mixer</span>
          <span className="mono" style={{ fontSize: 10.5, color: '#94A3B8' }}>
            {project.mixerTracks.length} BUSES (MASTER + INSERTS + SENDS)
          </span>
          <div className="spacer" />
          <button className="sm" onClick={addInsertTrack}>
            <Plus size={12} /> Add Insert Bus
          </button>
        </div>

        <div className="mixer-strips">
          {project.mixerTracks.map((t) => {
            const isSel = selectedTrack?.id === t.id;
            const pk = peaks[t.id] || 0;
            const pkPct = Math.min(100, Math.round(pk * 115));
            return (
              <div
                key={t.id}
                className={`mixer-strip ${isSel ? 'selected' : ''} ${t.kind === 'master' ? 'master-strip' : ''}`}
                onClick={() => projectStore.update((s) => { s.selectedMixerTrackId = t.id; }, false)}
              >
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <span className="mono" style={{ fontSize: 10, color: '#64748B' }}>
                    {t.kind === 'master' ? 'MST' : t.kind === 'send' ? 'SND' : `M${t.index}`}
                  </span>
                  <span className="mono" style={{ fontSize: 10, color: '#94A3B8' }}>
                    {t.fx.filter((f) => f.enabled).length} FX
                  </span>
                </div>
                <div style={{ fontWeight: 700, fontSize: 11.5, color: '#FFFFFF', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                  {t.name}
                </div>

                {/* Mute / Solo */}
                <div style={{ display: 'flex', gap: 4 }}>
                  <button
                    className={t.mute ? 'sm danger-outline' : 'sm'}
                    style={{ flex: 1 }}
                    onClick={(e) => {
                      e.stopPropagation();
                      projectStore.update((s) => {
                        const m = s.mixerTracks.find((x) => x.id === t.id);
                        if (m) m.mute = !m.mute;
                      });
                    }}
                  >
                    M
                  </button>
                  {t.kind === 'insert' && (
                    <button
                      className={t.solo ? 'active sm' : 'sm'}
                      style={{ flex: 1 }}
                      onClick={(e) => {
                        e.stopPropagation();
                        projectStore.update((s) => {
                          const m = s.mixerTracks.find((x) => x.id === t.id);
                          if (m) m.solo = !m.solo;
                        });
                      }}
                    >
                      S
                    </button>
                  )}
                </div>

                {/* Pan */}
                <div onClick={(e) => e.stopPropagation()}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 9.5, color: '#64748B' }}>
                    <span>PAN</span>
                    <span className="mono">{t.pan === 0 ? 'C' : t.pan > 0 ? `R${Math.round(t.pan * 100)}` : `L${Math.round(-t.pan * 100)}`}</span>
                  </div>
                  <input
                    type="range"
                    min={-1}
                    max={1}
                    step={0.02}
                    value={t.pan}
                    onChange={(e) => {
                      const v = parseFloat(e.target.value);
                      projectStore.update((s) => {
                        const m = s.mixerTracks.find((x) => x.id === t.id);
                        if (m) m.pan = v;
                      }, false);
                    }}
                  />
                </div>

                {/* Vertical Meter + Fader */}
                <div className="mixer-fader-area" onClick={(e) => e.stopPropagation()}>
                  <div className="mixer-meter-bar">
                    <div
                      className="mixer-meter-fill"
                      style={{
                        height: `${pkPct}%`,
                        background: pkPct > 94 ? '#F87171' : pkPct > 80 ? '#FBBF24' : '#FFFFFF',
                      }}
                    />
                  </div>
                  <input
                    type="range"
                    min={0}
                    max={1.35}
                    step={0.01}
                    value={t.volume}
                    style={{
                      writingMode: 'vertical-lr',
                      direction: 'rtl',
                      height: '100%',
                      width: 24,
                    }}
                    onChange={(e) => {
                      const v = parseFloat(e.target.value);
                      projectStore.update((s) => {
                        const m = s.mixerTracks.find((x) => x.id === t.id);
                        if (m) m.volume = v;
                      }, false);
                    }}
                  />
                </div>

                <div className="mono" style={{ textAlign: 'center', fontSize: 11, color: '#FFFFFF', fontWeight: 600 }}>
                  {volToDb(t.volume)} dB
                </div>

                {/* Send A / Send B knobs on insert tracks */}
                {t.kind === 'insert' && (
                  <div style={{ borderTop: '1px solid #24324D', paddingTop: 5 }} onClick={(e) => e.stopPropagation()}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 9.5, color: '#94A3B8' }}>
                      <span>Verb A</span>
                      <span className="mono">{Math.round(t.sendA * 100)}%</span>
                    </div>
                    <input
                      type="range"
                      min={0}
                      max={1}
                      step={0.02}
                      value={t.sendA}
                      onChange={(e) => {
                        const v = parseFloat(e.target.value);
                        projectStore.update((s) => {
                          const m = s.mixerTracks.find((x) => x.id === t.id);
                          if (m) m.sendA = v;
                        }, false);
                      }}
                    />
                    <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 9.5, color: '#94A3B8' }}>
                      <span>Delay B</span>
                      <span className="mono">{Math.round(t.sendB * 100)}%</span>
                    </div>
                    <input
                      type="range"
                      min={0}
                      max={1}
                      step={0.02}
                      value={t.sendB}
                      onChange={(e) => {
                        const v = parseFloat(e.target.value);
                        projectStore.update((s) => {
                          const m = s.mixerTracks.find((x) => x.id === t.id);
                          if (m) m.sendB = v;
                        }, false);
                      }}
                    />
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>

      {/* Stackable FX Rack Drawer for Selected Track */}
      {selectedTrack && (
        <aside className="mixer-fx-rack">
          <div className="panel-header">
            <span className="panel-title">FX Rack — {selectedTrack.name}</span>
          </div>
          <div style={{ padding: '8px 10px', borderBottom: '1px solid #24324D', display: 'flex', gap: 6 }}>
            <select
              style={{ flex: 1 }}
              value={newFxType}
              onChange={(e) => setNewFxType(e.target.value as FxType)}
            >
              {(Object.keys(FX_LABELS) as FxType[]).map((ft) => (
                <option key={ft} value={ft}>
                  {FX_LABELS[ft]}
                </option>
              ))}
            </select>
            <button
              className="sm"
              onClick={() =>
                projectStore.update((s) => {
                  const m = s.mixerTracks.find((x) => x.id === selectedTrack.id);
                  if (m) m.fx.push(createDefaultFxSlot(newFxType));
                })
              }
            >
              <Plus size={12} /> Insert
            </button>
          </div>

          <div className="panel-scroll">
            {selectedTrack.fx.length === 0 ? (
              <div style={{ color: '#64748B', fontSize: 11.5, padding: 8 }}>
                No FX slots on {selectedTrack.name}. Choose an effect above and click Insert.
              </div>
            ) : (
              selectedTrack.fx.map((slot) => (
                <div key={slot.id} className="fx-card">
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
                    <span style={{ fontWeight: 700, fontSize: 11.5, color: slot.enabled ? '#FFFFFF' : '#64748B' }}>
                      {FX_LABELS[slot.type]}
                    </span>
                    <div style={{ display: 'flex', gap: 4 }}>
                      <button
                        className={slot.enabled ? 'active sm icon-only' : 'sm icon-only'}
                        onClick={() =>
                          projectStore.update((s) => {
                            const m = s.mixerTracks.find((x) => x.id === selectedTrack.id);
                            const f = m?.fx.find((x) => x.id === slot.id);
                            if (f) f.enabled = !f.enabled;
                          })
                        }
                        title="Bypass / Enable"
                      >
                        <Power size={11} />
                      </button>
                      <button
                        className="sm icon-only danger-outline"
                        onClick={() =>
                          projectStore.update((s) => {
                            const m = s.mixerTracks.find((x) => x.id === selectedTrack.id);
                            if (m) m.fx = m.fx.filter((x) => x.id !== slot.id);
                          })
                        }
                        title="Remove FX"
                      >
                        <Trash2 size={11} />
                      </button>
                    </div>
                  </div>

                  {FX_PARAM_META[slot.type].map((meta) => {
                    const val = slot.params[meta.key] ?? meta.min;
                    return (
                      <div key={meta.key} className="param-row">
                        <label>{meta.label}</label>
                        <input
                          type="range"
                          min={meta.min}
                          max={meta.max}
                          step={meta.step}
                          value={val}
                          onChange={(e) => {
                            const nextVal = parseFloat(e.target.value);
                            projectStore.update((s) => {
                              const m = s.mixerTracks.find((x) => x.id === selectedTrack.id);
                              const f = m?.fx.find((x) => x.id === slot.id);
                              if (f) f.params[meta.key] = nextVal;
                            }, false);
                          }}
                        />
                        <span className="val">
                          {val >= 100 ? Math.round(val) : val.toFixed(2)}
                          {meta.unit ? meta.unit : ''}
                        </span>
                      </div>
                    );
                  })}
                </div>
              ))
            )}
          </div>
        </aside>
      )}
    </div>
  );
};
