import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Magnet, Trash2, Upload, Download, ZoomIn, ZoomOut } from 'lucide-react';
import type { PianoNote, ProjectState } from '../types/daw';
import { projectStore, uid } from '../state/projectStore';
import {
  CHORD_DEFINITIONS,
  SCALE_DEFINITIONS,
  isMidiInScale,
  midiToNoteName,
  snapMidiToScale,
} from '../livecode/musicTheory';
import { audioEngine } from '../audio/engine';
import { exportNotesToSmf, importSmfToNotes } from '../audio/midiCodec';
import { triggerBrowserDownload } from '../services/bridge';

interface PianoRollProps {
  project: ProjectState;
}

const MIN_MIDI = 24; // C1
const MAX_MIDI = 84; // C6
const ROW_H = 18;
const GRID_OPTIONS = [
  { label: '1/4', beats: 1 },
  { label: '1/8', beats: 0.5 },
  { label: '1/8T', beats: 1 / 3 },
  { label: '1/16', beats: 0.25 },
  { label: '1/16T', beats: 1 / 6 },
  { label: '1/32', beats: 0.125 },
  { label: '1/64', beats: 0.0625 },
];
const ROOT_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];

export const PianoRoll: React.FC<PianoRollProps> = ({ project }) => {
  const [gridBeats, setGridBeats] = useState(0.25);
  const [snapEnabled, setSnapEnabled] = useState(true);
  const [scaleRoot, setScaleRoot] = useState(0); // C
  const [scaleMode, setScaleMode] = useState('minor');
  const [scaleSnap, setScaleSnap] = useState(false);
  const [chordStamp, setChordStamp] = useState<string>('none');
  const [slideMode, setSlideMode] = useState(false);
  const [pxPerBeat, setPxPerBeat] = useState(110);
  const [selectedNoteId, setSelectedNoteId] = useState<string | null>(null);
  const [playBeat, setPlayBeat] = useState(-1);
  const [scrollTop, setScrollTop] = useState(0);

  const scrollWrapRef = useRef<HTMLDivElement | null>(null);
  const dragRef = useRef<{
    mode: 'move' | 'resize';
    noteId: string;
    startX: number;
    startY: number;
    origBeat: number;
    origMidi: number;
    origDur: number;
  } | null>(null);

  const pattern = project.patterns.find((p) => p.id === project.activePatternId) || project.patterns[0];
  const channel = project.channels.find((c) => c.id === project.selectedChannelId) || project.channels[0];
  const notes: PianoNote[] = (pattern && channel && pattern.notes[channel.id]) || [];
  const totalBeats = Math.max(4, (pattern?.lengthSteps ?? 16) / 4);
  const rows = useMemo(() => {
    const arr: number[] = [];
    for (let m = MAX_MIDI; m >= MIN_MIDI; m--) arr.push(m);
    return arr;
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement)?.tagName === 'INPUT' || (e.target as HTMLElement)?.tagName === 'TEXTAREA') return;
      if (e.key === 'n' || e.key === 'N') {
        setSnapEnabled((v) => !v);
      } else if ((e.key === 'Delete' || e.key === 'Backspace') && selectedNoteId && channel) {
        projectStore.update((s) => {
          const pat = s.patterns.find((p) => p.id === s.activePatternId);
          if (pat && pat.notes[channel.id]) {
            pat.notes[channel.id] = pat.notes[channel.id].filter((n) => n.id !== selectedNoteId);
          }
        });
        setSelectedNoteId(null);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [selectedNoteId, channel]);

  useEffect(() => {
    let raf = 0;
    const poll = () => {
      const t = audioEngine.readTelemetry();
      setPlayBeat(t.playing ? t.beatPosition % totalBeats : -1);
      raf = requestAnimationFrame(poll);
    };
    raf = requestAnimationFrame(poll);
    return () => cancelAnimationFrame(raf);
  }, [totalBeats]);

  if (!pattern || !channel) return null;

  const gridWidth = Math.max(760, totalBeats * pxPerBeat);
  const gridHeight = rows.length * ROW_H;

  const quantizeBeat = (rawBeat: number) => {
    if (!snapEnabled) return Math.max(0, Math.round(rawBeat * 64) / 64);
    return Math.max(0, Math.floor(rawBeat / gridBeats) * gridBeats);
  };

  const handleGridMouseDown = (e: React.MouseEvent<HTMLDivElement>) => {
    if (e.button !== 0) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    const rawBeat = x / pxPerBeat;
    const rowIdx = Math.floor(y / ROW_H);
    let midi = MAX_MIDI - rowIdx;
    if (midi < MIN_MIDI || midi > MAX_MIDI) return;
    if (scaleSnap) midi = snapMidiToScale(midi, scaleRoot, scaleMode);

    const startBeat = quantizeBeat(rawBeat);
    const intervals = chordStamp !== 'none' ? CHORD_DEFINITIONS[chordStamp] || [0] : [0];
    const addedIds: string[] = [];

    projectStore.update((s) => {
      const pat = s.patterns.find((p) => p.id === s.activePatternId);
      if (!pat) return;
      if (!pat.notes[channel.id]) pat.notes[channel.id] = [];
      for (const iv of intervals) {
        const m = Math.min(MAX_MIDI, midi + iv);
        const nid = uid('n');
        addedIds.push(nid);
        pat.notes[channel.id].push({
          id: nid,
          midi: m,
          startBeat,
          duration: Math.max(gridBeats, 0.25),
          velocity: 0.84,
          pan: 0,
          slide: slideMode,
        });
      }
    });

    if (addedIds[0]) setSelectedNoteId(addedIds[0]);
    intervals.forEach((iv) => {
      void audioEngine.auditionChannelNote(channel.id, Math.min(127, midi + iv), 0.8, 0.25);
    });
  };

  const handleMouseMove = (e: React.MouseEvent) => {
    const drag = dragRef.current;
    if (!drag) return;
    const dx = e.clientX - drag.startX;
    const dy = e.clientY - drag.startY;
    const deltaBeats = dx / pxPerBeat;

    projectStore.update((s) => {
      const pat = s.patterns.find((p) => p.id === s.activePatternId);
      const list = pat?.notes[channel.id];
      const n = list?.find((x) => x.id === drag.noteId);
      if (!n) return;

      if (drag.mode === 'move') {
        const rawB = Math.max(0, drag.origBeat + deltaBeats);
        n.startBeat = snapEnabled ? Math.round(rawB / gridBeats) * gridBeats : rawB;
        const deltaRows = Math.round(dy / ROW_H);
        let nextMidi = Math.max(MIN_MIDI, Math.min(MAX_MIDI, drag.origMidi - deltaRows));
        if (scaleSnap) nextMidi = snapMidiToScale(nextMidi, scaleRoot, scaleMode);
        n.midi = nextMidi;
      } else {
        const rawDur = Math.max(0.0625, drag.origDur + deltaBeats);
        n.duration = snapEnabled ? Math.max(gridBeats, Math.round(rawDur / gridBeats) * gridBeats) : rawDur;
      }
    }, false);
  };

  const handleMouseUp = () => {
    dragRef.current = null;
  };

  const handleExportMidi = async () => {
    const bytes = exportNotesToSmf(notes, project.bpm, `${channel.name} - ${pattern.name}`);
    const fname = `${channel.name.replace(/[^a-z0-9]+/gi, '_').toLowerCase()}.mid`;
    if (window.bebeat?.saveBinary) {
      await window.bebeat.saveBinary(fname, 'mid', bytes);
    } else {
      triggerBrowserDownload(fname, bytes, 'audio/midi');
    }
  };

  const handleImportMidi = async () => {
    const applyBytes = (bytes: Uint8Array) => {
      const imported = importSmfToNotes(bytes, project.bpm);
      projectStore.update((s) => {
        const pat = s.patterns.find((p) => p.id === s.activePatternId);
        if (pat) pat.notes[channel.id] = imported.notes;
      });
    };
    if (window.bebeat?.pickAudioOrSf2) {
      const picked = await window.bebeat.pickAudioOrSf2();
      if (picked) applyBytes(picked.bytes);
      return;
    }
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.mid,.midi';
    input.onchange = async () => {
      const file = input.files?.[0];
      if (!file) return;
      applyBytes(new Uint8Array(await file.arrayBuffer()));
    };
    input.click();
  };

  return (
    <div className="piano-roll-wrap" onMouseMove={handleMouseMove} onMouseUp={handleMouseUp}>
      <div className="panel-header" style={{ overflowX: 'auto' }}>
        <span className="panel-title">Piano Roll</span>
        <select
          value={channel.id}
          onChange={(e) => projectStore.update((s) => { s.selectedChannelId = e.target.value; }, false)}
        >
          {project.channels.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name} ({c.engine})
            </option>
          ))}
        </select>

        <div className="topbar-sep" />
        <button
          className={snapEnabled ? 'active sm' : 'sm'}
          onClick={() => setSnapEnabled((v) => !v)}
          title="Magnetic Grid Snap (N)"
        >
          <Magnet size={12} /> Snap (N)
        </button>

        <select
          className="mono"
          value={gridBeats}
          onChange={(e) => setGridBeats(parseFloat(e.target.value))}
          title="Grid Subdivision"
        >
          {GRID_OPTIONS.map((g) => (
            <option key={g.label} value={g.beats}>
              {g.label}
            </option>
          ))}
        </select>

        <div className="topbar-sep" />
        <span style={{ color: '#94A3B8', fontSize: 11 }}>Scale:</span>
        <select value={scaleRoot} onChange={(e) => setScaleRoot(parseInt(e.target.value, 10))}>
          {ROOT_NAMES.map((r, i) => (
            <option key={r} value={i}>{r}</option>
          ))}
        </select>
        <select value={scaleMode} onChange={(e) => setScaleMode(e.target.value)}>
          {Object.keys(SCALE_DEFINITIONS).map((m) => (
            <option key={m} value={m}>{m}</option>
          ))}
        </select>
        <button className={scaleSnap ? 'active sm' : 'sm'} onClick={() => setScaleSnap((v) => !v)}>
          Scale Snap
        </button>

        <select value={chordStamp} onChange={(e) => setChordStamp(e.target.value)} title="Chord Stamp Mode">
          <option value="none">Single Note</option>
          <option value="maj">Stamp Major</option>
          <option value="min">Stamp Minor</option>
          <option value="min7">Stamp Min7</option>
          <option value="maj7">Stamp Maj7</option>
          <option value="min9">Stamp Min9</option>
        </select>

        <button className={slideMode ? 'active sm' : 'sm'} onClick={() => setSlideMode((v) => !v)} title="Slide / Glide Notes">
          Slide
        </button>

        <div className="spacer" />

        <button className="sm icon-only" onClick={() => setPxPerBeat((z) => Math.max(55, z - 20))} title="Zoom Out">
          <ZoomOut size={12} />
        </button>
        <button className="sm icon-only" onClick={() => setPxPerBeat((z) => Math.min(260, z + 20))} title="Zoom In">
          <ZoomIn size={12} />
        </button>
        <button className="sm" onClick={handleImportMidi} title="Import .mid File">
          <Upload size={12} /> .mid
        </button>
        <button className="sm" onClick={handleExportMidi} title="Export .mid File">
          <Download size={12} /> .mid
        </button>
        <button
          className="sm danger-outline"
          onClick={() =>
            projectStore.update((s) => {
              const pat = s.patterns.find((p) => p.id === s.activePatternId);
              if (pat) pat.notes[channel.id] = [];
            })
          }
          title="Clear All Notes"
        >
          <Trash2 size={12} /> Clear
        </button>
      </div>

      {/* Main Piano Keys + Note Grid */}
      <div className="piano-roll-body">
        <div className="piano-keys-col">
          <div style={{ transform: `translateY(-${scrollTop}px)` }}>
            {rows.map((midi) => {
              const isBlack = [1, 3, 6, 8, 10].includes(midi % 12);
              const isC = midi % 12 === 0;
              const inScale = isMidiInScale(midi, scaleRoot, scaleMode);
              return (
                <div
                  key={midi}
                  onMouseDown={() => void audioEngine.auditionChannelNote(channel.id, midi, 0.85, 0.3)}
                  className="mono"
                  style={{
                    height: ROW_H,
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    padding: '0 6px',
                    fontSize: 9.5,
                    cursor: 'pointer',
                    background: isBlack ? '#080C18' : '#11192E',
                    color: isC ? '#FFFFFF' : inScale ? '#94A3B8' : '#475569',
                    borderBottom: '1px solid #1C2740',
                  }}
                >
                  <span>{isC ? midiToNoteName(midi) : inScale ? '·' : ''}</span>
                  <span style={{ fontSize: 8.5, opacity: 0.7 }}>{isC ? '' : midiToNoteName(midi)}</span>
                </div>
              );
            })}
          </div>
        </div>

        <div
          ref={scrollWrapRef}
          className="piano-canvas-wrap"
          onScroll={(e) => setScrollTop(e.currentTarget.scrollTop)}
        >
          <div
            style={{ width: gridWidth, height: gridHeight, position: 'relative', cursor: 'crosshair' }}
            onMouseDown={handleGridMouseDown}
          >
            {/* Horizontal Scale-Highlighted Rows */}
            {rows.map((midi, idx) => {
              const inScale = isMidiInScale(midi, scaleRoot, scaleMode);
              const isC = midi % 12 === 0;
              return (
                <div
                  key={midi}
                  style={{
                    position: 'absolute',
                    left: 0,
                    right: 0,
                    top: idx * ROW_H,
                    height: ROW_H,
                    background: inScale ? 'rgba(36, 50, 77, 0.22)' : 'rgba(8, 12, 24, 0.65)',
                    borderBottom: isC ? '1px solid #2E3F61' : '1px solid #131D33',
                    pointerEvents: 'none',
                  }}
                />
              );
            })}

            {/* Vertical Grid Lines */}
            {Array.from({ length: Math.ceil(totalBeats / gridBeats) + 1 }, (_, i) => {
              const b = i * gridBeats;
              const isBar = Math.abs(b % 4) < 0.001;
              const isBeat = Math.abs(b % 1) < 0.001;
              return (
                <div
                  key={i}
                  style={{
                    position: 'absolute',
                    top: 0,
                    bottom: 0,
                    left: b * pxPerBeat,
                    width: 1,
                    background: isBar ? '#2E3F61' : isBeat ? '#1E2C49' : '#111B30',
                    pointerEvents: 'none',
                  }}
                />
              );
            })}

            {/* Notes */}
            {notes.map((n) => {
              const top = (MAX_MIDI - n.midi) * ROW_H + 1;
              const left = n.startBeat * pxPerBeat;
              const width = Math.max(10, n.duration * pxPerBeat - 1);
              const isSel = selectedNoteId === n.id;
              return (
                <div
                  key={n.id}
                  onMouseDown={(e) => {
                    e.stopPropagation();
                    if (e.button === 2) {
                      projectStore.update((s) => {
                        const pat = s.patterns.find((p) => p.id === s.activePatternId);
                        if (pat) pat.notes[channel.id] = pat.notes[channel.id].filter((x) => x.id !== n.id);
                      });
                      return;
                    }
                    setSelectedNoteId(n.id);
                    const rect = e.currentTarget.getBoundingClientRect();
                    const nearRight = e.clientX > rect.right - 8;
                    dragRef.current = {
                      mode: nearRight ? 'resize' : 'move',
                      noteId: n.id,
                      startX: e.clientX,
                      startY: e.clientY,
                      origBeat: n.startBeat,
                      origMidi: n.midi,
                      origDur: n.duration,
                    };
                  }}
                  onContextMenu={(e) => e.preventDefault()}
                  style={{
                    position: 'absolute',
                    top,
                    left,
                    width,
                    height: ROW_H - 2,
                    background: isSel ? '#FFFFFF' : '#E2E8F0',
                    color: '#080C18',
                    border: isSel ? '1px solid #60A5FA' : '1px solid #080C18',
                    borderRadius: 2,
                    padding: '0 4px',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    fontSize: 9.5,
                    fontFamily: 'var(--font-mono)',
                    fontWeight: 700,
                    cursor: 'grab',
                    opacity: 0.45 + n.velocity * 0.55,
                  }}
                  title={`${midiToNoteName(n.midi)} | Beat ${n.startBeat.toFixed(2)} | Vel ${Math.round(n.velocity * 100)}% (Right-click to delete)`}
                >
                  <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {midiToNoteName(n.midi)}{n.slide ? ' ~' : ''}
                  </span>
                  <span style={{ width: 5, height: '100%', cursor: 'ew-resize' }} />
                </div>
              );
            })}

            {/* Playhead Cursor */}
            {playBeat >= 0 && (
              <div
                style={{
                  position: 'absolute',
                  top: 0,
                  bottom: 0,
                  left: playBeat * pxPerBeat,
                  width: 1.5,
                  background: '#FFFFFF',
                  pointerEvents: 'none',
                }}
              />
            )}
          </div>
        </div>
      </div>

      {/* Velocity Lane */}
      <div className="velocity-lane">
        <div
          style={{
            width: 56,
            flex: 'none',
            borderRight: '1px solid #24324D',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            fontSize: 10,
            color: '#94A3B8',
            fontWeight: 600,
          }}
        >
          VEL
        </div>
        <div style={{ flex: 1, position: 'relative', overflow: 'hidden', background: '#080C18' }}>
          {notes.map((n) => (
            <div
              key={n.id}
              onMouseDown={(e) => {
                const rect = e.currentTarget.parentElement!.getBoundingClientRect();
                const norm = 1 - Math.max(0.05, Math.min(0.95, (e.clientY - rect.top) / rect.height));
                projectStore.update((s) => {
                  const pat = s.patterns.find((p) => p.id === s.activePatternId);
                  const found = pat?.notes[channel.id]?.find((x) => x.id === n.id);
                  if (found) found.velocity = Math.max(0.1, Math.min(1, norm));
                }, false);
              }}
              style={{
                position: 'absolute',
                left: n.startBeat * pxPerBeat,
                bottom: 0,
                width: 10,
                height: `${Math.round(n.velocity * 92)}%`,
                background: selectedNoteId === n.id ? '#60A5FA' : '#FFFFFF',
                borderTopLeftRadius: 2,
                borderTopRightRadius: 2,
                cursor: 'ns-resize',
              }}
              title={`Velocity ${Math.round(n.velocity * 100)}% (Click to adjust)`}
            />
          ))}
        </div>
      </div>
    </div>
  );
};
