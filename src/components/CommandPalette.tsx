import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Search, ArrowRight, X } from 'lucide-react';
import type { ProjectState, WorkspaceTab } from '../types/daw';
import { EFFECT_CATALOG, INSTRUMENT_CATALOG, LOOP_STARTER_LIBRARY } from '../audio/catalog/plugins';
import { createChannel, createEmptySteps, projectStore, uid } from '../state/projectStore';
import { Chord } from '../livecode/musicTheory';
import { audioEngine } from '../audio/engine';

interface CommandPaletteProps {
  project: ProjectState;
  onClose: () => void;
  onNavigateTab: (tab: WorkspaceTab) => void;
  onImportMidi: () => void;
  onOpenExport: () => void;
  onOpenSettings: () => void;
  onHint: (msg: string) => void;
}

interface PaletteItem {
  id: string;
  title: string;
  subtitle: string;
  group: 'View' | 'Action' | 'Generator' | 'Effect Plugin' | 'Loop Starter';
  run: () => void;
}

export const CommandPalette: React.FC<CommandPaletteProps> = ({
  project,
  onClose,
  onNavigateTab,
  onImportMidi,
  onOpenExport,
  onOpenSettings,
  onHint,
}) => {
  const [query, setQuery] = useState('');
  const [activeIdx, setActiveIdx] = useState(0);
  const inputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  const items = useMemo<PaletteItem[]>(() => {
    const out: PaletteItem[] = [
      { id: 'v_rack', title: 'Channel Rack & Step Sequencer', subtitle: 'Switch view', group: 'View', run: () => onNavigateTab('channel-rack') },
      { id: 'v_piano', title: 'Piano Roll Editor', subtitle: 'Switch view', group: 'View', run: () => onNavigateTab('piano-roll') },
      { id: 'v_score', title: 'Sheet Music / Score Engraver', subtitle: 'View & download PNG / SVG / PDF / MusicXML sheet music', group: 'View', run: () => onNavigateTab('score') },
      { id: 'v_playlist', title: 'Playlist & Arrangement', subtitle: 'Switch view', group: 'View', run: () => onNavigateTab('playlist') },
      { id: 'v_mixer', title: 'Console Mixer & FX Rack', subtitle: 'Switch view', group: 'View', run: () => onNavigateTab('mixer') },
      { id: 'v_inst', title: 'Instruments & Beat-Reactive Mod Matrix', subtitle: 'Switch view', group: 'View', run: () => onNavigateTab('instruments') },
      { id: 'v_audio', title: 'Audio Editor, MP3 Chopper & Retro Speech TTS', subtitle: 'Upload MP3/WAV, chop bits, SAM/Robot TTS, Tuner', group: 'View', run: () => onNavigateTab('audio-editor') },
      { id: 'v_perf', title: 'Drummer, Performance Mode & ZGame Visualizer', subtitle: 'Switch view', group: 'View', run: () => onNavigateTab('performance') },
      { id: 'v_code', title: 'JavaScript & Python Live Coding Studio', subtitle: 'Switch view', group: 'View', run: () => onNavigateTab('live-code') },

      { id: 'a_midi', title: 'Upload / Import MIDI File (.mid)', subtitle: 'Smart multi-track MIDI importer -> Piano Roll & Sheet Music', group: 'Action', run: onImportMidi },
      { id: 'a_export', title: 'Export Lossless Audio & Stems', subtitle: 'WAV 32f/24/16, FLAC, AIFF, MP3, OGG', group: 'Action', run: onOpenExport },
      { id: 'a_settings', title: 'Audio, MIDI, Python & Theme Settings', subtitle: 'Switch Totone Studio Pro / Classic themes, WASAPI, MIDI Learn', group: 'Action', run: onOpenSettings },
      { id: 'a_playall', title: 'Play All (Full Mix)', subtitle: 'Play all patterns, song & live code together', group: 'Action', run: () => void audioEngine.playAll() },
      { id: 'a_stop', title: 'Stop & Reset Playhead', subtitle: 'Transport stop', group: 'Action', run: () => audioEngine.stop(true) },
    ];

    for (const inst of INSTRUMENT_CATALOG) {
      out.push({
        id: `inst_${inst.id}`,
        title: `Add ${inst.name}`,
        subtitle: `${inst.category} — ${inst.description}`,
        group: 'Generator',
        run: () => {
          const inserts = project.mixerTracks.filter((m) => m.kind === 'insert');
          projectStore.update((s) => {
            const ch = createChannel({
              name: inst.name,
              engine: inst.baseEngine,
              mixerTrackId: inserts[s.channels.length % inserts.length]?.id || 'mx_1',
              color: '#2f7cf6',
              subPreset: inst.baseEngine === 'SubSynth' ? inst.presetName : undefined,
              fmPreset: inst.baseEngine === 'FMSynth' ? inst.presetName : undefined,
              kitId: inst.kitId,
            });
            ch.pluginId = inst.id;
            ch.pluginName = inst.name;
            s.channels.push(ch);
            for (const p of s.patterns) {
              p.steps[ch.id] = createEmptySteps(p.lengthSteps);
              p.notes[ch.id] = [];
            }
            s.selectedChannelId = ch.id;
          });
          onHint(`Added "${inst.name}" to Channel Rack.`);
          onNavigateTab('instruments');
        },
      });
    }

    for (const fx of EFFECT_CATALOG) {
      out.push({
        id: `fx_${fx.id}`,
        title: `Insert ${fx.name}`,
        subtitle: `${fx.category} — ${fx.description}`,
        group: 'Effect Plugin',
        run: () => {
          const target = project.mixerTracks.find((t) => t.id === project.selectedMixerTrackId) || project.mixerTracks[0];
          if (!target) return;
          projectStore.update((s) => {
            const mx = s.mixerTracks.find((t) => t.id === target.id);
            if (mx) {
              mx.fx.push({
                id: uid('fx'),
                type: fx.dspEngine,
                pluginId: fx.id,
                pluginName: fx.name,
                enabled: true,
                params: { ...fx.defaultParams },
              });
            }
          });
          onHint(`Inserted "${fx.name}" on Mixer track "${target.name}".`);
          onNavigateTab('mixer');
        },
      });
    }

    for (const lp of LOOP_STARTER_LIBRARY) {
      out.push({
        id: `lp_${lp.id}`,
        title: `Load Loop Starter: ${lp.name}`,
        subtitle: `${lp.genre} · ${lp.bpm} BPM`,
        group: 'Loop Starter',
        run: () => {
          projectStore.update((s) => {
            s.bpm = lp.bpm;
            s.swing = lp.swing;
            const pat = s.patterns.find((p) => p.id === s.activePatternId) || s.patterns[0];
            if (!pat) return;
            const kickCh = s.channels.find((c) => c.engine === 'DrumSynth' && c.drumSynth.voice === 'bd');
            const bassCh = s.channels.find((c) => c.engine === 'SubSynth');
            const keysCh = s.channels.find((c) => c.engine === 'SoundFont' || c.engine === 'FMSynth');
            if (kickCh) {
              const arr = createEmptySteps(pat.lengthSteps);
              lp.kickSteps.forEach((i) => { if (arr[i]) arr[i].active = true; });
              pat.steps[kickCh.id] = arr;
            }
            if (bassCh) {
              pat.notes[bassCh.id] = lp.bassNotes.map((n) => ({
                id: uid('lp'), midi: n.midi, startBeat: n.startBeat, duration: n.duration, velocity: 0.88, pan: 0,
              }));
            }
            if (keysCh) {
              const mids = Chord.build(lp.chordRoot, lp.chordQuality);
              pat.notes[keysCh.id] = mids.map((m) => ({
                id: uid('lpc'), midi: m, startBeat: 0, duration: 3.5, velocity: 0.62, pan: 0,
              }));
            }
          });
          onHint(`Loaded Loop Starter "${lp.name}".`);
          void audioEngine.play({ scope: 'pattern-only' });
        },
      });
    }

    return out;
  }, [project, onNavigateTab, onImportMidi, onOpenExport, onOpenSettings, onHint]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return items.slice(0, 18);
    return items
      .filter(
        (it) =>
          it.title.toLowerCase().includes(q) ||
          it.subtitle.toLowerCase().includes(q) ||
          it.group.toLowerCase().includes(q)
      )
      .slice(0, 30);
  }, [items, query]);

  const execute = (item: PaletteItem | undefined) => {
    if (!item) return;
    onClose();
    item.run();
  };

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div
        className="modal-box"
        style={{ width: 'min(580px, 92vw)', maxHeight: '72vh' }}
        onClick={(e) => e.stopPropagation()}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '10px 14px', borderBottom: '1px solid var(--border)', background: 'var(--panel-elev)' }}>
          <Search size={14} color="var(--ink-mute)" />
          <input
            ref={inputRef}
            type="text"
            placeholder="Search tools, 31 generators, 83 effects, MIDI, sheet music..."
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setActiveIdx(0);
            }}
            onKeyDown={(e) => {
              if (e.key === 'Escape') onClose();
              else if (e.key === 'ArrowDown') {
                e.preventDefault();
                setActiveIdx((i) => Math.min(filtered.length - 1, i + 1));
              } else if (e.key === 'ArrowUp') {
                e.preventDefault();
                setActiveIdx((i) => Math.max(0, i - 1));
              } else if (e.key === 'Enter') {
                e.preventDefault();
                execute(filtered[activeIdx]);
              }
            }}
            style={{ flex: 1, border: 'none', background: 'transparent', fontSize: 13, padding: '2px 0' }}
          />
          <button className="icon-only sm" onClick={onClose}>
            <X size={13} />
          </button>
        </div>

        <div style={{ flex: 1, overflow: 'auto', padding: 6 }}>
          {filtered.length === 0 ? (
            <div style={{ padding: 20, textAlign: 'center', color: 'var(--ink-mute)' }}>
              No matching tools, plugins, or commands.
            </div>
          ) : (
            filtered.map((item, idx) => (
              <button
                key={item.id}
                onMouseEnter={() => setActiveIdx(idx)}
                onClick={() => execute(item)}
                style={{
                  width: '100%',
                  justifyContent: 'space-between',
                  padding: '8px 10px',
                  marginBottom: 2,
                  background: idx === activeIdx ? 'var(--accent-soft)' : 'transparent',
                  borderColor: idx === activeIdx ? 'var(--accent)' : 'transparent',
                  textAlign: 'left',
                }}
              >
                <div style={{ minWidth: 0 }}>
                  <div style={{ fontWeight: 600, color: '#ffffff', fontSize: 12 }}>{item.title}</div>
                  <div style={{ fontSize: 10.5, color: 'var(--ink-mute)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {item.subtitle}
                  </div>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6, flex: 'none' }}>
                  <span style={{ fontSize: 10, color: 'var(--ink-dim)', background: 'var(--bg-alt)', padding: '2px 6px', borderRadius: 3 }}>
                    {item.group}
                  </span>
                  <ArrowRight size={11} color="var(--ink-mute)" />
                </div>
              </button>
            ))
          )}
        </div>
      </div>
    </div>
  );
};
