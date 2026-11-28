import React, { useEffect, useRef, useState } from 'react';
import { Magnet, Scissors, Plus, Trash2, VolumeX, Copy, Sparkles, Upload, Lock, Unlock, ZoomIn, ZoomOut } from 'lucide-react';
import type { ProjectState } from '../types/daw';
import { projectStore, uid } from '../state/projectStore';
import { audioEngine } from '../audio/engine';

interface PlaylistViewProps {
  project: ProjectState;
}

const TRACK_COUNT = 6;
const TRACK_H = 54;
const TOTAL_BEATS = 64; // 16 bars

function computeClipPeaks(audioBufferId: string | undefined, barCount: number): number[] | null {
  if (!audioBufferId) return null;
  const buf = audioEngine.getKitBuffer(audioBufferId);
  if (!buf || buf.length === 0) return null;
  const data = buf.getChannelData(0);
  const blockSize = Math.max(1, Math.floor(data.length / barCount));
  const peaks: number[] = [];
  let maxPeak = 0.001;
  for (let i = 0; i < barCount; i++) {
    const start = i * blockSize;
    const end = Math.min(data.length, start + blockSize);
    const step = Math.max(1, Math.floor((end - start) / 64));
    let p = 0;
    for (let j = start; j < end; j += step) {
      const a = Math.abs(data[j]);
      if (a > p) p = a;
    }
    peaks.push(p);
    if (p > maxPeak) maxPeak = p;
  }
  return peaks.map((p) => Math.max(12, Math.round((p / maxPeak) * 100)));
}

export const PlaylistView: React.FC<PlaylistViewProps> = ({ project }) => {
  const [snapEnabled, setSnapEnabled] = useState(true);
  const [tool, setTool] = useState<'select' | 'razor'>('select');
  const [pxPerBeat, setPxPerBeat] = useState(42);
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
      const allowLetter = !project.typingKeyboardEnabled || e.altKey;
      if ((e.key === 'n' || e.key === 'N') && allowLetter) setSnapEnabled((v) => !v);
      else if ((e.key === 'b' || e.key === 'B') && allowLetter) setTool((t) => (t === 'razor' ? 'select' : 'razor'));
      else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'd' && selectedClipId) {
        e.preventDefault();
        projectStore.update((s) => {
          const orig = s.playlistClips.find((c) => c.id === selectedClipId);
          if (!orig) return;
          const dup = { ...orig, id: uid('clip'), startBeat: orig.startBeat + orig.durationBeats };
          s.playlistClips.push(dup);
        });
      } else if ((e.key === 'Delete' || e.key === 'Backspace') && selectedClipId) {
        projectStore.update((s) => {
          s.playlistClips = s.playlistClips.filter((c) => c.id !== selectedClipId);
        });
        setSelectedClipId(null);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [selectedClipId, project.typingKeyboardEnabled]);

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
    const deltaBeats = dx / pxPerBeat;

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
    const trackMeta = project.playlistTracks?.[trackIndex];
    if (trackMeta?.locked) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const rawBeat = (e.clientX - rect.left) / pxPerBeat;
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

  const addAutomationLane = (channelId: string) => {
    const ch = project.channels.find((c) => c.id === channelId);
    if (!ch) return;
    projectStore.update((s) => {
      s.automationLanes.push({
        id: uid('auto'),
        name: `${ch.name} Cutoff`,
        targetType: 'channel',
        targetId: ch.id,
        param: 'cutoff',
        min: 180,
        max: 12000,
        points: [
          { beat: 0, value: 0.35 },
          { beat: 16, value: 0.85 },
          { beat: 32, value: 0.5 },
        ],
      });
    });
  };

  const tempoPoints = project.tempoTrackPoints || [
    { beat: 0, bpm: project.bpm },
    { beat: 32, bpm: project.bpm },
  ];

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
        <select
          value=""
          onChange={(e) => {
            if (e.target.value) addAutomationLane(e.target.value);
          }}
          title="Add a Cutoff Automation Lane for any instrument channel"
          style={{ maxWidth: 138 }}
        >
          <option value="">+ Auto Lane...</option>
          {project.channels.map((c) => (
            <option key={c.id} value={c.id}>{c.name} Cutoff</option>
          ))}
        </select>

        <button className="sm icon-only" onClick={() => setPxPerBeat((z) => Math.max(24, z - 8))} title="Zoom Out Timeline">
          <ZoomOut size={12} />
        </button>
        <button className="sm icon-only" onClick={() => setPxPerBeat((z) => Math.min(96, z + 8))} title="Zoom In Timeline">
          <ZoomIn size={12} />
        </button>

        <button
          className="sm"
          onClick={() => {
            const p1 = project.patterns[0];
            const p2 = project.patterns[1] || p1;
            if (!p1) return;
            projectStore.update((s) => {
              s.playlistClips = [
                { id: uid('clip'), trackIndex: 0, kind: 'pattern', patternId: p1.id, label: p1.name, startBeat: 0, durationBeats: 4, offsetBeats: 0, muted: false },
                { id: uid('clip'), trackIndex: 0, kind: 'pattern', patternId: p1.id, label: p1.name, startBeat: 4, durationBeats: 4, offsetBeats: 0, muted: false },
                { id: uid('clip'), trackIndex: 0, kind: 'pattern', patternId: p2.id, label: p2.name, startBeat: 8, durationBeats: 4, offsetBeats: 0, muted: false },
                { id: uid('clip'), trackIndex: 0, kind: 'pattern', patternId: p1.id, label: p1.name, startBeat: 12, durationBeats: 4, offsetBeats: 0, muted: false },
                { id: uid('clip'), trackIndex: 0, kind: 'pattern', patternId: p1.id, label: p1.name, startBeat: 16, durationBeats: 4, offsetBeats: 0, muted: false },
                { id: uid('clip'), trackIndex: 0, kind: 'pattern', patternId: p2.id, label: p2.name, startBeat: 20, durationBeats: 4, offsetBeats: 0, muted: false },
                { id: uid('clip'), trackIndex: 0, kind: 'pattern', patternId: p1.id, label: p1.name, startBeat: 24, durationBeats: 4, offsetBeats: 0, muted: false },
                { id: uid('clip'), trackIndex: 0, kind: 'pattern', patternId: p2.id, label: p2.name, startBeat: 28, durationBeats: 4, offsetBeats: 0, muted: false },
              ];
              s.loopStartBeat = 0;
              s.loopEndBeat = 32;
            });
          }}
          title="Auto-build an 8-bar arrangement from your patterns"
        >
          <Sparkles size={12} /> Auto-Arrange 8 Bars
        </button>

        <button
          className="sm"
          onClick={async () => {
            const importAudio = async (name: string, bytes: Uint8Array) => {
              const key = await audioEngine.loadCustomSample(name, bytes);
              const buf = audioEngine.getKitBuffer(key);
              const beats = buf ? Math.max(1, Math.round((buf.duration * project.bpm) / 60)) : 4;
              projectStore.update((s) => {
                s.playlistClips.push({
                  id: uid('clip'),
                  trackIndex: 2,
                  kind: 'audio',
                  audioBufferId: key,
                  label: name,
                  startBeat: 0,
                  durationBeats: beats,
                  offsetBeats: 0,
                  muted: false,
                });
              });
            };
            if (window.bebeat?.pickAudioOrSf2) {
              const picked = await window.bebeat.pickAudioOrSf2();
              if (picked) await importAudio(picked.name, picked.bytes);
              return;
            }
            const inp = document.createElement('input');
            inp.type = 'file';
            inp.accept = '.wav,.flac,.mp3,.ogg';
            inp.onchange = async () => {
              const f = inp.files?.[0];
              if (f) await importAudio(f.name, new Uint8Array(await f.arrayBuffer()));
            };
            inp.click();
          }}
          title="Import .wav / .flac / .mp3 Audio Clip onto Playlist"
        >
          <Upload size={12} /> Audio Clip
        </button>

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
                  const orig = s.playlistClips.find((c) => c.id === selectedClipId);
                  if (!orig) return;
                  s.playlistClips.push({ ...orig, id: uid('clip'), startBeat: orig.startBeat + orig.durationBeats });
                })
              }
              title="Duplicate Selected Clip (Ctrl+D)"
            >
              <Copy size={12} /> Duplicate
            </button>
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
        <div style={{ display: 'flex', minWidth: 160 + TOTAL_BEATS * pxPerBeat }}>
          {/* Track Headers */}
          <div style={{ width: 160, flex: 'none', background: 'var(--panel)', borderRight: '1px solid var(--border)' }}>
            <div
              className="mono"
              style={{
                height: 28,
                borderBottom: '1px solid var(--border)',
                padding: '6px 10px',
                fontSize: 10,
                color: '#94A3B8',
              }}
            >
              BARS / LOOP
            </div>
            {Array.from({ length: TRACK_COUNT }, (_, ti) => {
              const meta = project.playlistTracks?.[ti] || {
                index: ti,
                name: `Track ${ti + 1}`,
                kind: ti === 0 ? 'drummer' : ti === 2 ? 'audio' : ti === 5 ? 'master' : 'software',
                locked: false,
                muted: false,
                solo: false,
              };
              return (
                <div
                  key={ti}
                  style={{
                    height: TRACK_H,
                    borderBottom: '1px solid var(--border)',
                    padding: '6px 8px',
                    display: 'flex',
                    flexDirection: 'column',
                    justifyContent: 'space-between',
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 4 }}>
                    <span style={{ fontWeight: 600, color: '#F8FAFC', fontSize: 11, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {meta.name}
                    </span>
                    <button
                      className={meta.locked ? 'active sm icon-only' : 'sm icon-only'}
                      style={{ padding: '1px 4px' }}
                      onClick={() =>
                        projectStore.update((s) => {
                          const t = s.playlistTracks?.find((x) => x.index === ti);
                          if (t) t.locked = !t.locked;
                        })
                      }
                      title={meta.locked ? 'Unlock Track' : 'Lock Track'}
                    >
                      {meta.locked ? <Lock size={10} /> : <Unlock size={10} />}
                    </button>
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', fontSize: 9.5, color: '#64748B' }}>
                    <span style={{ textTransform: 'uppercase' }}>{meta.kind}</span>
                    {meta.locked && <span style={{ color: '#FBBF24' }}>LOCKED</span>}
                  </div>
                </div>
              );
            })}
            {project.automationLanes.map((lane) => (
              <div
                key={lane.id}
                style={{
                  height: 76,
                  borderBottom: '1px solid var(--border)',
                  padding: '8px 10px',
                  background: 'var(--bg-alt)',
                  display: 'flex',
                  flexDirection: 'column',
                  justifyContent: 'space-between',
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                  <span style={{ fontWeight: 600, fontSize: 11, color: '#2f7cf6' }}>Automation</span>
                  {project.automationLanes.length > 1 && (
                    <button
                      className="sm icon-only danger-outline"
                      style={{ padding: '1px 4px' }}
                      onClick={() =>
                        projectStore.update((s) => {
                          s.automationLanes = s.automationLanes.filter((x) => x.id !== lane.id);
                        })
                      }
                      title="Remove Automation Lane"
                    >
                      <Trash2 size={10} />
                    </button>
                  )}
                </div>
                <div style={{ fontSize: 10, color: '#bdbdc6', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {lane.name}
                </div>
                <div className="mono" style={{ fontSize: 9.5, color: '#82828e' }}>
                  {lane.min} - {lane.max} Hz
                </div>
              </div>
            ))}
            {/* Tempo Track Header */}
            <div
              style={{
                height: 68,
                borderBottom: '1px solid var(--border)',
                padding: '8px 10px',
                background: 'var(--bg-alt)',
                display: 'flex',
                flexDirection: 'column',
                justifyContent: 'space-between',
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                <span style={{ fontWeight: 600, fontSize: 11, color: '#FBBF24' }}>Tempo Track</span>
                <button
                  className="sm"
                  style={{ fontSize: 9, padding: '1px 5px' }}
                  onClick={() =>
                    projectStore.update((s) => {
                      s.tempoTrackPoints = [
                        { beat: 0, bpm: s.bpm },
                        { beat: 32, bpm: s.bpm },
                      ];
                    })
                  }
                  title="Flatten Tempo Track to current BPM"
                >
                  Flat
                </button>
              </div>
              <div className="mono" style={{ fontSize: 9.5, color: '#82828e' }}>
                60 - 200 BPM (Song)
              </div>
            </div>
          </div>

          {/* Clips & Ruler Canvas */}
          <div style={{ position: 'relative', width: TOTAL_BEATS * pxPerBeat }}>
            {/* Ruler + Loop Marker Bar */}
            <div
              onMouseDown={(e) => {
                const rect = e.currentTarget.getBoundingClientRect();
                const beat = Math.max(0, (e.clientX - rect.left) / pxPerBeat);
                audioEngine.seekBeat(beat);
              }}
              style={{
                height: 28,
                background: 'var(--bg-alt)',
                borderBottom: '1px solid var(--border)',
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
                  left: project.loopStartBeat * pxPerBeat,
                  width: (project.loopEndBeat - project.loopStartBeat) * pxPerBeat,
                  background: '#FFFFFF',
                }}
              />
              {Array.from({ length: TOTAL_BEATS / 4 }, (_, bar) => (
                <div
                  key={bar}
                  className="mono"
                  style={{
                    position: 'absolute',
                    left: bar * 4 * pxPerBeat + 4,
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
                  borderBottom: '1px solid var(--border)',
                  position: 'relative',
                  background: ti % 2 === 0 ? 'var(--bg)' : 'var(--bg-alt)',
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
                      left: b * pxPerBeat,
                      width: 1,
                      background: b % 4 === 0 ? 'var(--border-strong)' : 'var(--border)',
                      opacity: b % 4 === 0 ? 0.7 : 0.35,
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
                    const barCount = Math.min(36, Math.max(8, Math.floor(clip.durationBeats * 3)));
                    const realPeaks = isAudio ? computeClipPeaks(clip.audioBufferId, barCount) : null;
                    return (
                      <div
                        key={clip.id}
                        onMouseDown={(e) => {
                          e.stopPropagation();
                          const trackMeta = project.playlistTracks?.[ti];
                          if (trackMeta?.locked) return;
                          const effTool = tool === 'razor' ? 'slice' : project.activeTool;

                          if (effTool === 'delete') {
                            projectStore.update((s) => {
                              s.playlistClips = s.playlistClips.filter((c) => c.id !== clip.id);
                            });
                            return;
                          }
                          if (effTool === 'mute') {
                            projectStore.update((s) => {
                              const c = s.playlistClips.find((x) => x.id === clip.id);
                              if (c) c.muted = !c.muted;
                            });
                            return;
                          }
                          if (effTool === 'playback') {
                            const rect = e.currentTarget.parentElement!.getBoundingClientRect();
                            audioEngine.seekBeat(Math.max(0, (e.clientX - rect.left) / pxPerBeat));
                            return;
                          }
                          if (effTool === 'slice') {
                            const rect = e.currentTarget.parentElement!.getBoundingClientRect();
                            const rawB = (e.clientX - rect.left) / pxPerBeat;
                            const { beat } = applyMagneticSnap(rawB, clip.id);
                            splitClipAt(clip.id, beat);
                            return;
                          }
                          if (effTool === 'slip') {
                            projectStore.update((s) => {
                              const c = s.playlistClips.find((x) => x.id === clip.id);
                              if (c) c.offsetBeats = (c.offsetBeats + 0.5) % Math.max(1, c.durationBeats);
                            });
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
                          left: clip.startBeat * pxPerBeat,
                          width: Math.max(24, clip.durationBeats * pxPerBeat - 2),
                          background: isAudio ? 'rgba(47, 124, 246, 0.16)' : 'var(--panel-elev)',
                          border: isSel ? '1px solid #2f7cf6' : '1px solid var(--border-strong)',
                          borderRadius: 4,
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
                        {/* Real decoded peak waveform (Audio) or pattern rhythm preview */}
                        <div style={{ display: 'flex', alignItems: 'flex-end', gap: 1.5, height: 18 }}>
                          {Array.from({ length: barCount }, (_, k) => {
                            const amp = realPeaks
                              ? realPeaks[k]
                              : isAudio
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
                                  background: isAudio ? '#2f7cf6' : 'rgba(236,236,239,0.45)',
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

            {/* Automation Lanes */}
            {project.automationLanes.map((lane) => (
              <div
                key={lane.id}
                onClick={(e) => {
                  const rect = e.currentTarget.getBoundingClientRect();
                  const beat = Math.round(((e.clientX - rect.left) / pxPerBeat) * 2) / 2;
                  const val = 1 - Math.max(0, Math.min(1, (e.clientY - rect.top) / rect.height));
                  projectStore.update((s) => {
                    const target = s.automationLanes.find((l) => l.id === lane.id);
                    if (!target) return;
                    const existing = target.points.find((p) => Math.abs(p.beat - beat) < 0.35);
                    if (existing) existing.value = val;
                    else {
                      target.points.push({ beat, value: val });
                      target.points.sort((a, b) => a.beat - b.beat);
                    }
                  });
                }}
                style={{
                  height: 76,
                  background: 'var(--bg)',
                  borderBottom: '1px solid var(--border)',
                  position: 'relative',
                  cursor: 'crosshair',
                }}
                title={`Click to add or move ${lane.name} automation breakpoints`}
              >
                <svg width={TOTAL_BEATS * pxPerBeat} height={76} style={{ display: 'block' }}>
                  <polyline
                    fill="none"
                    stroke="#2f7cf6"
                    strokeWidth={1.8}
                    points={lane.points
                      .map((p) => `${p.beat * pxPerBeat},${(1 - p.value) * 66 + 5}`)
                      .join(' ')}
                  />
                  {lane.points.map((p, i) => (
                    <circle
                      key={i}
                      cx={p.beat * pxPerBeat}
                      cy={(1 - p.value) * 66 + 5}
                      r={4}
                      fill="#ececef"
                      stroke="#141416"
                      strokeWidth={1.5}
                    />
                  ))}
                </svg>
              </div>
            ))}

            {/* Interactive Tempo Track Lane (60..200 BPM) */}
            <div
              onClick={(e) => {
                const rect = e.currentTarget.getBoundingClientRect();
                const beat = Math.round(((e.clientX - rect.left) / pxPerBeat) * 2) / 2;
                const norm = 1 - Math.max(0, Math.min(1, (e.clientY - rect.top) / rect.height));
                const bpm = Math.round(60 + norm * 140);
                projectStore.update((s) => {
                  if (!s.tempoTrackPoints || s.tempoTrackPoints.length === 0) {
                    s.tempoTrackPoints = [{ beat: 0, bpm: s.bpm }];
                  }
                  const existing = s.tempoTrackPoints.find((p) => Math.abs(p.beat - beat) < 0.5);
                  if (existing) existing.bpm = bpm;
                  else {
                    s.tempoTrackPoints.push({ beat, bpm });
                    s.tempoTrackPoints.sort((a, b) => a.beat - b.beat);
                  }
                });
              }}
              style={{
                height: 68,
                background: 'var(--bg)',
                borderBottom: '1px solid var(--border)',
                position: 'relative',
                cursor: 'crosshair',
              }}
              title="Click to add or adjust Song Tempo Track BPM breakpoints (60–200 BPM)"
            >
              <svg width={TOTAL_BEATS * pxPerBeat} height={68} style={{ display: 'block' }}>
                <polyline
                  fill="none"
                  stroke="#FBBF24"
                  strokeWidth={1.8}
                  points={tempoPoints
                    .map((p) => {
                      const norm = Math.max(0, Math.min(1, (p.bpm - 60) / 140));
                      return `${p.beat * pxPerBeat},${(1 - norm) * 56 + 6}`;
                    })
                    .join(' ')}
                />
                {tempoPoints.map((p, i) => {
                  const norm = Math.max(0, Math.min(1, (p.bpm - 60) / 140));
                  const x = p.beat * pxPerBeat;
                  const y = (1 - norm) * 56 + 6;
                  return (
                    <g key={i}>
                      <circle cx={x} cy={y} r={4} fill="#FBBF24" stroke="#141416" strokeWidth={1.5} />
                      <text x={x + 6} y={Math.max(12, y - 4)} fill="#ececef" fontSize={9.5} fontFamily="JetBrains Mono, monospace">
                        {p.bpm}
                      </text>
                    </g>
                  );
                })}
              </svg>
            </div>

            {/* Magnetic Visual Snap Guide */}
            {snapGuideBeat !== null && (
              <div
                style={{
                  position: 'absolute',
                  top: 0,
                  bottom: 0,
                  left: snapGuideBeat * pxPerBeat,
                  width: 1.5,
                  background: '#2f7cf6',
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
                  left: (playBeat % TOTAL_BEATS) * pxPerBeat,
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
