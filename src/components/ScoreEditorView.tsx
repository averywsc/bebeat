import React, { useEffect, useState } from 'react';
import { Trash2, Download } from 'lucide-react';
import type { ProjectState } from '../types/daw';
import { projectStore, uid } from '../state/projectStore';
import { midiToNoteName } from '../livecode/musicTheory';
import { audioEngine } from '../audio/engine';
import { exportNotesToSmf } from '../audio/midiCodec';
import { triggerBrowserDownload } from '../services/bridge';

interface ScoreEditorViewProps {
  project: ProjectState;
}

// Map MIDI pitch to vertical staff Y position (Grand Staff: Treble E4..F5, Bass G2..A3)
const STEP_PER_DIATONIC = 5;
const TREBLE_BOTTOM_Y = 140; // E4 (diatonic index 28)
const C4_DIATONIC = 28;
const PITCH_CLASS_TO_DIATONIC = [0, 0, 1, 1, 2, 3, 3, 4, 4, 5, 5, 6];
const IS_SHARP = [false, true, false, true, false, false, true, false, true, false, true, false];

function midiToStaffY(midi: number): { y: number; sharp: boolean; diatonic: number } {
  const oct = Math.floor(midi / 12) - 1;
  const pc = midi % 12;
  const diatonic = oct * 7 + PITCH_CLASS_TO_DIATONIC[pc];
  // Treble E4 = oct 4 * 7 + 2 = 30
  const y = TREBLE_BOTTOM_Y - (diatonic - 30) * STEP_PER_DIATONIC;
  return { y, sharp: IS_SHARP[pc], diatonic };
}

export const ScoreEditorView: React.FC<ScoreEditorViewProps> = ({ project }) => {
  const [playBeat, setPlayBeat] = useState(-1);
  const pattern = project.patterns.find((p) => p.id === project.activePatternId) || project.patterns[0];
  const channel = project.channels.find((c) => c.id === project.selectedChannelId) || project.channels[0];
  const notes = (pattern && channel && pattern.notes[channel.id]) || [];
  const totalBeats = Math.max(4, (pattern?.lengthSteps ?? 16) / 4);

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

  const leftMargin = 82;
  const pxPerBeat = 140;
  const svgW = Math.max(820, leftMargin + totalBeats * pxPerBeat + 40);
  const svgH = 340;

  const handleStaffClick = (e: React.MouseEvent<SVGSVGElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    if (x < leftMargin) return;
    const beat = Math.max(0, Math.round(((x - leftMargin) / pxPerBeat) * 4) / 4);
    const diatonic = Math.round(30 - (y - TREBLE_BOTTOM_Y) / STEP_PER_DIATONIC);
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
        startBeat: beat,
        duration: 0.5,
        velocity: 0.82,
        pan: 0,
      });
    });
    void audioEngine.auditionChannelNote(channel.id, midi, 0.82, 0.3);
  };

  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minHeight: 0, background: '#080C18' }}>
      <div className="panel-header">
        <span className="panel-title">Score Notation Editor</span>
        <select
          value={channel.id}
          onChange={(e) => projectStore.update((s) => { s.selectedChannelId = e.target.value; }, false)}
        >
          {project.channels.map((c) => (
            <option key={c.id} value={c.id}>{c.name}</option>
          ))}
        </select>
        <span style={{ fontSize: 11, color: '#94A3B8' }}>
          Click anywhere on the Grand Staff to insert notes · Two-way synced with Piano Roll
        </span>
        <div className="spacer" />
        <button
          className="sm"
          onClick={() => {
            const bytes = exportNotesToSmf(notes, project.bpm, channel.name);
            triggerBrowserDownload(`${channel.name.toLowerCase().replace(/\s+/g, '_')}.mid`, bytes, 'audio/midi');
          }}
        >
          <Download size={12} /> Export MIDI
        </button>
        <button
          className="sm danger-outline"
          onClick={() =>
            projectStore.update((s) => {
              const pat = s.patterns.find((p) => p.id === s.activePatternId);
              if (pat) pat.notes[channel.id] = [];
            })
          }
        >
          <Trash2 size={12} /> Clear Staff
        </button>
      </div>

      <div style={{ flex: 1, overflow: 'auto', padding: 16 }}>
        <svg
          width={svgW}
          height={svgH}
          onClick={handleStaffClick}
          style={{
            background: '#0E1528',
            border: '1px solid #24324D',
            borderRadius: 4,
            cursor: 'crosshair',
            display: 'block',
          }}
        >
          {/* Treble Staff 5 lines (E4, G4, B4, D5, F5 -> y = 140, 130, 120, 110, 100) */}
          {[0, 1, 2, 3, 4].map((i) => (
            <line
              key={`tr_${i}`}
              x1={24}
              x2={svgW - 24}
              y1={TREBLE_BOTTOM_Y - i * 10}
              y2={TREBLE_BOTTOM_Y - i * 10}
              stroke="#2E3F61"
              strokeWidth={1.1}
            />
          ))}

          {/* Bass Staff 5 lines (G2, B2, D3, F3, A3 -> y = 210, 200, 190, 180, 170) */}
          {[0, 1, 2, 3, 4].map((i) => (
            <line
              key={`bs_${i}`}
              x1={24}
              x2={svgW - 24}
              y1={210 - i * 10}
              y2={210 - i * 10}
              stroke="#2E3F61"
              strokeWidth={1.1}
            />
          ))}

          {/* Clef Labels */}
          <text x={32} y={128} fill="#FFFFFF" fontSize={14} fontWeight={700}>TREBLE</text>
          <text x={36} y={198} fill="#94A3B8" fontSize={14} fontWeight={700}>BASS</text>

          {/* Measure Barlines */}
          {Array.from({ length: Math.ceil(totalBeats / 4) + 1 }, (_, bar) => {
            const x = leftMargin + bar * 4 * pxPerBeat;
            return (
              <g key={`bar_${bar}`}>
                <line x1={x} x2={x} y1={100} y2={210} stroke="#3B4F7A" strokeWidth={1.2} />
                <text x={x + 4} y={88} fill="#64748B" fontSize={10} fontFamily="var(--font-mono)">
                  {bar + 1}
                </text>
              </g>
            );
          })}

          {/* Notes */}
          {notes.map((n) => {
            const { y, sharp } = midiToStaffY(n.midi);
            const x = leftMargin + n.startBeat * pxPerBeat + 10;
            const isHalfOrWhole = n.duration >= 1.5;
            const isEighth = n.duration <= 0.5;
            const clampedY = Math.max(40, Math.min(svgH - 30, y));
            return (
              <g
                key={n.id}
                onClick={(e) => {
                  e.stopPropagation();
                  void audioEngine.auditionChannelNote(channel.id, n.midi, n.velocity, 0.3);
                }}
                onContextMenu={(e) => {
                  e.preventDefault();
                  projectStore.update((s) => {
                    const pat = s.patterns.find((p) => p.id === s.activePatternId);
                    if (pat) pat.notes[channel.id] = pat.notes[channel.id].filter((x) => x.id !== n.id);
                  });
                }}
              >
                {/* Middle C ledger line if near C4 */}
                {n.midi === 60 && (
                  <line x1={x - 10} x2={x + 10} y1={clampedY} y2={clampedY} stroke="#94A3B8" strokeWidth={1.2} />
                )}
                {sharp && (
                  <text x={x - 15} y={clampedY + 4} fill="#60A5FA" fontSize={12} fontFamily="var(--font-mono)">
                    #
                  </text>
                )}
                <ellipse
                  cx={x}
                  cy={clampedY}
                  rx={6}
                  ry={4.5}
                  fill={isHalfOrWhole ? '#0E1528' : '#FFFFFF'}
                  stroke="#FFFFFF"
                  strokeWidth={1.6}
                  transform={`rotate(-18 ${x} ${clampedY})`}
                />
                {n.duration < 3.5 && (
                  <line
                    x1={x + 5.5}
                    x2={x + 5.5}
                    y1={clampedY}
                    y2={clampedY - 30}
                    stroke="#FFFFFF"
                    strokeWidth={1.3}
                  />
                )}
                {isEighth && (
                  <path
                    d={`M ${x + 5.5} ${clampedY - 30} Q ${x + 14} ${clampedY - 24} ${x + 11} ${clampedY - 14}`}
                    fill="none"
                    stroke="#FFFFFF"
                    strokeWidth={1.4}
                  />
                )}
                <title>{`${midiToNoteName(n.midi)} (Beat ${n.startBeat.toFixed(2)}, Dur ${n.duration.toFixed(2)}) — Right-click to delete`}</title>
              </g>
            );
          })}

          {/* Playhead */}
          {playBeat >= 0 && (
            <line
              x1={leftMargin + playBeat * pxPerBeat}
              x2={leftMargin + playBeat * pxPerBeat}
              y1={80}
              y2={230}
              stroke="#60A5FA"
              strokeWidth={1.8}
            />
          )}
        </svg>
      </div>
    </div>
  );
};
