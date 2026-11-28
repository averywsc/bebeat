import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  Magnet,
  Trash2,
  Upload,
  Download,
  ZoomIn,
  ZoomOut,
  Ghost,
  Sparkles,
  ChevronLeft,
  ChevronRight,
} from 'lucide-react';
import type { PianoNote, ProjectState } from '../types/daw';
import { projectStore, uid } from '../state/projectStore';
import {
  CHORD_DEFINITIONS,
  CHORD_PROGRESSIONS,
  SCALE_DEFINITIONS,
  SEMITONE_TO_KEY_LABEL,
  getScaleMidiNotes,
  isMidiInScale,
  midiToNoteName,
  snapMidiToScale,
} from '../livecode/musicTheory';
import { audioEngine } from '../audio/engine';
import { exportNotesToSmf, importSmfToNotes } from '../audio/midiCodec';
import { detectChordName } from '../audio/sheetMusicEngraver';
import { triggerBrowserDownload } from '../services/bridge';

interface PianoRollProps {
  project: ProjectState;
  onRequestMidiUpload?: () => void;
}

const MIN_MIDI = 24; // C1
const MAX_MIDI = 84; // C6
const ROW_H = 19;
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

export const PianoRoll: React.FC<PianoRollProps> = ({ project, onRequestMidiUpload }) => {
  const [gridBeats, setGridBeats] = useState(0.25);
  const [snapEnabled, setSnapEnabled] = useState(true);
  const [scaleRoot, setScaleRoot] = useState(0); // C
  const [scaleMode, setScaleMode] = useState('minor');
  const [scaleSnap, setScaleSnap] = useState(false);
  const [ghostNotes, setGhostNotes] = useState(true);
  const [chordStamp, setChordStamp] = useState<string>('none');
  const [slideMode, setSlideMode] = useState(false);
  const [arpMode, setArpMode] = useState<'up' | 'down' | 'updown' | 'random' | 'octave'>('up');
  const [progChoice, setProgChoice] = useState(CHORD_PROGRESSIONS[0].id);
  const [pxPerBeat, setPxPerBeat] = useState(110);
  const [selectedNoteIds, setSelectedNoteIds] = useState<Set<string>>(new Set());
  const [playBeat, setPlayBeat] = useState(-1);
  const [scrollTop, setScrollTop] = useState(0);
  const [pressedNotes, setPressedNotes] = useState<Set<number>>(new Set());

  const scrollWrapRef = useRef<HTMLDivElement | null>(null);
  const clipboardRef = useRef<PianoNote[]>([]);
  const paintLastCellRef = useRef<string | null>(null);
  const isPaintingRef = useRef<'paint' | 'delete' | null>(null);
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
  const baseTypingMidi = (project.typingOctave + 1) * 12;

  const rows = useMemo(() => {
    const arr: number[] = [];
    for (let m = MAX_MIDI; m >= MIN_MIDI; m--) arr.push(m);
    return arr;
  }, []);

  // Gather Ghost Notes from all other channels in this pattern
  const otherChannelNotes = useMemo(() => {
    if (!ghostNotes || !pattern || !channel) return [];
    const out: PianoNote[] = [];
    for (const [cid, list] of Object.entries(pattern.notes)) {
      if (cid === channel.id) continue;
      for (const n of list) out.push(n);
    }
    return out;
  }, [ghostNotes, pattern, channel]);

  useEffect(() => {
    return audioEngine.subscribePressedNotes(setPressedNotes);
  }, []);

  // Auto-scroll vertically to C4 on mount
  useEffect(() => {
    const wrap = scrollWrapRef.current;
    if (wrap) {
      const targetTop = Math.max(0, (MAX_MIDI - 64) * ROW_H - 40);
      wrap.scrollTop = targetTop;
      setScrollTop(targetTop);
    }
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement)?.tagName === 'INPUT' || (e.target as HTMLElement)?.tagName === 'TEXTAREA') return;
      const ctrl = e.ctrlKey || e.metaKey;
      const k = e.key.toLowerCase();
      if ((k === 'n') && (!project.typingKeyboardEnabled || e.altKey)) {
        setSnapEnabled((v) => !v);
      } else if (ctrl && k === 'a' && channel) {
        e.preventDefault();
        setSelectedNoteIds(new Set(notes.map((n) => n.id)));
      } else if (ctrl && k === 'c' && channel) {
        const src = selectedNoteIds.size > 0 ? notes.filter((n) => selectedNoteIds.has(n.id)) : notes;
        if (src.length > 0) {
          e.preventDefault();
          clipboardRef.current = src.map((n) => ({ ...n }));
        }
      } else if (ctrl && k === 'v' && channel && clipboardRef.current.length > 0) {
        e.preventDefault();
        const clip = clipboardRef.current;
        const minB = Math.min(...clip.map((n) => n.startBeat));
        const maxEnd = Math.max(...clip.map((n) => n.startBeat + n.duration));
        const shift = Math.max(gridBeats, Math.ceil((maxEnd - minB) / 4) * 4);
        const newIds: string[] = [];
        projectStore.update((s) => {
          const pat = s.patterns.find((p) => p.id === s.activePatternId);
          if (!pat) return;
          if (!pat.notes[channel.id]) pat.notes[channel.id] = [];
          for (const n of clip) {
            const nextBeat = n.startBeat + shift;
            if (nextBeat < totalBeats) {
              const nid = uid('n');
              newIds.push(nid);
              pat.notes[channel.id].push({ ...n, id: nid, startBeat: nextBeat });
            }
          }
        });
        if (newIds.length > 0) setSelectedNoteIds(new Set(newIds));
      } else if (ctrl && k === 'd' && channel) {
        e.preventDefault();
        const src = selectedNoteIds.size > 0 ? notes.filter((n) => selectedNoteIds.has(n.id)) : notes;
        if (src.length === 0) return;
        const minB = Math.min(...src.map((n) => n.startBeat));
        const maxEnd = Math.max(...src.map((n) => n.startBeat + n.duration));
        const span = Math.max(gridBeats, maxEnd - minB);
        const newIds: string[] = [];
        projectStore.update((s) => {
          const pat = s.patterns.find((p) => p.id === s.activePatternId);
          if (!pat) return;
          if (!pat.notes[channel.id]) pat.notes[channel.id] = [];
          for (const n of src) {
            const nextBeat = n.startBeat + span;
            if (nextBeat < totalBeats) {
              const nid = uid('n');
              newIds.push(nid);
              pat.notes[channel.id].push({ ...n, id: nid, startBeat: nextBeat });
            }
          }
        });
        if (newIds.length > 0) setSelectedNoteIds(new Set(newIds));
      } else if ((e.key === 'Delete' || e.key === 'Backspace') && selectedNoteIds.size > 0 && channel) {
        projectStore.update((s) => {
          const pat = s.patterns.find((p) => p.id === s.activePatternId);
          if (pat && pat.notes[channel.id]) {
            pat.notes[channel.id] = pat.notes[channel.id].filter((n) => !selectedNoteIds.has(n.id));
          }
        });
        setSelectedNoteIds(new Set());
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [selectedNoteIds, notes, channel, gridBeats, totalBeats, project.typingKeyboardEnabled]);

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

  const mutateNotes = (fn: (list: PianoNote[]) => PianoNote[]) => {
    projectStore.update((s) => {
      const pat = s.patterns.find((p) => p.id === s.activePatternId);
      if (!pat) return;
      const cur = pat.notes[channel.id] || [];
      pat.notes[channel.id] = fn(cur);
    });
  };

  // --- Piano Roll Power Transforms ---
  const handleTranspose = (semi: number) => {
    mutateNotes((list) =>
      list.map((n) => ({ ...n, midi: Math.max(MIN_MIDI, Math.min(MAX_MIDI, n.midi + semi)) }))
    );
  };

  const handleQuantizeAll = () => {
    mutateNotes((list) =>
      list.map((n) => ({
        ...n,
        startBeat: Math.max(0, Math.round(n.startBeat / gridBeats) * gridBeats),
        duration: Math.max(gridBeats, Math.round(n.duration / gridBeats) * gridBeats),
      }))
    );
  };

  const handleHumanize = () => {
    mutateNotes((list) =>
      list.map((n) => ({
        ...n,
        startBeat: Math.max(0, n.startBeat + (Math.random() - 0.5) * 0.045),
        velocity: Math.max(0.25, Math.min(1, n.velocity + (Math.random() - 0.5) * 0.18)),
      }))
    );
  };

  const handleLegato = () => {
    mutateNotes((list) => {
      const sorted = [...list].sort((a, b) => a.startBeat - b.startBeat);
      return sorted.map((n, i) => {
        const nextDiff = sorted.slice(i + 1).find((x) => x.startBeat > n.startBeat + 0.01);
        const targetEnd = nextDiff ? nextDiff.startBeat : totalBeats;
        return { ...n, duration: Math.max(0.125, targetEnd - n.startBeat) };
      });
    });
  };

  const handleStrum = () => {
    mutateNotes((list) => {
      // Group simultaneous chord notes and stagger start times slightly
      const sorted = [...list].sort((a, b) => a.startBeat - b.startBeat || a.midi - b.midi);
      let groupStart = -999;
      let idxInGroup = 0;
      return sorted.map((n) => {
        if (Math.abs(n.startBeat - groupStart) > 0.06) {
          groupStart = n.startBeat;
          idxInGroup = 0;
        } else {
          idxInGroup++;
        }
        return { ...n, startBeat: Math.min(totalBeats - 0.125, n.startBeat + idxInGroup * 0.045) };
      });
    });
  };

  const handleScaleSpeed = (factor: number) => {
    mutateNotes((list) =>
      list
        .map((n) => ({
          ...n,
          startBeat: n.startBeat * factor,
          duration: Math.max(0.0625, n.duration * factor),
        }))
        .filter((n) => n.startBeat < totalBeats)
    );
  };

  const handleFlipInvert = () => {
    mutateNotes((list) => {
      if (list.length < 2) return list;
      const minM = Math.min(...list.map((n) => n.midi));
      const maxM = Math.max(...list.map((n) => n.midi));
      return list.map((n) => ({ ...n, midi: Math.max(MIN_MIDI, Math.min(MAX_MIDI, maxM - (n.midi - minM))) }));
    });
  };

  const handleGenerateArp = () => {
    mutateNotes((list) => {
      const uniquePitches = Array.from(new Set(list.map((n) => n.midi))).sort((a, b) => a - b);
      const source =
        uniquePitches.length >= 2
          ? uniquePitches
          : getScaleMidiNotes(`${ROOT_NAMES[scaleRoot]}4`, scaleMode, 1).slice(0, 5);
      let seq: number[] = [...source];
      if (arpMode === 'down') seq = [...source].reverse();
      else if (arpMode === 'updown') seq = [...source, ...source.slice(1, -1).reverse()];
      else if (arpMode === 'octave') seq = [...source, ...source.map((m) => Math.min(MAX_MIDI, m + 12))];
      else if (arpMode === 'random') {
        seq = Array.from({ length: 16 }, () => source[Math.floor(Math.random() * source.length)]);
      }

      const stepDur = Math.max(0.125, Math.min(0.5, gridBeats));
      const totalSteps = Math.floor(totalBeats / stepDur);
      const out: PianoNote[] = [];
      for (let i = 0; i < totalSteps; i++) {
        out.push({
          id: uid('arp'),
          midi: seq[i % seq.length],
          startBeat: i * stepDur,
          duration: stepDur * 0.85,
          velocity: i % 4 === 0 ? 0.9 : i % 2 === 0 ? 0.74 : 0.62,
          pan: (i % 2 === 0 ? -1 : 1) * 0.12,
        });
      }
      return out;
    });
  };

  const handleStampProgression = () => {
    const template = CHORD_PROGRESSIONS.find((p) => p.id === progChoice) || CHORD_PROGRESSIONS[0];
    const rootBase = 48 + scaleRoot; // C3..B3
    const chordDur = totalBeats / template.chords.length;
    mutateNotes(() => {
      const out: PianoNote[] = [];
      template.chords.forEach((ch, ci) => {
        const intervals = CHORD_DEFINITIONS[ch.quality] || [0, 3, 7];
        intervals.forEach((iv, ni) => {
          out.push({
            id: uid('prog'),
            midi: Math.min(MAX_MIDI, rootBase + ch.degreeOffset + iv),
            startBeat: ci * chordDur,
            duration: chordDur * 0.94,
            velocity: Math.max(0.5, 0.78 - ni * 0.04),
            pan: (ni - 1.5) * 0.08,
          });
        });
      });
      return out;
    });
  };

  const stampNoteAtCoords = (x: number, y: number, audition: boolean) => {
    const rawBeat = x / pxPerBeat;
    const rowIdx = Math.floor(y / ROW_H);
    let midi = MAX_MIDI - rowIdx;
    if (midi < MIN_MIDI || midi > MAX_MIDI) return;
    if (scaleSnap) midi = snapMidiToScale(midi, scaleRoot, scaleMode);

    const startBeat = quantizeBeat(rawBeat);
    const cellKey = `${midi}_${startBeat.toFixed(4)}`;
    if (paintLastCellRef.current === cellKey) return;
    paintLastCellRef.current = cellKey;

    const intervals = chordStamp !== 'none' ? CHORD_DEFINITIONS[chordStamp] || [0] : [0];
    const addedIds: string[] = [];

    projectStore.update((s) => {
      const pat = s.patterns.find((p) => p.id === s.activePatternId);
      if (!pat) return;
      if (!pat.notes[channel.id]) pat.notes[channel.id] = [];
      for (const iv of intervals) {
        const m = Math.min(MAX_MIDI, midi + iv);
        const dup = pat.notes[channel.id].some(
          (n) => n.midi === m && Math.abs(n.startBeat - startBeat) < 0.02
        );
        if (dup) continue;
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

    if (addedIds.length > 0) {
      setSelectedNoteIds(new Set(addedIds));
      if (audition) {
        intervals.forEach((iv) => {
          void audioEngine.auditionChannelNote(channel.id, Math.min(127, midi + iv), 0.8, 0.25);
        });
      }
    }
  };

  const handleGridMouseDown = (e: React.MouseEvent<HTMLDivElement>) => {
    if (e.button !== 0) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    const rawBeat = x / pxPerBeat;

    if (project.activeTool === 'zoom') {
      setPxPerBeat((z) => Math.min(260, z + 30));
      return;
    }
    if (project.activeTool === 'playback') {
      audioEngine.seekBeat(Math.max(0, rawBeat));
      return;
    }
    if (project.activeTool === 'delete') {
      isPaintingRef.current = 'delete';
      return;
    }
    if (project.activeTool === 'mute' || project.activeTool === 'select') {
      if (!e.shiftKey) setSelectedNoteIds(new Set());
      return;
    }

    paintLastCellRef.current = null;
    if (project.activeTool === 'paint') {
      isPaintingRef.current = 'paint';
    }
    stampNoteAtCoords(x, y, true);
  };

  const handleGridMouseMove = (e: React.MouseEvent<HTMLDivElement>) => {
    if (isPaintingRef.current !== 'paint') return;
    const rect = e.currentTarget.getBoundingClientRect();
    stampNoteAtCoords(e.clientX - rect.left, e.clientY - rect.top, true);
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
    isPaintingRef.current = null;
    paintLastCellRef.current = null;
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
    if (onRequestMidiUpload) {
      onRequestMidiUpload();
      return;
    }
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

  const handleGenerateMelody = () => {
    const scaleNotes = getScaleMidiNotes(`${ROOT_NAMES[scaleRoot]}4`, scaleMode, 2);
    mutateNotes(() => {
      const out: PianoNote[] = [];
      let deg = 0;
      let beat = 0;
      while (beat < totalBeats - 0.1) {
        const durChoices = [0.25, 0.5, 0.5, 0.75, 1.0];
        const dur = Math.min(totalBeats - beat, durChoices[Math.floor(Math.random() * durChoices.length)]);
        const jump = [-2, -1, 0, 1, 2, 3][Math.floor(Math.random() * 6)];
        deg = Math.max(0, Math.min(scaleNotes.length - 1, deg + jump));
        if (Math.random() > 0.14) {
          out.push({
            id: uid('mel'),
            midi: scaleNotes[deg],
            startBeat: beat,
            duration: dur * 0.9,
            velocity: beat % 1 === 0 ? 0.88 : 0.72,
            pan: 0,
          });
        }
        beat += dur;
      }
      return out;
    });
  };

  const handleGenerateBassline = () => {
    const scaleNotes = getScaleMidiNotes(`${ROOT_NAMES[scaleRoot]}2`, scaleMode, 1);
    const grooveBeats = [0, 0.75, 1.5, 2.0, 2.5, 3.25, 3.75];
    const degCycle = [0, 0, 4, 2, 5, 3, 4];
    mutateNotes(() => {
      const out: PianoNote[] = [];
      const bars = Math.max(1, Math.floor(totalBeats / 4));
      for (let bar = 0; bar < bars; bar++) {
        grooveBeats.forEach((gb, gi) => {
          const degIdx = (degCycle[(gi + bar) % degCycle.length]) % scaleNotes.length;
          const octJump = gi === 2 || gi === 6 ? 12 : 0;
          const midi = Math.max(MIN_MIDI, Math.min(MAX_MIDI, scaleNotes[degIdx] + octJump));
          const nextGb = grooveBeats[gi + 1] ?? 4;
          const dur = Math.max(0.2, Math.min(0.65, (nextGb - gb) * 0.85));
          out.push({
            id: uid('bass'),
            midi,
            startBeat: bar * 4 + gb,
            duration: dur,
            velocity: gi === 0 || gi === 3 ? 0.94 : 0.78,
            pan: 0,
            slide: gi === 5,
          });
        });
      }
      return out;
    });
  };

  // Live Playable 29-key Keyboard Strip mapped to Z..M and Q..P
  const liveKeyboardSemis = useMemo(() => Array.from({ length: 29 }, (_, i) => i), []);
  const liveChordHud = useMemo(() => detectChordName(Array.from(pressedNotes)), [pressedNotes]);

  return (
    <div className="piano-roll-wrap" onMouseMove={handleMouseMove} onMouseUp={handleMouseUp}>
      {/* Row 1: Channel, Snap, Scale, Chord Stamp, MIDI I/O */}
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

        <button
          className={snapEnabled ? 'active sm' : 'sm'}
          onClick={() => setSnapEnabled((v) => !v)}
          title="Magnetic Grid Snap (Alt+N)"
        >
          <Magnet size={12} /> Snap
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

        <button
          className={ghostNotes ? 'active sm' : 'sm'}
          onClick={() => setGhostNotes((v) => !v)}
          title="Show Ghost Notes from other channels in the same pattern"
        >
          <Ghost size={12} /> Ghosts
        </button>

        <button
          className={project.recordQuantize ? 'active sm' : 'sm'}
          onClick={() => projectStore.update((s) => { s.recordQuantize = !s.recordQuantize; }, false)}
          title="Snap live recorded notes to 1/16th grid"
        >
          Rec Quantize
        </button>

        <button
          className={project.stepEntryMode ? 'active sm' : 'sm'}
          onClick={() => projectStore.update((s) => { s.stepEntryMode = !s.stepEntryMode; }, false)}
          title="Note Step Entry: press keys on your PC or MIDI keyboard to step-input notes one beat at a time"
        >
          Step Entry
        </button>

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
          onClick={() => mutateNotes(() => [])}
          title="Clear All Notes"
        >
          <Trash2 size={12} /> Clear
        </button>
      </div>

      {/* Row 2: Piano Roll Power Tools (Arp, Chord Progressions, Humanize, Quantize, Strum, Legato, Transpose, Speed) */}
      <div
        className="panel-header"
        style={{ height: 32, background: 'var(--bg-alt)', gap: 6, overflowX: 'auto' }}
      >
        <select value={progChoice} onChange={(e) => setProgChoice(e.target.value)} style={{ padding: '2px 6px' }}>
          {CHORD_PROGRESSIONS.map((p) => (
            <option key={p.id} value={p.id}>{p.name}</option>
          ))}
        </select>
        <button className="sm" onClick={handleStampProgression}>
          <Sparkles size={11} /> Generate Chords
        </button>

        <div className="topbar-sep" />
        <select
          value={arpMode}
          onChange={(e) => setArpMode(e.target.value as typeof arpMode)}
          style={{ padding: '2px 6px' }}
        >
          <option value="up">Arp: Up</option>
          <option value="down">Arp: Down</option>
          <option value="updown">Arp: Up-Down</option>
          <option value="octave">Arp: Octave</option>
          <option value="random">Arp: Random</option>
        </select>
        <button className="sm" onClick={handleGenerateArp}>Arpeggiate</button>
        <button className="sm" onClick={handleGenerateMelody} title="Generate a musical scale-locked melody riff">
          Auto Melody
        </button>
        <button className="sm" onClick={handleGenerateBassline} title="Generate a syncopated octave-bouncing scale bassline">
          Auto Bassline
        </button>

        <div className="topbar-sep" />
        <button className="sm" onClick={handleQuantizeAll}>Quantize</button>
        <button className="sm" onClick={handleHumanize}>Humanize</button>
        <button className="sm" onClick={handleStrum}>Strum</button>
        <button className="sm" onClick={handleLegato}>Legato</button>
        <button className="sm" onClick={handleFlipInvert}>Flip</button>
        <button className="sm" onClick={() => handleScaleSpeed(0.5)}>2x Fast</button>
        <button className="sm" onClick={() => handleScaleSpeed(2)}>0.5x Slow</button>

        <div className="topbar-sep" />
        <button className="sm mono" onClick={() => handleTranspose(-12)}>-12</button>
        <button className="sm mono" onClick={() => handleTranspose(-1)}>-1</button>
        <button className="sm mono" onClick={() => handleTranspose(1)}>+1</button>
        <button className="sm mono" onClick={() => handleTranspose(12)}>+12</button>
        {liveChordHud && (
          <span
            className="mono"
            style={{
              marginLeft: 'auto',
              padding: '2px 8px',
              background: 'var(--accent-soft)',
              border: '1px solid var(--accent)',
              borderRadius: 4,
              color: '#ffffff',
              fontSize: 11,
              fontWeight: 600,
            }}
          >
            Chord: {liveChordHud}
          </span>
        )}
      </div>

      {/* Main Piano Keys + Note Grid */}
      <div className="piano-roll-body">
        <div className="piano-keys-col" style={{ width: 72 }}>
          <div style={{ transform: `translateY(-${scrollTop}px)` }}>
            {rows.map((midi) => {
              const isBlack = [1, 3, 6, 8, 10].includes(midi % 12);
              const isC = midi % 12 === 0;
              const inScale = isMidiInScale(midi, scaleRoot, scaleMode);
              const keyBind = SEMITONE_TO_KEY_LABEL[midi - baseTypingMidi];
              const isPressed = pressedNotes.has(midi);

              return (
                <div
                  key={midi}
                  onMouseDown={() => void audioEngine.noteOnLive(channel.id, midi, 0.85)}
                  onMouseUp={() => audioEngine.noteOffLive(channel.id, midi)}
                  onMouseLeave={() => { if (isPressed) audioEngine.noteOffLive(channel.id, midi); }}
                  style={{
                    height: ROW_H,
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    padding: '0 6px',
                    fontSize: 10,
                    cursor: 'pointer',
                    background: isPressed ? '#FFFFFF' : isBlack ? 'var(--bg)' : 'var(--panel-elev)',
                    color: isPressed ? 'var(--bg)' : isC ? '#FFFFFF' : inScale ? '#94A3B8' : '#475569',
                    borderBottom: '1px solid var(--border)',
                    fontWeight: isPressed || isC ? 700 : 500,
                  }}
                >
                  <span className="mono" style={{ fontSize: 9.5 }}>{midiToNoteName(midi)}</span>
                  {keyBind && project.typingKeyboardEnabled && (
                    <span
                      style={{
                        fontSize: 9,
                        padding: '0 4px',
                        borderRadius: 2,
                        border: isPressed ? '1px solid #080C18' : '1px solid var(--border-strong)',
                        background: isPressed ? 'var(--bg)' : 'var(--bg)',
                        color: '#FFFFFF',
                        lineHeight: '13px',
                      }}
                    >
                      {keyBind}
                    </span>
                  )}
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
            onMouseMove={handleGridMouseMove}
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
                    background: pressedNotes.has(midi)
                      ? 'rgba(96, 165, 250, 0.18)'
                      : inScale
                      ? 'rgba(36, 50, 77, 0.22)'
                      : 'rgba(8, 12, 24, 0.65)',
                    borderBottom: isC ? '1px solid var(--border-strong)' : '1px solid #131D33',
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
                    background: isBar ? 'var(--border-strong)' : isBeat ? '#1E2C49' : '#111B30',
                    pointerEvents: 'none',
                  }}
                />
              );
            })}

            {/* Ghost Notes from other channels */}
            {otherChannelNotes.map((n) => (
              <div
                key={`ghost_${n.id}`}
                style={{
                  position: 'absolute',
                  top: (MAX_MIDI - n.midi) * ROW_H + 2,
                  left: n.startBeat * pxPerBeat,
                  width: Math.max(8, n.duration * pxPerBeat - 1),
                  height: ROW_H - 4,
                  background: 'rgba(148, 163, 184, 0.14)',
                  border: '1px solid rgba(148, 163, 184, 0.22)',
                  borderRadius: 2,
                  pointerEvents: 'none',
                }}
              />
            ))}

            {/* Active Channel Notes */}
            {notes.map((n) => {
              const top = (MAX_MIDI - n.midi) * ROW_H + 1;
              const left = n.startBeat * pxPerBeat;
              const width = Math.max(10, n.duration * pxPerBeat - 1);
              const isSel = selectedNoteIds.has(n.id);
              return (
                <div
                  key={n.id}
                  onMouseEnter={() => {
                    if (isPaintingRef.current === 'delete') {
                      projectStore.update((s) => {
                        const pat = s.patterns.find((p) => p.id === s.activePatternId);
                        if (pat) pat.notes[channel.id] = pat.notes[channel.id].filter((x) => x.id !== n.id);
                      });
                    }
                  }}
                  onMouseDown={(e) => {
                    e.stopPropagation();
                    if (e.button === 2 || project.activeTool === 'delete') {
                      isPaintingRef.current = 'delete';
                      projectStore.update((s) => {
                        const pat = s.patterns.find((p) => p.id === s.activePatternId);
                        if (pat) pat.notes[channel.id] = pat.notes[channel.id].filter((x) => x.id !== n.id);
                      });
                      return;
                    }
                    if (project.activeTool === 'mute') {
                      projectStore.update((s) => {
                        const pat = s.patterns.find((p) => p.id === s.activePatternId);
                        const found = pat?.notes[channel.id]?.find((x) => x.id === n.id);
                        if (found) found.velocity = found.velocity > 0.05 ? 0.01 : 0.84;
                      });
                      return;
                    }
                    if (project.activeTool === 'slice') {
                      projectStore.update((s) => {
                        const pat = s.patterns.find((p) => p.id === s.activePatternId);
                        const list = pat?.notes[channel.id];
                        const idx = list?.findIndex((x) => x.id === n.id) ?? -1;
                        if (!list || idx < 0 || list[idx].duration < 0.25) return;
                        const half = list[idx].duration / 2;
                        list[idx].duration = half;
                        list.splice(idx + 1, 0, {
                          ...list[idx],
                          id: uid('n'),
                          startBeat: list[idx].startBeat + half,
                        });
                      });
                      return;
                    }
                    if (e.shiftKey) {
                      setSelectedNoteIds((prev) => {
                        const next = new Set(prev);
                        if (next.has(n.id)) next.delete(n.id);
                        else next.add(n.id);
                        return next;
                      });
                    } else {
                      setSelectedNoteIds(new Set([n.id]));
                    }
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
                    color: 'var(--bg)',
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
      <div className="velocity-lane" style={{ height: 54 }}>
        <div
          style={{
            width: 72,
            flex: 'none',
            borderRight: '1px solid var(--border)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            fontSize: 10.5,
            color: '#94A3B8',
            fontWeight: 600,
          }}
        >
          Velocity
        </div>
        <div style={{ flex: 1, position: 'relative', overflow: 'hidden', background: 'var(--bg)' }}>
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
                height: `${Math.round(n.velocity * 90)}%`,
                background: selectedNoteIds.has(n.id) ? '#2f7cf6' : '#FFFFFF',
                borderTopLeftRadius: 2,
                borderTopRightRadius: 2,
                cursor: 'ns-resize',
              }}
              title={`Velocity ${Math.round(n.velocity * 100)}% (Click to adjust)`}
            />
          ))}
        </div>
      </div>

      {/* Live Playable PC Keyboard Piano Strip (Z..M + Q..P) */}
      <div className="piano-live-strip">
        <div style={{ width: 64, flex: 'none', display: 'flex', flexDirection: 'column', gap: 3, marginRight: 6 }}>
          <div style={{ display: 'flex', gap: 2 }}>
            <button
              className="sm icon-only"
              style={{ flex: 1, padding: '2px 0' }}
              onClick={() => projectStore.update((s) => { s.typingOctave = Math.max(1, s.typingOctave - 1); }, false)}
              title="Octave Down ([)"
            >
              <ChevronLeft size={11} />
            </button>
            <button
              className="sm icon-only"
              style={{ flex: 1, padding: '2px 0' }}
              onClick={() => projectStore.update((s) => { s.typingOctave = Math.min(6, s.typingOctave + 1); }, false)}
              title="Octave Up (])"
            >
              <ChevronRight size={11} />
            </button>
          </div>
          <div className="mono" style={{ textAlign: 'center', fontSize: 10, color: '#94A3B8' }}>
            Oct {project.typingOctave}
          </div>
        </div>

        {liveKeyboardSemis.map((semi) => {
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
              <span className="mono" style={{ fontSize: 8.5, opacity: 0.75 }}>
                {midi % 12 === 0 ? midiToNoteName(midi) : ''}
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
};
