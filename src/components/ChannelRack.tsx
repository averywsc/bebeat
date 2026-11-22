import React, { useEffect, useState } from 'react';
import { Plus, Volume2, Trash2, Copy, Music } from 'lucide-react';
import type { InstrumentEngine, ProjectState } from '../types/daw';
import { createChannel, createEmptySteps, projectStore, uid } from '../state/projectStore';
import { audioEngine } from '../audio/engine';

interface ChannelRackProps {
  project: ProjectState;
  onOpenPianoRoll: (channelId: string) => void;
  onOpenInstrument: (channelId: string) => void;
}

export const ChannelRack: React.FC<ChannelRackProps> = ({
  project,
  onOpenPianoRoll,
  onOpenInstrument,
}) => {
  const [playheadStep, setPlayheadStep] = useState(-1);
  const [selectedStep, setSelectedStep] = useState<{ channelId: string; index: number } | null>(null);
  const [newEngine, setNewEngine] = useState<InstrumentEngine>('SubSynth');

  const pattern = project.patterns.find((p) => p.id === project.activePatternId) || project.patterns[0];

  useEffect(() => {
    let raf = 0;
    const poll = () => {
      const t = audioEngine.readTelemetry();
      if (t.playing && pattern) {
        const step = Math.floor(t.beatPosition * 4) % pattern.lengthSteps;
        setPlayheadStep(step);
      } else {
        setPlayheadStep(-1);
      }
      raf = requestAnimationFrame(poll);
    };
    raf = requestAnimationFrame(poll);
    return () => cancelAnimationFrame(raf);
  }, [pattern]);

  if (!pattern) return null;

  const insertTracks = project.mixerTracks.filter((m) => m.kind === 'insert');

  const toggleStep = (channelId: string, idx: number) => {
    projectStore.update((s) => {
      const pat = s.patterns.find((p) => p.id === s.activePatternId);
      if (!pat) return;
      if (!pat.steps[channelId]) pat.steps[channelId] = createEmptySteps(pat.lengthSteps);
      const cell = pat.steps[channelId][idx];
      cell.active = !cell.active;
      s.selectedChannelId = channelId;
    });
    setSelectedStep({ channelId, index: idx });
  };

  const setPatternLength = (len: 16 | 32 | 64) => {
    projectStore.update((s) => {
      const pat = s.patterns.find((p) => p.id === s.activePatternId);
      if (!pat) return;
      pat.lengthSteps = len;
      for (const ch of s.channels) {
        const cur = pat.steps[ch.id] || [];
        if (cur.length < len) {
          const pad = createEmptySteps(len).slice(cur.length);
          pat.steps[ch.id] = [...cur, ...pad];
        } else {
          pat.steps[ch.id] = cur.slice(0, len);
        }
      }
    });
  };

  const addPattern = (clone = false) => {
    projectStore.update((s) => {
      const src = s.patterns.find((p) => p.id === s.activePatternId);
      const nextNum = s.patterns.length + 1;
      const np = clone && src
        ? { ...JSON.parse(JSON.stringify(src)), id: uid('pat'), name: `Pattern ${nextNum} (Clone)` }
        : {
            id: uid('pat'),
            name: `Pattern ${nextNum}`,
            lengthSteps: 16 as const,
            steps: Object.fromEntries(s.channels.map((c) => [c.id, createEmptySteps(16)])),
            notes: Object.fromEntries(s.channels.map((c) => [c.id, []])),
          };
      s.patterns.push(np);
      s.activePatternId = np.id;
    });
  };

  const addChannel = () => {
    projectStore.update((s) => {
      const palette = ['#E2E8F0', '#60A5FA', '#38BDF8', '#93C5FD', '#A5B4FC', '#CBD5E1'];
      const ch = createChannel({
        name: `${newEngine} ${s.channels.length + 1}`,
        engine: newEngine,
        mixerTrackId: insertTracks[s.channels.length % insertTracks.length]?.id || 'mx_1',
        color: palette[s.channels.length % palette.length],
      });
      s.channels.push(ch);
      for (const pat of s.patterns) {
        pat.steps[ch.id] = createEmptySteps(pat.lengthSteps);
        pat.notes[ch.id] = [];
      }
      s.selectedChannelId = ch.id;
    });
  };

  const inspectedCell =
    selectedStep && pattern.steps[selectedStep.channelId]?.[selectedStep.index]
      ? pattern.steps[selectedStep.channelId][selectedStep.index]
      : null;

  const inspectedCh = selectedStep ? project.channels.find((c) => c.id === selectedStep.channelId) : null;

  return (
    <div className="rack-container">
      <div className="panel-header">
        <span className="panel-title">Channel Rack</span>
        <select
          value={project.activePatternId}
          onChange={(e) => projectStore.update((s) => { s.activePatternId = e.target.value; }, false)}
          style={{ minWidth: 190 }}
        >
          {project.patterns.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </select>

        <button className="sm" onClick={() => addPattern(false)} title="Create Empty Pattern">
          <Plus size={12} /> Pattern
        </button>
        <button className="sm" onClick={() => addPattern(true)} title="Clone Current Pattern">
          <Copy size={12} /> Clone
        </button>

        <div className="topbar-sep" />
        <span style={{ color: '#94A3B8', fontSize: 11 }}>Steps:</span>
        {([16, 32, 64] as const).map((len) => (
          <button
            key={len}
            className={pattern.lengthSteps === len ? 'active sm mono' : 'sm mono'}
            onClick={() => setPatternLength(len)}
          >
            {len}
          </button>
        ))}

        <div className="spacer" />

        <select
          value={newEngine}
          onChange={(e) => setNewEngine(e.target.value as InstrumentEngine)}
        >
          <option value="SubSynth">SubSynth</option>
          <option value="FMSynth">FMSynth</option>
          <option value="DrumSynth">DrumSynth</option>
          <option value="Sampler">Sampler</option>
          <option value="SoundFont">SoundFont (.sf2)</option>
        </select>
        <button className="sm" onClick={addChannel}>
          <Plus size={12} /> Add Channel
        </button>
      </div>

      <div className="rack-list">
        {project.channels.map((ch) => {
          const steps = pattern.steps[ch.id] || createEmptySteps(pattern.lengthSteps);
          const noteCount = (pattern.notes[ch.id] || []).length;
          const isSelected = project.selectedChannelId === ch.id;

          return (
            <div
              key={ch.id}
              className={`rack-row ${isSelected ? 'selected' : ''}`}
              onClick={() => projectStore.update((s) => { s.selectedChannelId = ch.id; }, false)}
            >
              <div className="rack-ch-meta">
                <div className="rack-color-bar" style={{ background: ch.color }} />
                <button
                  className={ch.mute ? 'sm danger-outline' : 'sm'}
                  style={{ width: 22, padding: '2px 0' }}
                  onClick={(e) => {
                    e.stopPropagation();
                    projectStore.update((s) => {
                      const c = s.channels.find((x) => x.id === ch.id);
                      if (c) c.mute = !c.mute;
                    });
                  }}
                  title="Mute"
                >
                  M
                </button>
                <button
                  className={ch.solo ? 'active sm' : 'sm'}
                  style={{ width: 22, padding: '2px 0' }}
                  onClick={(e) => {
                    e.stopPropagation();
                    projectStore.update((s) => {
                      const c = s.channels.find((x) => x.id === ch.id);
                      if (c) c.solo = !c.solo;
                    });
                  }}
                  title="Solo"
                >
                  S
                </button>

                <button
                  className="sm"
                  style={{ flex: 1, justifyContent: 'space-between', overflow: 'hidden', textOverflow: 'ellipsis' }}
                  onClick={(e) => {
                    e.stopPropagation();
                    projectStore.update((s) => { s.selectedChannelId = ch.id; }, false);
                    void audioEngine.auditionChannelNote(ch.id, ch.engine === 'SubSynth' ? 48 : 60, 0.85, 0.25);
                  }}
                  onDoubleClick={() => onOpenInstrument(ch.id)}
                  title="Click to audition, double-click to edit synth"
                >
                  <span style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>{ch.name}</span>
                  <span className="mono" style={{ fontSize: 9.5, color: '#64748B' }}>
                    {ch.engine.slice(0, 3).toUpperCase()}
                  </span>
                </button>

                <select
                  className="mono"
                  style={{ width: 52, padding: '3px 4px', fontSize: 10.5 }}
                  value={ch.mixerTrackId}
                  onClick={(e) => e.stopPropagation()}
                  onChange={(e) =>
                    projectStore.update((s) => {
                      const c = s.channels.find((x) => x.id === ch.id);
                      if (c) c.mixerTrackId = e.target.value;
                    })
                  }
                  title="Mixer Insert Route"
                >
                  {insertTracks.map((mt) => (
                    <option key={mt.id} value={mt.id}>
                      M{mt.index}
                    </option>
                  ))}
                </select>

                <button
                  className="sm icon-only"
                  onClick={(e) => {
                    e.stopPropagation();
                    onOpenPianoRoll(ch.id);
                  }}
                  title={`Open Piano Roll (${noteCount} notes)`}
                >
                  <Music size={12} />
                </button>
              </div>

              {/* Channel Volume Slider */}
              <div style={{ width: 58, flex: 'none' }} onClick={(e) => e.stopPropagation()}>
                <input
                  type="range"
                  min={0}
                  max={1.3}
                  step={0.02}
                  value={ch.volume}
                  title={`Volume ${Math.round(ch.volume * 100)}%`}
                  onChange={(e) => {
                    const v = parseFloat(e.target.value);
                    projectStore.update((s) => {
                      const c = s.channels.find((x) => x.id === ch.id);
                      if (c) c.volume = v;
                    }, false);
                  }}
                />
              </div>

              {/* Step Grid */}
              <div
                className="rack-steps-grid"
                style={{ gridTemplateColumns: `repeat(${Math.min(32, pattern.lengthSteps)}, minmax(16px, 1fr))` }}
                onClick={(e) => e.stopPropagation()}
              >
                {steps.slice(0, pattern.lengthSteps).map((cell, idx) => {
                  const beatGroup = Math.floor(idx / 4) % 2 === 1;
                  const isPlay = playheadStep === idx;
                  const isSelStep = selectedStep?.channelId === ch.id && selectedStep?.index === idx;
                  return (
                    <button
                      key={idx}
                      className={`step-btn ${beatGroup ? 'beat-alt' : ''} ${cell.active ? 'on' : ''} ${isPlay ? 'playhead' : ''} ${isSelStep ? 'selected-step' : ''}`}
                      onClick={() => toggleStep(ch.id, idx)}
                      onContextMenu={(e) => {
                        e.preventDefault();
                        setSelectedStep({ channelId: ch.id, index: idx });
                      }}
                      title={`Step ${idx + 1} | Vel ${Math.round(cell.velocity * 100)}% | Pitch ${cell.pitchOffset >= 0 ? '+' : ''}${cell.pitchOffset} | Ratchet ${cell.ratchet}x | Prob ${Math.round(cell.probability * 100)}%`}
                    >
                      {cell.active && (
                        <div className="step-vel-bar" style={{ height: `${Math.round((1 - cell.velocity) * 100)}%` }} />
                      )}
                      {cell.active && cell.ratchet > 1 && <span className="step-badge">{cell.ratchet}x</span>}
                    </button>
                  );
                })}
              </div>

              <button
                className="sm icon-only"
                title="Audition Channel"
                onClick={(e) => {
                  e.stopPropagation();
                  void audioEngine.auditionChannelNote(ch.id, 60, 0.85, 0.25);
                }}
              >
                <Volume2 size={12} />
              </button>
              {project.channels.length > 1 && (
                <button
                  className="sm icon-only danger-outline"
                  title="Remove Channel"
                  onClick={(e) => {
                    e.stopPropagation();
                    projectStore.update((s) => {
                      s.channels = s.channels.filter((x) => x.id !== ch.id);
                      if (s.selectedChannelId === ch.id && s.channels[0]) {
                        s.selectedChannelId = s.channels[0].id;
                      }
                    });
                  }}
                >
                  <Trash2 size={11} />
                </button>
              )}
            </div>
          );
        })}
      </div>

      {/* Per-Step Parameter Drawer (Velocity, Pitch, Pan, Ratchet, Probability) */}
      <div className="step-inspector">
        <span className="panel-title" style={{ fontSize: 10.5 }}>
          {inspectedCh && selectedStep
            ? `Step ${selectedStep.index + 1} — ${inspectedCh.name}`
            : 'Per-Step Inspector (Click or Right-Click any Step)'}
        </span>

        {inspectedCell && selectedStep ? (
          <>
            <label style={{ display: 'flex', alignItems: 'center', gap: 6, width: 150 }}>
              <span style={{ color: '#94A3B8', fontSize: 11 }}>Vel</span>
              <input
                type="range"
                min={0.05}
                max={1}
                step={0.01}
                value={inspectedCell.velocity}
                onChange={(e) => {
                  const v = parseFloat(e.target.value);
                  projectStore.update((s) => {
                    const p = s.patterns.find((x) => x.id === s.activePatternId);
                    if (p?.steps[selectedStep.channelId]?.[selectedStep.index]) {
                      p.steps[selectedStep.channelId][selectedStep.index].velocity = v;
                    }
                  }, false);
                }}
              />
              <span className="mono" style={{ width: 32 }}>{Math.round(inspectedCell.velocity * 100)}</span>
            </label>

            <label style={{ display: 'flex', alignItems: 'center', gap: 6, width: 150 }}>
              <span style={{ color: '#94A3B8', fontSize: 11 }}>Pitch</span>
              <input
                type="range"
                min={-24}
                max={24}
                step={1}
                value={inspectedCell.pitchOffset}
                onChange={(e) => {
                  const v = parseInt(e.target.value, 10);
                  projectStore.update((s) => {
                    const p = s.patterns.find((x) => x.id === s.activePatternId);
                    if (p?.steps[selectedStep.channelId]?.[selectedStep.index]) {
                      p.steps[selectedStep.channelId][selectedStep.index].pitchOffset = v;
                    }
                  }, false);
                }}
              />
              <span className="mono" style={{ width: 28 }}>
                {inspectedCell.pitchOffset >= 0 ? `+${inspectedCell.pitchOffset}` : inspectedCell.pitchOffset}
              </span>
            </label>

            <label style={{ display: 'flex', alignItems: 'center', gap: 6, width: 140 }}>
              <span style={{ color: '#94A3B8', fontSize: 11 }}>Pan</span>
              <input
                type="range"
                min={-1}
                max={1}
                step={0.05}
                value={inspectedCell.pan}
                onChange={(e) => {
                  const v = parseFloat(e.target.value);
                  projectStore.update((s) => {
                    const p = s.patterns.find((x) => x.id === s.activePatternId);
                    if (p?.steps[selectedStep.channelId]?.[selectedStep.index]) {
                      p.steps[selectedStep.channelId][selectedStep.index].pan = v;
                    }
                  }, false);
                }}
              />
              <span className="mono" style={{ width: 32 }}>{inspectedCell.pan.toFixed(2)}</span>
            </label>

            <label style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <span style={{ color: '#94A3B8', fontSize: 11 }}>Ratchet</span>
              <select
                className="mono"
                value={inspectedCell.ratchet}
                onChange={(e) => {
                  const v = parseInt(e.target.value, 10) as 1 | 2 | 3 | 4;
                  projectStore.update((s) => {
                    const p = s.patterns.find((x) => x.id === s.activePatternId);
                    if (p?.steps[selectedStep.channelId]?.[selectedStep.index]) {
                      p.steps[selectedStep.channelId][selectedStep.index].ratchet = v;
                    }
                  });
                }}
              >
                <option value={1}>1x</option>
                <option value={2}>2x</option>
                <option value={3}>3x</option>
                <option value={4}>4x</option>
              </select>
            </label>

            <label style={{ display: 'flex', alignItems: 'center', gap: 6, width: 150 }}>
              <span style={{ color: '#94A3B8', fontSize: 11 }}>Prob</span>
              <input
                type="range"
                min={0.05}
                max={1}
                step={0.05}
                value={inspectedCell.probability}
                onChange={(e) => {
                  const v = parseFloat(e.target.value);
                  projectStore.update((s) => {
                    const p = s.patterns.find((x) => x.id === s.activePatternId);
                    if (p?.steps[selectedStep.channelId]?.[selectedStep.index]) {
                      p.steps[selectedStep.channelId][selectedStep.index].probability = v;
                    }
                  }, false);
                }}
              />
              <span className="mono" style={{ width: 36 }}>{Math.round(inspectedCell.probability * 100)}%</span>
            </label>
          </>
        ) : (
          <span style={{ color: '#64748B', fontSize: 11 }}>
            Select any step in the grid above to edit Velocity, Pitch, Pan, Ratchet repeats, and Trigger Probability.
          </span>
        )}
      </div>
    </div>
  );
};
