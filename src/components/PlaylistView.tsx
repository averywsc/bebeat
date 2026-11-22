import React, { useEffect, useRef, useState } from 'react';
import { Magnet, Scissors, Plus, Trash2, VolumeX } from 'lucide-react';
import type { ProjectState } from '../types/daw';
import { projectStore, uid } from '../state/projectStore';
import { audioEngine } from '../audio/engine';

interface PlaylistViewProps {
  project: ProjectState;
}

const TRACK_COUNT = 6;
const TRACK_H = 54;
const PX_PER_BEAT = 42;
const TOTAL_BEATS = 64; // 16 bars

export const PlaylistView: React.FC<PlaylistViewProps> = ({ project }) => {
  const [snapEnabled, setSnapEnabled] = useState(true);
  const [tool, setTool] = useState<'select' | 'razor'>('select');
  const [selectedClipId, setSelectedClipId] = useState<string | null>(null);
  const [snapGuideBeat, setSnapGuideBeat] = useState<number | null>(null);
  const [playBeat, setPlayBeat] = useState(0);
  const [playing, setPlaying] = useState(false);

  const dragRef = useRef<{
    clipId: string;
    mode: 'move' | 'resize';
    startX: number;
    startY: number;
    origBeat: number;
    origTrack: number;
    origDur: number;
  } | null>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement)?.tagName === 'INPUT' || (e.target as HTMLElement)?.tagName === 'TEXTAREA') return;
      if (e.key === 'n' || e.key === 'N') setSnapEnabled((v) => !v);
      else if (e.key === 'b' || e.key === 'B') setTool((t) => (t === 'razor' ? 'select' : 'razor'));
      else if ((e.key === 'Delete' || e.key === 'Backspace') && selectedClipId) {
        projectStore.update((s) => {
          s.playlistClips = s.playlistClips.filter((c) => c.id !== selectedClipId);
        });
        setSelectedClipId(null);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [selectedClipId]);

  useEffect(() => {
    let raf = 0;
    const poll = () => {
      const t = audioEngine.readTelemetry();
      setPlaying(t.playing);
      setPlayBeat(t.beatPosition);
      raf = requestAnimationFrame(poll);
    };
    raf = requestAnimationFrame(poll);
    return () => cancelAnimationFrame(raf);
  }, []);

  // Magnetic snap to grid beats, playhead, loop markers, or neighbor clip edges
  const applyMagneticSnap = (rawBeat: number, ignoreClipId?: string): { beat: number; snapped: boolean } => {
    if (!snapEnabled) return { beat: Math.max(0, rawBeat), snapped: false };
    const candidates: number[] = [
      Math.round(rawBeat), // whole beat
      Math.round(rawBeat / 4) * 4, // bar
      project.loopStartBeat,
      project.loopEndBeat,
    ];
    for (const c of project.playlistClips) {
      if (c.id === ignoreClipId) continue;
      candidates.push(c.startBeat, c.startBeat + c.durationBeats);
    }
    let best = rawBeat;
    let bestDist = 0.28; // magnetic threshold in beats
    let snapped = false;
    for (const cand of candidates) {
      const d = Math.abs(rawBeat - cand);
      if (d < bestDist) {
        bestDist = d;
        best = cand;
        snapped = true;
      }
    }
    return { beat: Math.max(0, best), snapped };
  };

  const handleMouseMove = (e: React.MouseEvent) => {
    const drag = dragRef.current;
    if (!drag) return;
    const dx = e.clientX - drag.startX;
    const dy = e.clientY - drag.startY;
    const deltaBeats = dx / PX_PER_BEAT;

    if (drag.mode === 'move') {
      const { beat, snapped } = applyMagneticSnap(drag.origBeat + deltaBeats, drag.clipId);
      setSnapGuideBeat(snapped ? beat : null);
      const nextTrack = Math.max(0, Math.min(TRACK_COUNT - 1, drag.origTrack + Math.round(dy / TRACK_H)));
      projectStore.update((s) => {
        const clip = s.playlistClips.find((c) => c.id === drag.clipId);
        if (clip) {
          clip.startBeat = beat;
          clip.trackIndex = nextTrack;
        }
      }, false);
    } else {
      const endRes = applyMagneticSnap(drag.origBeat + drag.origDur + deltaBeats, drag.clipId);
      setSnapGuideBeat(endRes.snapped ? endRes.beat : null);
      projectStore.update((s) => {
        const clip = s.playlistClips.find((c) => c.id === drag.clipId);
        if (clip) {
          clip.durationBeats = Math.max(1, endRes.beat - clip.startBeat);
        }
      }, false);
    }
  };

  const handleMouseUp = () => {
    dragRef.current = null;
    setSnapGuideBeat(null);
  };

  const handleTrackDoubleClick = (trackIndex: number, e: React.MouseEvent<HTMLDivElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const rawBeat = (e.clientX - rect.left) / PX_PER_BEAT;
    const { beat } = applyMagneticSnap(rawBeat);
    const pat = project.patterns.find((p) => p.id === project.activePatternId) || project.patterns[0];
    if (!pat) return;
    projectStore.update((s) => {
      s.playlistClips.push({
        id: uid('clip'),
        trackIndex,
        kind: 'pattern',
        patternId: pat.id,
        label: pat.name,
        startBeat: beat,
        durationBeats: pat.lengthSteps / 4,
        offsetBeats: 0,
        muted: false,
      });
    });
  };

  const splitClipAt = (clipId: string, splitBeat: number) => {
    projectStore.update((s) => {
      const idx = s.playlistClips.findIndex((c) => c.id === clipId);
      if (idx < 0) return;
      const c = s.playlistClips[idx];
      if (splitBeat <= c.startBeat + 0.25 || splitBeat >= c.startBeat + c.durationBeats - 0.25) return;
      const leftDur = splitBeat - c.startBeat;
      const rightDur = c.durationBeats - leftDur;
      c.durationBeats = leftDur;
      s.playlistClips.splice(idx + 1, 0, {
        ...c,
        id: uid('clip'),
        startBeat: splitBeat,
        durationBeats: rightDur,
        offsetBeats: c.offsetBeats + leftDur,
      });
    });
  };

  const autoLane = project.automationLanes[0];

  return (
    <div className="playlist-wrap" onMouseMove={handleMouseMove} onMouseUp={handleMouseUp}>
      <div className="panel-header">
        <span className="panel-title">Playlist / Arrangement</span>
        <button
          className={snapEnabled ? 'active sm' : 'sm'}
          onClick={() => setSnapEnabled((v) => !v)}
          title="Toggle Magnetic Clip Snapping (N)"
        >
          <Magnet size={12} /> Snap (N)
        </button>
        <button
          className={tool === 'razor' ? 'active sm' : 'sm'}
          onClick={() => setTool((t) => (t === 'razor' ? 'select' : 'razor'))}
          title="Razor Split Tool (B)"
        >
          <Scissors size={12} /> Razor (B)
        </button>

        <div className="topbar-sep" />
        <span style={{ color: '#94A3B8', fontSize: 11 }}>Loop Bars:</span>
        <input
          type="number"
          min={0}
          max={15}
          style={{ width: 46 }}
          value={Math.floor(project.loopStartBeat / 4)}
          onChange={(e) => {
            const b = Math.max(0, parseInt(e.target.value, 10) || 0) * 4;
            projectStore.update((s) => {
              s.loopStartBeat = b;
              if (s.loopEndBeat <= b) s.loopEndBeat = b + 4;
            });
          }}
        />
        <span className="mono" style={{ color: '#64748B' }}>to</span>
        <input
          type="number"
          min={1}
          max={16}
          style={{ width: 46 }}
          value={Math.ceil(project.loopEndBeat / 4)}
          onChange={(e) => {
            const b = Math.max(1, parseInt(e.target.value, 10) || 4) * 4;
            projectStore.update((s) => {
              s.loopEndBeat = Math.max(s.loopStartBeat + 4, b);
            });
          }}
        />

        <div className="spacer" />
        <button
          className="sm"
          onClick={() => {
            const pat = project.patterns.find((p) => p.id === project.activePatternId) || project.patterns[0];
            if (!pat) return;
            const endMax = project.playlistClips.reduce((m, c) => Math.max(m, c.startBeat + c.durationBeats), 0);
            projectStore.update((s) => {
              s.playlistClips.push({
                id: uid('clip'),
                trackIndex: 0,
                kind: 'pattern',
                patternId: pat.id,
                label: pat.name,
                startBeat: endMax,
                durationBeats: pat.lengthSteps / 4,
                offsetBeats: 0,
                muted: false,
              });
            });
          }}
        >
          <Plus size={12} /> Place Pattern
        </button>
        {selectedClipId && (
          <>
            <button
              className="sm"
              onClick={() =>
                projectStore.update((s) => {
                  const c = s.playlistClips.find((x) => x.id === selectedClipId);
                  if (c) c.muted = !c.muted;
                })
              }
            >
              <VolumeX size={12} /> Mute Clip
            </button>
            <button
              className="sm danger-outline"
              onClick={() => {
                projectStore.update((s) => {
                  s.playlistClips = s.playlistClips.filter((x) => x.id !== selectedClipId);
                });
                setSelectedClipId(null);
              }}
            >
              <Trash2 size={12} /> Delete
            </button>
          </>
        )}
      </div>

      {/* Timeline Grid */}
      <div className="playlist-grid">
        <div style={{ display: 'flex', minWidth: 160 + TOTAL_BEATS * PX_PER_BEAT }}>
          {/* Track Headers */}
          <div style={{ width: 160, flex: 'none', background: '#0E1528', borderRight: '1px solid #24324D' }}>
            <div
              className="mono"
              style={{
                height: 28,
                borderBottom: '1px solid #24324D',
                padding: '6px 10px',
                fontSize: 10,
                color: '#94A3B8',
              }}
            >
              BARS / LOOP
            </div>
            {Array.from({ length: TRACK_COUNT }, (_, ti) => (
              <div
                key={ti}
                style={{
                  height: TRACK_H,
                  borderBottom: '1px solid #1C2740',
                  padding: '8px 10px',
                  display: 'flex',
                  flexDirection: 'column',
                  justifyContent: 'center',
                }}
              >
                <div style={{ fontWeight: 600, color: '#F8FAFC', fontSize: 11.5 }}>Track {ti + 1}</div>
                <div style={{ fontSize: 10, color: '#64748B' }}>
                  {ti === 0 ? 'Main Patterns' : ti === 1 ? 'Baked Patterns' : ti === 2 ? 'Audio / Stems' : 'Arrangement'}
                </div>
              </div>
            ))}
            {autoLane && (
              <div
                style={{
                  height: 82,
                  borderBottom: '1px solid #24324D',
                  padding: '8px 10px',
                  background: '#0B1020',
                }}
              >
                <div style={{ fontWeight: 600, fontSize: 11, color: '#60A5FA' }}>Automation</div>
                <div style={{ fontSize: 10, color: '#94A3B8' }}>{autoLane.name}</div>
                <div className="mono" style={{ fontSize: 9.5, color: '#64748B', marginTop: 2 }}>
                  {autoLane.min} - {autoLane.max} Hz
                </div>
              </div>
            )}
          </div>

          {/* Clips & Ruler Canvas */}
          <div style={{ position: 'relative', width: TOTAL_BEATS * PX_PER_BEAT }}>
            {/* Ruler + Loop Marker Bar */}
            <div
              onMouseDown={(e) => {
                const rect = e.currentTarget.getBoundingClientRect();
                const beat = Math.max(0, (e.clientX - rect.left) / PX_PER_BEAT);
                audioEngine.seekBeat(beat);
              }}
              style={{
                height: 28,
                background: '#0B1020',
                borderBottom: '1px solid #24324D',
                position: 'relative',
                cursor: 'pointer',
              }}
            >
              {/* Loop highlight */}
              <div
                style={{
                  position: 'absolute',
                  top: 0,
                  height: 4,
                  left: project.loopStartBeat * PX_PER_BEAT,
                  width: (project.loopEndBeat - project.loopStartBeat) * PX_PER_BEAT,
                  background: '#FFFFFF',
                }}
              />
              {Array.from({ length: TOTAL_BEATS / 4 }, (_, bar) => (
                <div
                  key={bar}
                  className="mono"
                  style={{
                    position: 'absolute',
                    left: bar * 4 * PX_PER_BEAT + 4,
                    top: 8,
                    fontSize: 10,
                    color: '#94A3B8',
                  }}
                >
                  {bar + 1}
                </div>
              ))}
            </div>

            {/* Track Lanes */}
            {Array.from({ length: TRACK_COUNT }, (_, ti) => (
              <div
                key={ti}
                onDoubleClick={(e) => handleTrackDoubleClick(ti, e)}
                style={{
                  height: TRACK_H,
                  borderBottom: '1px solid #152038',
                  position: 'relative',
                  background: ti % 2 === 0 ? '#080C18' : '#0A0F1E',
                }}
                title="Double-click to place active Pattern"
              >
                {/* Beat Grid Lines */}
                {Array.from({ length: TOTAL_BEATS }, (_, b) => (
                  <div
                    key={b}
                    style={{
                      position: 'absolute',
                      top: 0,
                      bottom: 0,
                      left: b * PX_PER_BEAT,
                      width: 1,
                      background: b % 4 === 0 ? '#24324D' : '#111A2E',
                      pointerEvents: 'none',
                    }}
                  />
                ))}

                {/* Clips in this track */}
                {project.playlistClips
                  .filter((c) => c.trackIndex === ti)
                  .map((clip) => {
                    const isSel = selectedClipId === clip.id;
                    const isAudio = clip.kind === 'audio';
                    return (
                      <div
                        key={clip.id}
                        onMouseDown={(e) => {
                          e.stopPropagation();
                          if (tool === 'razor') {
                            const rect = e.currentTarget.parentElement!.getBoundingClientRect();
                            const rawB = (e.clientX - rect.left) / PX_PER_BEAT;
                            const { beat } = applyMagneticSnap(rawB, clip.id);
                            splitClipAt(clip.id, beat);
                            return;
                          }
                          setSelectedClipId(clip.id);
                          const rect = e.currentTarget.getBoundingClientRect();
                          const nearRight = e.clientX > rect.right - 9;
                          dragRef.current = {
                            clipId: clip.id,
                            mode: nearRight ? 'resize' : 'move',
                            startX: e.clientX,
                            startY: e.clientY,
                            origBeat: clip.startBeat,
                            origTrack: clip.trackIndex,
                            origDur: clip.durationBeats,
                          };
                        }}
                        style={{
                          position: 'absolute',
                          top: 4,
                          bottom: 4,
                          left: clip.startBeat * PX_PER_BEAT,
                          width: Math.max(24, clip.durationBeats * PX_PER_BEAT - 2),
                          background: isAudio ? '#10213B' : '#11192E',
                          border: isSel ? '1px solid #FFFFFF' : '1px solid #2E3F61',
                          borderRadius: 3,
                          padding: '4px 7px',
                          cursor: tool === 'razor' ? 'col-resize' : 'grab',
                          opacity: clip.muted ? 0.42 : 1,
                          overflow: 'hidden',
                          display: 'flex',
                          flexDirection: 'column',
                          justifyContent: 'space-between',
                        }}
                      >
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                          <span style={{ fontSize: 11, fontWeight: 600, color: '#FFFFFF', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                            {clip.label}
                          </span>
                          <span className="mono" style={{ fontSize: 9, color: '#94A3B8' }}>
                            {clip.durationBeats}b
                          </span>
                        </div>
                        {/* Mini waveform / pattern preview strip */}
                        <div style={{ display: 'flex', alignItems: 'flex-end', gap: 2, height: 16 }}>
                          {Array.from({ length: Math.min(28, Math.max(6, Math.floor(clip.durationBeats * 3))) }, (_, k) => {
                            const amp = isAudio
                              ? 25 + Math.abs(Math.sin(k * 1.45)) * 75
                              : k % 4 === 0
                              ? 90
                              : k % 2 === 0
                              ? 52
                              : 24;
                            return (
                              <div
                                key={k}
                                style={{
                                  flex: 1,
                                  height: `${amp}%`,
                                  background: isAudio ? '#60A5FA' : 'rgba(255,255,255,0.45)',
                                  borderRadius: 1,
                                }}
                              />
                            );
                          })}
                        </div>
                      </div>
                    );
                  })}
              </div>
            ))}

            {/* Automation Lane */}
            {autoLane && (
              <div
                onClick={(e) => {
                  const rect = e.currentTarget.getBoundingClientRect();
                  const beat = Math.round(((e.clientX - rect.left) / PX_PER_BEAT) * 2) / 2;
                  const val = 1 - Math.max(0, Math.min(1, (e.clientY - rect.top) / rect.height));
                  projectStore.update((s) => {
                    const lane = s.automationLanes[0];
                    if (!lane) return;
                    const existing = lane.points.find((p) => Math.abs(p.beat - beat) < 0.35);
                    if (existing) existing.value = val;
                    else {
                      lane.points.push({ beat, value: val });
                      lane.points.sort((a, b) => a.beat - b.beat);
                    }
                  });
                }}
                style={{
                  height: 82,
                  background: '#080C18',
                  borderBottom: '1px solid #24324D',
                  position: 'relative',
                  cursor: 'crosshair',
                }}
                title="Click anywhere to add or move automation breakpoints"
              >
                <svg width={TOTAL_BEATS * PX_PER_BEAT} height={82} style={{ display: 'block' }}>
                  <polyline
                    fill="none"
                    stroke="#60A5FA"
                    strokeWidth={1.8}
                    points={autoLane.points
                      .map((p) => `${p.beat * PX_PER_BEAT},${(1 - p.value) * 72 + 5}`)
                      .join(' ')}
                  />
                  {autoLane.points.map((p, i) => (
                    <circle
                      key={i}
                      cx={p.beat * PX_PER_BEAT}
                      cy={(1 - p.value) * 72 + 5}
                      r={4}
                      fill="#FFFFFF"
                      stroke="#080C18"
                      strokeWidth={1.5}
                    />
                  ))}
                </svg>
              </div>
            )}

            {/* Magnetic Visual Snap Guide */}
            {snapGuideBeat !== null && (
              <div
                style={{
                  position: 'absolute',
                  top: 0,
                  bottom: 0,
                  left: snapGuideBeat * PX_PER_BEAT,
                  width: 1.5,
                  background: '#60A5FA',
                  pointerEvents: 'none',
                  zIndex: 10,
                }}
              />
            )}

            {/* Playhead */}
            {playing && (
              <div
                style={{
                  position: 'absolute',
                  top: 0,
                  bottom: 0,
                  left: (playBeat % TOTAL_BEATS) * PX_PER_BEAT,
                  width: 1.5,
                  background: '#FFFFFF',
                  pointerEvents: 'none',
                  zIndex: 11,
                }}
              />
            )}
          </div>
        </div>
      </div>
    </div>
  );
};
