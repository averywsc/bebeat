import React, { useState } from 'react';
import { X, Music, FileText, Check } from 'lucide-react';
import type { InstrumentEngine, Pattern, ProjectState, WorkspaceTab } from '../types/daw';
import type { ParsedMidiFile } from '../audio/midiCodec';
import { createChannel, createEmptySteps, projectStore, uid } from '../state/projectStore';
import { midiToNoteName } from '../livecode/musicTheory';

interface MidiImportModalProps {
  parsed: ParsedMidiFile;
  project: ProjectState;
  onClose: () => void;
  onImported: (targetTab: WorkspaceTab, summary: string) => void;
}

export const MidiImportModal: React.FC<MidiImportModalProps> = ({
  parsed,
  project,
  onClose,
  onImported,
}) => {
  const [selectedTracks, setSelectedTracks] = useState<Record<number, boolean>>(() =>
    Object.fromEntries(parsed.tracks.map((t) => [t.index, true]))
  );
  const [engines, setEngines] = useState<Record<number, InstrumentEngine>>(() =>
    Object.fromEntries(parsed.tracks.map((t) => [t.index, t.recommendedEngine]))
  );
  const [importMode, setImportMode] = useState<'multitrack' | 'active-channel'>('multitrack');
  const [applyTempo, setApplyTempo] = useState(true);
  const [openAfter, setOpenAfter] = useState<'piano-roll' | 'score' | 'playlist'>('score');

  const chosen = parsed.tracks.filter((t) => selectedTracks[t.index]);

  const handleConfirm = () => {
    if (chosen.length === 0) return;

    const totalBars = Math.max(1, Math.ceil(parsed.totalBeats / 4));
    const patSteps: 16 | 32 | 64 = totalBars >= 4 ? 64 : totalBars >= 2 ? 32 : 16;
    const patBeats = patSteps / 4;

    if (importMode === 'active-channel') {
      const merged = chosen
        .flatMap((t) => t.notes)
        .sort((a, b) => a.startBeat - b.startBeat || a.midi - b.midi);
      projectStore.update((s) => {
        if (applyTempo) {
          s.bpm = parsed.bpm;
          s.timeSignature = parsed.timeSignature;
        }
        const pat = s.patterns.find((p) => p.id === s.activePatternId) || s.patterns[0];
        if (!pat) return;
        pat.lengthSteps = patSteps;
        for (const ch of s.channels) {
          const cur = pat.steps[ch.id] || [];
          if (cur.length < patSteps) pat.steps[ch.id] = [...cur, ...createEmptySteps(patSteps).slice(cur.length)];
        }
        pat.notes[s.selectedChannelId] = merged;
      });
      onImported(openAfter, `Imported ${merged.length} MIDI notes from "${parsed.name}" into active channel.`);
      onClose();
      return;
    }

    // Full Multi-Track Song Import: creates channels per MIDI track + splits long songs into clean multi-bar patterns on Playlist!
    projectStore.update((s) => {
      s.name = parsed.name || s.name;
      if (applyTempo) {
        s.bpm = parsed.bpm;
        s.timeSignature = parsed.timeSignature;
      }

      const inserts = s.mixerTracks.filter((m) => m.kind === 'insert');
      const palette = ['#2f7cf6', '#38bdf8', '#a5b4fc', '#4ade80', '#fbbf24', '#f472b6'];
      const newChannelMap = new Map<number, string>();

      chosen.forEach((tr, i) => {
        const eng = engines[tr.index] || tr.recommendedEngine;
        const ch = createChannel({
          name: tr.name.slice(0, 26),
          engine: eng,
          mixerTrackId: inserts[i % inserts.length]?.id || 'mx_1',
          color: palette[i % palette.length],
          subPreset: eng === 'SubSynth' ? tr.recommendedPreset || 'Acid 303 Bass' : undefined,
          fmPreset: eng === 'FMSynth' ? tr.recommendedPreset || 'Electric Tine Keys' : undefined,
          kitId: '808_clean',
        });
        s.channels.push(ch);
        newChannelMap.set(tr.index, ch.id);
      });

      // Split into chunks of 16 beats (4 bars) so long MIDI songs stay editable in Piano Roll AND play end-to-end on Playlist
      const chunkBeats = Math.min(16, Math.max(4, patBeats));
      const chunkSteps: 16 | 32 | 64 = chunkBeats >= 16 ? 64 : chunkBeats >= 8 ? 32 : 16;
      const numChunks = Math.max(1, Math.ceil(parsed.totalBeats / chunkBeats));

      const createdPats: Pattern[] = [];
      for (let c = 0; c < numChunks; c++) {
        const cStart = c * chunkBeats;
        const cEnd = cStart + chunkBeats;
        const pat: Pattern = {
          id: uid('mpat'),
          name: numChunks === 1 ? `${parsed.name}` : `${parsed.name} (Bars ${c * (chunkBeats / 4) + 1}-${(c + 1) * (chunkBeats / 4)})`,
          lengthSteps: chunkSteps,
          steps: Object.fromEntries(s.channels.map((ch) => [ch.id, createEmptySteps(chunkSteps)])),
          notes: Object.fromEntries(s.channels.map((ch) => [ch.id, []])),
        };

        for (const tr of chosen) {
          const chId = newChannelMap.get(tr.index);
          if (!chId) continue;
          pat.notes[chId] = tr.notes
            .filter((n) => n.startBeat >= cStart - 0.001 && n.startBeat < cEnd - 0.001)
            .map((n) => ({
              ...n,
              id: uid('mn'),
              startBeat: Math.max(0, n.startBeat - cStart),
            }));
        }

        s.patterns.push(pat);
        createdPats.push(pat);
      }

      if (createdPats[0]) {
        s.activePatternId = createdPats[0].id;
      }
      const firstMelodic = chosen.find((t) => !t.isPercussion) || chosen[0];
      const firstChId = firstMelodic ? newChannelMap.get(firstMelodic.index) : undefined;
      if (firstChId) s.selectedChannelId = firstChId;

      // Place full song arrangement on Playlist Track 1
      s.playlistClips = createdPats.map((p, idx) => ({
        id: uid('mclip'),
        trackIndex: 1,
        kind: 'pattern',
        patternId: p.id,
        label: p.name,
        startBeat: idx * chunkBeats,
        durationBeats: chunkBeats,
        offsetBeats: 0,
        muted: false,
      }));
      s.loopStartBeat = 0;
      s.loopEndBeat = Math.max(16, numChunks * chunkBeats);
    });

    const totalNotes = chosen.reduce((sum, t) => sum + t.noteCount, 0);
    onImported(
      openAfter,
      `Imported "${parsed.name}" (${chosen.length} tracks, ${totalNotes} notes, ${parsed.bpm} BPM).`
    );
    onClose();
  };

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal-box" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <div>
            <div className="panel-title">Import MIDI File — {parsed.name}.mid</div>
            <div className="mono" style={{ fontSize: 10.5, color: 'var(--ink-mute)', marginTop: 2 }}>
              {parsed.tracks.length} tracks · {parsed.bpm} BPM · {parsed.timeSignature[0]}/{parsed.timeSignature[1]} · {Math.ceil(parsed.totalBeats / 4)} bars
            </div>
          </div>
          <button className="icon-only sm" onClick={onClose}>
            <X size={14} />
          </button>
        </div>

        <div className="modal-body">
          <div className="kv-grid">
            <label className="field-label">
              Import Mode
              <select value={importMode} onChange={(e) => setImportMode(e.target.value as typeof importMode)}>
                <option value="multitrack">Full Multi-Track Song (Channels + Patterns + Playlist)</option>
                <option value="active-channel">Merge Selected Tracks into Active Channel</option>
              </select>
            </label>

            <label className="field-label">
              Open After Import
              <select value={openAfter} onChange={(e) => setOpenAfter(e.target.value as typeof openAfter)}>
                <option value="score">Sheet Music View (View &amp; Download Sheet Music)</option>
                <option value="piano-roll">Piano Roll Editor</option>
                <option value="playlist">Playlist Arrangement</option>
              </select>
            </label>
          </div>

          <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer', color: 'var(--ink)' }}>
            <input type="checkbox" checked={applyTempo} onChange={(e) => setApplyTempo(e.target.checked)} />
            <span>Apply MIDI tempo ({parsed.bpm} BPM) and time signature ({parsed.timeSignature[0]}/{parsed.timeSignature[1]})</span>
          </label>

          <div className="inst-section" style={{ maxHeight: 260, overflow: 'auto' }}>
            <div className="inst-section-title">MIDI Tracks ({chosen.length} / {parsed.tracks.length} selected)</div>
            {parsed.tracks.map((tr) => (
              <div
                key={tr.index}
                style={{
                  display: 'grid',
                  gridTemplateColumns: '22px 1fr 125px 120px',
                  alignItems: 'center',
                  gap: 8,
                  padding: '6px 0',
                  borderBottom: '1px solid var(--border)',
                }}
              >
                <input
                  type="checkbox"
                  checked={Boolean(selectedTracks[tr.index])}
                  onChange={(e) => setSelectedTracks({ ...selectedTracks, [tr.index]: e.target.checked })}
                />
                <div style={{ minWidth: 0 }}>
                  <div style={{ fontWeight: 600, color: '#ffffff', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {tr.name}
                  </div>
                  <div className="mono" style={{ fontSize: 10, color: 'var(--ink-mute)' }}>
                    {tr.instrumentName} · {midiToNoteName(tr.minMidi)}–{midiToNoteName(tr.maxMidi)}
                  </div>
                </div>
                <span className="mono" style={{ fontSize: 10.5, color: 'var(--ink-dim)', textAlign: 'right' }}>
                  {tr.noteCount} notes
                </span>
                <select
                  value={engines[tr.index] || tr.recommendedEngine}
                  disabled={importMode === 'active-channel'}
                  onChange={(e) => setEngines({ ...engines, [tr.index]: e.target.value as InstrumentEngine })}
                  style={{ padding: '3px 6px' }}
                >
                  <option value="SoundFont">SoundFont</option>
                  <option value="SubSynth">SubSynth</option>
                  <option value="FMSynth">FMSynth</option>
                  <option value="DrumSynth">DrumSynth</option>
                </select>
              </div>
            ))}
          </div>
        </div>

        <div className="modal-footer">
          <button onClick={onClose}>Cancel</button>
          <button className="primary" disabled={chosen.length === 0} onClick={handleConfirm}>
            {openAfter === 'score' ? <FileText size={13} /> : <Music size={13} />}
            <span>
              <Check size={11} style={{ display: 'none' }} />
              Import {chosen.length} Track{chosen.length === 1 ? '' : 's'}
            </span>
          </button>
        </div>
      </div>
    </div>
  );
};
