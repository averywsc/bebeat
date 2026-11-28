import React, { useEffect, useMemo, useState } from 'react';
import {
  Trash2,
  Download,
  Upload,
  Printer,
  FileImage,
  FileCode2,
  FileMusic,
  Sun,
  Moon,
} from 'lucide-react';
import type { PianoNote, ProjectState } from '../types/daw';
import { projectStore, uid } from '../state/projectStore';
import { audioEngine } from '../audio/engine';
import { exportNotesToSmf } from '../audio/midiCodec';
import {
  AVAILABLE_KEY_SIGNATURES,
  detectBestKeySignature,
  engraveSheetMusicSvg,
  exportNotesToMusicXml,
  type ClefMode,
} from '../audio/sheetMusicEngraver';
import { triggerBrowserDownload } from '../services/bridge';

interface ScoreEditorViewProps {
  project: ProjectState;
  onRequestMidiUpload: () => void;
}

export const ScoreEditorView: React.FC<ScoreEditorViewProps> = ({ project, onRequestMidiUpload }) => {
  const [playBeat, setPlayBeat] = useState(-1);
  const [clefMode, setClefMode] = useState<ClefMode>('grand');
  const [keySig, setKeySig] = useState<string>('C');
  const [paperTheme, setPaperTheme] = useState<'paper' | 'dark'>('paper');
  const [sourceScope, setSourceScope] = useState<'channel' | 'all-melodic' | 'full-song'>('channel');
  const [scoreTitle, setScoreTitle] = useState(project.name || 'Untitled Score');
  const [composer, setComposer] = useState('Bebeat Studio');
  const [measuresPerSystem, setMeasuresPerSystem] = useState<number>(4);
  const [showChords, setShowChords] = useState<boolean>(true);
  const [showDynamics, setShowDynamics] = useState<boolean>(true);
  const [zoomPct, setZoomPct] = useState<number>(100);
  const [exportStatus, setExportStatus] = useState('');

  const pattern = project.patterns.find((p) => p.id === project.activePatternId) || project.patterns[0];
  const channel = project.channels.find((c) => c.id === project.selectedChannelId) || project.channels[0];

  // Collect notes based on selected scope (Single Channel, All Melodic Channels in Pattern, or Full Song Playlist)
  const notes: PianoNote[] = useMemo(() => {
    if (!pattern) return [];
    if (sourceScope === 'channel' && channel) {
      return pattern.notes[channel.id] || [];
    }
    if (sourceScope === 'all-melodic') {
      const merged: PianoNote[] = [];
      for (const ch of project.channels) {
        if (ch.engine === 'DrumSynth' || ch.mute) continue;
        for (const n of pattern.notes[ch.id] || []) merged.push(n);
      }
      return merged.sort((a, b) => a.startBeat - b.startBeat || a.midi - b.midi);
    }
    // Full song arrangement from Playlist
    const songNotes: PianoNote[] = [];
    for (const clip of project.playlistClips) {
      if (clip.muted || clip.kind !== 'pattern' || !clip.patternId) continue;
      const p = project.patterns.find((x) => x.id === clip.patternId);
      if (!p) continue;
      const targetChIds = channel && sourceScope !== 'full-song' ? [channel.id] : project.channels.filter((c) => c.engine !== 'DrumSynth' && !c.mute).map((c) => c.id);
      for (const cid of targetChIds) {
        for (const n of p.notes[cid] || []) {
          if (n.startBeat < clip.durationBeats) {
            songNotes.push({ ...n, startBeat: clip.startBeat + n.startBeat });
          }
        }
      }
    }
    return songNotes.length > 0
      ? songNotes.sort((a, b) => a.startBeat - b.startBeat || a.midi - b.midi)
      : (channel ? pattern.notes[channel.id] || [] : []);
  }, [pattern, channel, project.channels, project.patterns, project.playlistClips, sourceScope]);

  const totalBeats = useMemo(() => {
    const base = Math.max(4, (pattern?.lengthSteps ?? 16) / 4);
    const maxN = notes.reduce((m, n) => Math.max(m, n.startBeat + n.duration), base);
    return Math.ceil(maxN / 4) * 4;
  }, [notes, pattern]);

  useEffect(() => {
    let raf = 0;
    const poll = () => {
      const t = audioEngine.readTelemetry();
      setPlayBeat(t.playing ? t.beatPosition % Math.max(4, totalBeats) : -1);
      raf = requestAnimationFrame(poll);
    };
    raf = requestAnimationFrame(poll);
    return () => cancelAnimationFrame(raf);
  }, [totalBeats]);

  const sheetOpts = useMemo(
    () => ({
      title: scoreTitle || project.name,
      subtitle:
        sourceScope === 'channel'
          ? channel?.name || 'Piano'
          : sourceScope === 'all-melodic'
          ? 'Full Ensemble (Active Pattern)'
          : 'Full Song Arrangement',
      composer,
      bpm: project.bpm,
      timeSig: project.timeSignature,
      keySignature: keySig,
      clefMode,
      paperTheme,
      measuresPerSystem,
      pageWidth: 1020,
      showChords,
      showDynamics,
    }),
    [scoreTitle, project.name, sourceScope, channel?.name, composer, project.bpm, project.timeSignature, keySig, clefMode, paperTheme, measuresPerSystem, showChords, showDynamics]
  );

  const engraved = useMemo(() => engraveSheetMusicSvg(notes, sheetOpts), [notes, sheetOpts]);

  // Compute live playhead overlay coordinates across multi-system engraved sheet
  const playheadCoords = useMemo(() => {
    if (playBeat < 0) return null;
    const bpmMeasure = Math.max(2, project.timeSignature[0] || 4);
    const curMeasure = Math.floor(playBeat / bpmMeasure);
    const beatInMeasure = playBeat % bpmMeasure;
    const sys = engraved.systemGeometry.find((s) => curMeasure >= s.startMeasure && curMeasure < s.endMeasure);
    if (!sys) return null;
    const mOff = curMeasure - sys.startMeasure;
    const x = sys.xStart + mOff * sys.measureWidth + 14 + (beatInMeasure / bpmMeasure) * (sys.measureWidth - 24);
    const y1 = (clefMode === 'bass' ? sys.bassTopY : sys.trebleTopY) - 10;
    const y2 = (clefMode === 'treble' ? sys.trebleTopY : sys.bassTopY) + 50;
    return { x, y1, y2 };
  }, [playBeat, engraved, project.timeSignature, clefMode]);

  const safeFileSlug = (scoreTitle || project.name || 'bebeat_score')
    .replace(/[^a-z0-9_-]+/gi, '_')
    .toLowerCase();

  /** Download print-ready 300-DPI white-paper PNG sheet music */
  const handleDownloadPng = async () => {
    const printLayout = engraveSheetMusicSvg(notes, { ...sheetOpts, paperTheme: 'paper' });
    const scale = 2.5;
    const svgBlob = new Blob([printLayout.svg], { type: 'image/svg+xml;charset=utf-8' });
    const url = URL.createObjectURL(svgBlob);
    try {
      const img = new Image();
      await new Promise<void>((resolve, reject) => {
        img.onload = () => resolve();
        img.onerror = (e) => reject(e);
        img.src = url;
      });
      const canvas = document.createElement('canvas');
      canvas.width = Math.round(printLayout.width * scale);
      canvas.height = Math.round(printLayout.height * scale);
      const ctx = canvas.getContext('2d')!;
      ctx.fillStyle = '#FFFFFF';
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.scale(scale, scale);
      ctx.drawImage(img, 0, 0);

      const pngBlob = await new Promise<Blob | null>((r) => canvas.toBlob(r, 'image/png'));
      if (!pngBlob) return;
      const bytes = new Uint8Array(await pngBlob.arrayBuffer());
      if (window.bebeat?.saveBinary) {
        const saved = await window.bebeat.saveBinary(`${safeFileSlug}_sheet_music.png`, 'png', bytes);
        if (saved) setExportStatus(`Saved PNG sheet music: ${saved}`);
      } else {
        triggerBrowserDownload(`${safeFileSlug}_sheet_music.png`, bytes, 'image/png');
        setExportStatus(`Downloaded ${safeFileSlug}_sheet_music.png`);
      }
    } finally {
      URL.revokeObjectURL(url);
    }
  };

  /** Download infinite-resolution vector SVG sheet music */
  const handleDownloadSvg = async () => {
    const printLayout = engraveSheetMusicSvg(notes, { ...sheetOpts, paperTheme: 'paper' });
    const bytes = new TextEncoder().encode(printLayout.svg);
    if (window.bebeat?.saveBinary) {
      const saved = await window.bebeat.saveBinary(`${safeFileSlug}_sheet_music.svg`, 'svg', bytes);
      if (saved) setExportStatus(`Saved SVG sheet music: ${saved}`);
    } else {
      triggerBrowserDownload(`${safeFileSlug}_sheet_music.svg`, bytes, 'image/svg+xml');
      setExportStatus(`Downloaded ${safeFileSlug}_sheet_music.svg`);
    }
  };

  /** Download MusicXML 3.1 (.musicxml) for MuseScore / Sibelius / Finale / Dorico */
  const handleDownloadMusicXml = async () => {
    const xml = exportNotesToMusicXml(notes, sheetOpts);
    const bytes = new TextEncoder().encode(xml);
    if (window.bebeat?.saveBinary) {
      const saved = await window.bebeat.saveBinary(`${safeFileSlug}.musicxml`, 'musicxml', bytes);
      if (saved) setExportStatus(`Saved MusicXML: ${saved}`);
    } else {
      triggerBrowserDownload(`${safeFileSlug}.musicxml`, bytes, 'application/vnd.recordare.musicxml+xml');
      setExportStatus(`Downloaded ${safeFileSlug}.musicxml`);
    }
  };

  /** Print / Save as PDF in crisp white sheet music layout */
  const handlePrintPdf = () => {
    const prev = paperTheme;
    if (prev !== 'paper') setPaperTheme('paper');
    setTimeout(() => {
      window.print();
      if (prev !== 'paper') setPaperTheme(prev);
    }, 120);
  };

  /** Click anywhere on a system staff to stamp & audition a note directly on the sheet music */
  const handleSheetClick = (e: React.MouseEvent<HTMLDivElement>) => {
    if (!channel || sourceScope !== 'channel') return;
    const rect = e.currentTarget.getBoundingClientRect();
    const x = ((e.clientX - rect.left) / rect.width) * engraved.width;
    const y = ((e.clientY - rect.top) / rect.height) * engraved.height;

    const bpmMeasure = Math.max(2, project.timeSignature[0] || 4);
    const sys = engraved.systemGeometry.find((s) => {
      const top = (clefMode === 'bass' ? s.bassTopY : s.trebleTopY) - 24;
      const bot = (clefMode === 'treble' ? s.trebleTopY : s.bassTopY) + 64;
      return y >= top && y <= bot;
    });
    if (!sys || x < sys.xStart) return;

    const mOff = Math.floor((x - sys.xStart) / sys.measureWidth);
    const measureIdx = sys.startMeasure + mOff;
    if (measureIdx >= sys.endMeasure) return;
    const xInMeasure = x - (sys.xStart + mOff * sys.measureWidth);
    const beatInMeasure = Math.max(0, Math.min(bpmMeasure - 0.25, Math.round(((xInMeasure - 14) / (sys.measureWidth - 24)) * bpmMeasure * 2) / 2));
    const absBeat = measureIdx * bpmMeasure + beatInMeasure;

    const useBass =
      clefMode === 'bass' ||
      (clefMode === 'grand' && y > sys.trebleTopY + 56);
    const refTop = useBass ? sys.bassTopY : sys.trebleTopY;
    const bottomDia = useBass ? 18 : 30;
    const diatonic = Math.round(bottomDia + (refTop + 40 - y) / 5);
    const oct = Math.floor(diatonic / 7);
    const deg = ((diatonic % 7) + 7) % 7;
    const whiteOffsets = [0, 2, 4, 5, 7, 9, 11];
    const midi = Math.max(36, Math.min(84, (oct + 1) * 12 + whiteOffsets[deg]));

    projectStore.update((s) => {
      const pat = s.patterns.find((p) => p.id === s.activePatternId);
      if (!pat) return;
      if (!pat.notes[channel.id]) pat.notes[channel.id] = [];
      pat.notes[channel.id].push({
        id: uid('sc'),
        midi,
        startBeat: absBeat,
        duration: 1.0,
        velocity: 0.84,
        pan: 0,
      });
    });
    void audioEngine.auditionChannelNote(channel.id, midi, 0.84, 0.35);
  };

  if (!pattern || !channel) return null;

  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minHeight: 0, background: 'var(--bg)' }}>
      {/* Row 1: Sheet Music Source, Upload MIDI & Downloaders (PNG / SVG / PDF / MusicXML / MIDI) */}
      <div className="panel-header" style={{ overflowX: 'auto' }}>
        <span className="panel-title">Sheet Music Engraver</span>

        <button className="sm" onClick={onRequestMidiUpload} title="Upload any .mid file and instantly engrave it as printable sheet music">
          <Upload size={12} /> Upload .mid
        </button>

        <select value={sourceScope} onChange={(e) => setSourceScope(e.target.value as typeof sourceScope)}>
          <option value="channel">Active Channel ({channel.name})</option>
          <option value="all-melodic">All Melodic Tracks (Pattern)</option>
          <option value="full-song">Full Song (Playlist)</option>
        </select>

        {sourceScope === 'channel' && (
          <select
            value={channel.id}
            onChange={(e) => projectStore.update((s) => { s.selectedChannelId = e.target.value; }, false)}
          >
            {project.channels.map((c) => (
              <option key={c.id} value={c.id}>{c.name}</option>
            ))}
          </select>
        )}

        <div className="spacer" />

        <button className="primary sm" onClick={() => void handleDownloadPng()} title="Download high-resolution 300 DPI print sheet music PNG">
          <FileImage size={12} /> Download PNG
        </button>
        <button className="sm" onClick={() => void handleDownloadSvg()} title="Download vector SVG sheet music">
          <FileCode2 size={12} /> SVG
        </button>
        <button className="sm" onClick={handlePrintPdf} title="Print or Save Sheet Music as PDF">
          <Printer size={12} /> Print / PDF
        </button>
        <button className="sm" onClick={() => void handleDownloadMusicXml()} title="Export standard MusicXML for MuseScore, Sibelius, Finale">
          <FileMusic size={12} /> MusicXML
        </button>
        <button
          className="sm"
          onClick={() => {
            const bytes = exportNotesToSmf(notes, project.bpm, scoreTitle);
            triggerBrowserDownload(`${safeFileSlug}.mid`, bytes, 'audio/midi');
          }}
          title="Download MIDI (.mid)"
        >
          <Download size={12} /> .mid
        </button>
      </div>

      {/* Row 2: Engraving Typography, Clef, Key Signature, Paper Mode */}
      <div className="panel-header" style={{ height: 34, background: 'var(--bg-alt)', gap: 8, overflowX: 'auto' }}>
        <input
          type="text"
          value={scoreTitle}
          onChange={(e) => setScoreTitle(e.target.value)}
          placeholder="Sheet title..."
          style={{ width: 165, padding: '3px 7px' }}
        />
        <input
          type="text"
          value={composer}
          onChange={(e) => setComposer(e.target.value)}
          placeholder="Composer..."
          style={{ width: 120, padding: '3px 7px' }}
        />

        <select value={clefMode} onChange={(e) => setClefMode(e.target.value as ClefMode)} title="Staff Clef Layout">
          <option value="grand">Grand Staff (Piano)</option>
          <option value="treble">Treble Clef Only</option>
          <option value="bass">Bass Clef Only</option>
        </select>

        <select value={keySig} onChange={(e) => setKeySig(e.target.value)} title="Key Signature">
          {AVAILABLE_KEY_SIGNATURES.map((k) => (
            <option key={k} value={k}>Key: {k} Major</option>
          ))}
        </select>

        <button
          className="sm"
          onClick={() => {
            const best = detectBestKeySignature(notes);
            setKeySig(best);
            setExportStatus(`Auto-detected key: ${best} Major`);
          }}
          title="Analyze notes and pick the best matching Key Signature"
        >
          Auto Key
        </button>

        <button
          className={showChords ? 'active sm' : 'sm'}
          onClick={() => setShowChords((v) => !v)}
          title="Engrave detected chord symbols above measures"
        >
          Chords
        </button>

        <button
          className={showDynamics ? 'active sm' : 'sm'}
          onClick={() => setShowDynamics((v) => !v)}
          title="Engrave musical dynamic markings (pp..ff) from note velocities"
        >
          Dynamics
        </button>

        <select
          className="mono"
          value={measuresPerSystem}
          onChange={(e) => setMeasuresPerSystem(parseInt(e.target.value, 10))}
          title="Measures per line"
        >
          <option value={2}>2 bars/line</option>
          <option value={4}>4 bars/line</option>
          <option value={6}>6 bars/line</option>
        </select>

        <select
          className="mono"
          value={zoomPct}
          onChange={(e) => setZoomPct(parseInt(e.target.value, 10))}
          title="Sheet Zoom"
        >
          <option value={75}>75%</option>
          <option value={100}>100%</option>
          <option value={125}>125%</option>
        </select>

        <button
          className={paperTheme === 'paper' ? 'active sm' : 'sm'}
          onClick={() => setPaperTheme((t) => (t === 'paper' ? 'dark' : 'paper'))}
          title="Toggle Print Paper (White) vs Dark Studio Score"
        >
          {paperTheme === 'paper' ? <Sun size={11} /> : <Moon size={11} />}
          <span>{paperTheme === 'paper' ? 'Print Paper' : 'Dark View'}</span>
        </button>

        <div className="spacer" />
        {exportStatus && <span className="mono" style={{ fontSize: 10.5, color: 'var(--accent)' }}>{exportStatus}</span>}

        {sourceScope === 'channel' && (
          <button
            className="sm danger-outline"
            onClick={() =>
              projectStore.update((s) => {
                const pat = s.patterns.find((p) => p.id === s.activePatternId);
                if (pat) pat.notes[channel.id] = [];
              })
            }
          >
            <Trash2 size={11} /> Clear
          </button>
        )}
      </div>

      {/* Engraved Sheet Music Page Canvas */}
      <div style={{ flex: 1, overflow: 'auto', padding: 20, background: 'var(--bg)' }}>
        <div
          className="sheet-paper-frame sheet-print-target"
          onClick={handleSheetClick}
          style={{
            position: 'relative',
            width: Math.round((engraved.width * zoomPct) / 100),
            maxWidth: 'none',
            cursor: sourceScope === 'channel' ? 'crosshair' : 'default',
            boxShadow: paperTheme === 'paper' ? '0 10px 30px rgba(0,0,0,0.45)' : 'none',
          }}
          title={sourceScope === 'channel' ? 'Click any line/space on the staff to add a note' : 'Switch to Active Channel to click-add notes'}
        >
          <div
            style={{ width: '100%' }}
            dangerouslySetInnerHTML={{
              __html: engraved.svg.replace(
                `width="${engraved.width}" height="${engraved.height}"`,
                `width="100%" height="auto"`
              ),
            }}
          />

          {/* Live Playback Sweep Indicator */}
          {playheadCoords && (
            <svg
              width="100%"
              height="100%"
              viewBox={`0 0 ${engraved.width} ${engraved.height}`}
              style={{ position: 'absolute', inset: 0, pointerEvents: 'none' }}
            >
              <line
                x1={playheadCoords.x}
                x2={playheadCoords.x}
                y1={playheadCoords.y1}
                y2={playheadCoords.y2}
                stroke="#2f7cf6"
                strokeWidth={2.2}
              />
            </svg>
          )}
        </div>
      </div>
    </div>
  );
};
