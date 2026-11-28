import React, { useMemo, useState } from 'react';
import {
  Search,
  Plus,
  Play,
  Folder,
  Cpu,
  Layers,
  Disc3,
  BookOpen,
} from 'lucide-react';
import type { ProjectState } from '../types/daw';
import {
  EFFECT_CATALOG,
  INSTRUMENT_CATALOG,
  LOOP_STARTER_LIBRARY,
  type EffectCatalogItem,
  type InstrumentCatalogItem,
  type LoopStarterItem,
} from '../audio/catalog/plugins';
import { FM_SYNTH_PRESETS, SUB_SYNTH_PRESETS } from '../state/presets';
import { createChannel, createEmptySteps, projectStore, uid } from '../state/projectStore';
import { Chord } from '../livecode/musicTheory';
import { audioEngine } from '../audio/engine';

interface BrowserSidebarProps {
  project: ProjectState;
  onHint: (msg: string) => void;
  onSelectTab: (tab: 'channel-rack' | 'mixer' | 'instruments' | 'playlist' | 'audio-editor') => void;
}

type BrowserSection = 'plugins' | 'loops' | 'library' | 'files' | 'project';

export const BrowserSidebar: React.FC<BrowserSidebarProps> = ({ project, onHint, onSelectTab }) => {
  const [section, setSection] = useState<BrowserSection>('plugins');
  const [pluginSub, setPluginSub] = useState<'instruments' | 'effects'>('instruments');
  const [query, setQuery] = useState('');

  const q = query.trim().toLowerCase();

  const filteredInstruments = useMemo(
    () =>
      INSTRUMENT_CATALOG.filter(
        (i) =>
          !q ||
          i.name.toLowerCase().includes(q) ||
          i.category.toLowerCase().includes(q) ||
          i.description.toLowerCase().includes(q) ||
          i.tags.some((t) => t.includes(q))
      ),
    [q]
  );

  const filteredEffects = useMemo(
    () =>
      EFFECT_CATALOG.filter(
        (e) =>
          !q ||
          e.name.toLowerCase().includes(q) ||
          e.category.toLowerCase().includes(q) ||
          e.description.toLowerCase().includes(q)
      ),
    [q]
  );

  const instantiateInstrument = (item: InstrumentCatalogItem) => {
    const insertTracks = project.mixerTracks.filter((m) => m.kind === 'insert');
    projectStore.update((s) => {
      const palette = ['#E2E8F0', '#60A5FA', '#38BDF8', '#93C5FD', '#A5B4FC', '#CBD5E1'];
      const ch = createChannel({
        name: item.name,
        engine: item.baseEngine,
        mixerTrackId: insertTracks[s.channels.length % insertTracks.length]?.id || 'mx_1',
        color: palette[s.channels.length % palette.length],
        subPreset: item.baseEngine === 'SubSynth' ? item.presetName : undefined,
        fmPreset: item.baseEngine === 'FMSynth' ? item.presetName : undefined,
        kitId: item.kitId,
      });
      ch.pluginId = item.id;
      ch.pluginName = item.name;
      if (item.id === 'layer') {
        ch.layerChildIds = s.channels.filter((c) => c.engine !== 'DrumSynth').slice(0, 2).map((c) => c.id);
      }
      s.channels.push(ch);
      for (const pat of s.patterns) {
        pat.steps[ch.id] = createEmptySteps(pat.lengthSteps);
        pat.notes[ch.id] = [];
      }
      s.selectedChannelId = ch.id;
    });
    onHint(`Added generator "${item.name}" to Channel Rack.`);
    onSelectTab('instruments');
  };

  const insertEffectOnSelectedMixer = (fx: EffectCatalogItem) => {
    const targetTrack =
      project.mixerTracks.find((t) => t.id === project.selectedMixerTrackId) || project.mixerTracks[0];
    if (!targetTrack) return;
    projectStore.update((s) => {
      const mx = s.mixerTracks.find((t) => t.id === targetTrack.id);
      if (!mx) return;
      mx.fx.push({
        id: uid('fx'),
        type: fx.dspEngine,
        pluginId: fx.id,
        pluginName: fx.name,
        enabled: true,
        params: { ...fx.defaultParams },
      });
    });
    onHint(`Inserted "${fx.name}" on Mixer track "${targetTrack.name}".`);
    onSelectTab('mixer');
  };

  const applyLoopStarter = (loop: LoopStarterItem) => {
    projectStore.update((s) => {
      s.bpm = loop.bpm;
      s.swing = loop.swing;
      const pat = s.patterns.find((p) => p.id === s.activePatternId) || s.patterns[0];
      if (!pat) return;
      pat.lengthSteps = 16;

      const kickCh = s.channels.find((c) => c.engine === 'DrumSynth' && c.drumSynth.voice === 'bd');
      const snCh = s.channels.find((c) => c.engine === 'DrumSynth' && (c.drumSynth.voice === 'cp' || c.drumSynth.voice === 'sn'));
      const hhCh = s.channels.find((c) => c.engine === 'DrumSynth' && c.drumSynth.voice === 'hh');
      const bassCh = s.channels.find((c) => c.engine === 'SubSynth');
      const keysCh = s.channels.find((c) => c.engine === 'SoundFont' || c.engine === 'FMSynth');

      if (kickCh) {
        kickCh.drumSynth.kitId = loop.kitId;
        const arr = createEmptySteps(16);
        loop.kickSteps.forEach((i) => { if (arr[i]) arr[i].active = true; });
        pat.steps[kickCh.id] = arr;
      }
      if (snCh) {
        snCh.drumSynth.kitId = loop.kitId;
        const arr = createEmptySteps(16);
        loop.snareSteps.forEach((i) => { if (arr[i]) arr[i].active = true; });
        pat.steps[snCh.id] = arr;
      }
      if (hhCh) {
        hhCh.drumSynth.kitId = loop.kitId;
        const arr = createEmptySteps(16);
        loop.hatSteps.forEach((i) => { if (arr[i]) arr[i].active = true; });
        pat.steps[hhCh.id] = arr;
      }
      if (bassCh) {
        pat.notes[bassCh.id] = loop.bassNotes.map((n) => ({
          id: uid('lp'),
          midi: n.midi,
          startBeat: n.startBeat,
          duration: n.duration,
          velocity: 0.88,
          pan: 0,
        }));
      }
      if (keysCh) {
        const chordMids = Chord.build(loop.chordRoot, loop.chordQuality);
        pat.notes[keysCh.id] = chordMids.map((m, idx) => ({
          id: uid('lpc'),
          midi: m,
          startBeat: 0,
          duration: 3.5,
          velocity: 0.65 - idx * 0.04,
          pan: (idx - 1.5) * 0.08,
        }));
      }
    });
    onHint(`Loaded Loop Starter "${loop.name}" (${loop.bpm} BPM).`);
    void audioEngine.play({ scope: 'pattern-only' });
  };

  const loadedBuffers = audioEngine.listAllLoadedBuffers();

  return (
    <aside className="panel-col" style={{ width: 'clamp(216px, 18vw, 248px)', flex: 'none' }}>
      <div
        style={{
          flex: 'none',
          display: 'grid',
          gridTemplateColumns: 'repeat(5, minmax(0, 1fr))',
          gap: 3,
          padding: '5px 6px',
          background: 'var(--panel)',
          borderBottom: '1px solid var(--border)',
        }}
      >
        {(
          [
            { id: 'plugins', short: 'FX', label: 'Plugins & Instruments', icon: Cpu },
            { id: 'loops', short: 'Loops', label: 'Loop Starters', icon: Disc3 },
            { id: 'library', short: 'Lib', label: 'Sound Library', icon: BookOpen },
            { id: 'files', short: 'Files', label: 'Audio Files', icon: Folder },
            { id: 'project', short: 'Proj', label: 'Project Overview', icon: Layers },
          ] as const
        ).map((tab) => {
          const Icon = tab.icon;
          return (
            <button
              key={tab.id}
              className={section === tab.id ? 'active sm' : 'sm'}
              style={{
                flexDirection: 'column',
                gap: 2,
                padding: '4px 2px',
                fontSize: 9.5,
                minWidth: 0,
              }}
              onClick={() => setSection(tab.id)}
              title={tab.label}
            >
              <Icon size={11} />
              <span>{tab.short}</span>
            </button>
          );
        })}
      </div>

      {/* Search bar */}
      <div style={{ padding: '6px 8px', borderBottom: '1px solid var(--border)', display: 'flex', alignItems: 'center', gap: 6 }}>
        <Search size={12} color="#64748B" />
        <input
          type="search"
          placeholder={`Search ${section}...`}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          style={{ flex: 1, padding: '4px 6px' }}
        />
      </div>

      {/* Plugin Database */}
      {section === 'plugins' && (
        <>
          <div style={{ padding: '6px 8px', borderBottom: '1px solid var(--border)', display: 'flex', gap: 4 }}>
            <button
              className={pluginSub === 'instruments' ? 'active sm' : 'sm'}
              style={{ flex: 1 }}
              onClick={() => setPluginSub('instruments')}
            >
              Generators ({INSTRUMENT_CATALOG.length})
            </button>
            <button
              className={pluginSub === 'effects' ? 'active sm' : 'sm'}
              style={{ flex: 1 }}
              onClick={() => setPluginSub('effects')}
            >
              Effects ({EFFECT_CATALOG.length})
            </button>
          </div>
          <div className="panel-scroll" style={{ padding: 8 }}>
            {pluginSub === 'instruments'
              ? filteredInstruments.map((inst) => (
                  <button
                    key={inst.id}
                    className="preset-item"
                    onMouseEnter={() => onHint(`${inst.name} — ${inst.description}`)}
                    onClick={() => instantiateInstrument(inst)}
                  >
                    <div style={{ display: 'flex', justifyContent: 'space-between', width: '100%' }}>
                      <span style={{ fontWeight: 600, color: '#FFFFFF' }}>{inst.name}</span>
                      <span style={{ fontSize: 9.5, color: '#60A5FA' }}>{inst.category}</span>
                    </div>
                    <span style={{ fontSize: 10.5, color: '#94A3B8', whiteSpace: 'normal', lineHeight: 1.3 }}>
                      {inst.description}
                    </span>
                  </button>
                ))
              : filteredEffects.map((fx) => (
                  <button
                    key={fx.id}
                    className="preset-item"
                    onMouseEnter={() => onHint(`${fx.name} (${fx.category}) — ${fx.description}`)}
                    onClick={() => insertEffectOnSelectedMixer(fx)}
                  >
                    <div style={{ display: 'flex', justifyContent: 'space-between', width: '100%' }}>
                      <span style={{ fontWeight: 600, color: '#FFFFFF' }}>{fx.name}</span>
                      <span style={{ fontSize: 9.5, color: '#60A5FA' }}>{fx.category.split(' ')[0]}</span>
                    </div>
                    <span style={{ fontSize: 10.5, color: '#94A3B8', whiteSpace: 'normal', lineHeight: 1.3 }}>
                      {fx.description}
                    </span>
                  </button>
                ))}
          </div>
        </>
      )}

      {/* Loop Browser + Loop Starter */}
      {section === 'loops' && (
        <div className="panel-scroll" style={{ padding: 8 }}>
          <div style={{ fontSize: 10.5, color: '#94A3B8', marginBottom: 8 }}>
            Click any Loop Starter to load a full drums + bass + chords groove immediately.
          </div>
          {LOOP_STARTER_LIBRARY.filter(
            (l) => !q || l.name.toLowerCase().includes(q) || l.genre.toLowerCase().includes(q)
          ).map((loop) => (
            <button
              key={loop.id}
              className="preset-item"
              onClick={() => applyLoopStarter(loop)}
              onMouseEnter={() => onHint(`Loop Starter: ${loop.name} (${loop.bpm} BPM, ${loop.kitId})`)}
            >
              <div style={{ display: 'flex', justifyContent: 'space-between', width: '100%' }}>
                <span style={{ fontWeight: 600, color: '#FFFFFF' }}>{loop.name}</span>
                <span className="mono" style={{ fontSize: 10, color: '#60A5FA' }}>{loop.bpm} BPM</span>
              </div>
              <span style={{ fontSize: 10.5, color: '#94A3B8' }}>
                {loop.genre} · Kit: {loop.kitId} · {loop.chordRoot} {loop.chordQuality}
              </span>
            </button>
          ))}
        </div>
      )}

      {/* Sound Library / Patch Browser */}
      {section === 'library' && (
        <div className="panel-scroll" style={{ padding: 8 }}>
          <div style={{ fontSize: 10.5, fontWeight: 700, color: '#FFFFFF', marginBottom: 6 }}>SubSynth Patches</div>
          {Object.values(SUB_SYNTH_PRESETS)
            .filter((p) => !q || p.presetName.toLowerCase().includes(q))
            .map((p) => (
              <button
                key={p.presetName}
                className="preset-item"
                onClick={() => {
                  projectStore.update((s) => {
                    const ch = s.channels.find((c) => c.id === s.selectedChannelId);
                    if (ch) {
                      ch.engine = 'SubSynth';
                      ch.subSynth = JSON.parse(JSON.stringify(p));
                    }
                  });
                  void audioEngine.auditionChannelNote(project.selectedChannelId, 48, 0.85, 0.35);
                  onHint(`Loaded SubSynth patch "${p.presetName}" onto active channel.`);
                }}
              >
                <span style={{ fontWeight: 600, color: '#FFFFFF' }}>{p.presetName}</span>
                <span style={{ fontSize: 10, color: '#94A3B8' }}>
                  {p.osc1Wave} + {p.osc2Wave} · {p.unisonVoices}v unison
                </span>
              </button>
            ))}

          <div style={{ fontSize: 10.5, fontWeight: 700, color: '#FFFFFF', margin: '10px 0 6px' }}>FMSynth Patches</div>
          {Object.values(FM_SYNTH_PRESETS)
            .filter((p) => !q || p.presetName.toLowerCase().includes(q))
            .map((p) => (
              <button
                key={p.presetName}
                className="preset-item"
                onClick={() => {
                  projectStore.update((s) => {
                    const ch = s.channels.find((c) => c.id === s.selectedChannelId);
                    if (ch) {
                      ch.engine = 'FMSynth';
                      ch.fmSynth = JSON.parse(JSON.stringify(p));
                    }
                  });
                  void audioEngine.auditionChannelNote(project.selectedChannelId, 60, 0.85, 0.35);
                  onHint(`Loaded FMSynth patch "${p.presetName}" onto active channel.`);
                }}
              >
                <span style={{ fontWeight: 600, color: '#FFFFFF' }}>{p.presetName}</span>
                <span style={{ fontSize: 10, color: '#94A3B8' }}>
                  4-Op Alg {p.algorithm} · Index {p.modIndex}
                </span>
              </button>
            ))}
        </div>
      )}

      {/* File Browser (24-bit Kits, Wavetables, SoundFonts, Recorded Takes) */}
      {section === 'files' && (
        <div className="panel-scroll" style={{ padding: 8 }}>
          <div style={{ fontSize: 10.5, color: '#94A3B8', marginBottom: 6 }}>
            Bundled 24-bit WAV kits, wavetables &amp; imported audio ({loadedBuffers.length} loaded).
          </div>
          {loadedBuffers
            .filter((b) => !q || b.key.toLowerCase().includes(q))
            .map((b) => (
              <div
                key={b.key}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 6,
                  padding: '5px 6px',
                  borderBottom: '1px solid var(--border)',
                }}
              >
                <button
                  className="sm icon-only"
                  onClick={() => {
                    const buf = audioEngine.getKitBuffer(b.key);
                    if (buf) void audioEngine.playBufferOnce(buf);
                  }}
                  title="Audition Sample"
                >
                  <Play size={10} />
                </button>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 11, color: '#FFFFFF', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                    {b.key.replace(/^kits\//, '')}
                  </div>
                  <div className="mono" style={{ fontSize: 9.5, color: '#64748B' }}>
                    {b.durationSec.toFixed(2)}s · {b.sampleRate} Hz
                  </div>
                </div>
                <button
                  className="sm icon-only"
                  onClick={() => {
                    projectStore.update((s) => {
                      const ch = s.channels.find((c) => c.id === s.selectedChannelId);
                      if (ch) {
                        ch.engine = 'Sampler';
                        ch.sampler.assetPath = b.key;
                        ch.sampler.sampleName = b.key;
                      }
                    });
                    onHint(`Loaded "${b.key}" into Sampler.`);
                  }}
                  title="Load into active Sampler channel"
                >
                  <Plus size={10} />
                </button>
              </div>
            ))}
        </div>
      )}

      {/* Project Browser & Session NoteBook */}
      {section === 'project' && (
        <div className="panel-scroll" style={{ padding: 8 }}>
          <div style={{ fontSize: 10.5, fontWeight: 700, color: '#FFFFFF', marginBottom: 5 }}>
            Patterns ({project.patterns.length})
          </div>
          {project.patterns.map((p) => (
            <button
              key={p.id}
              className={`preset-item ${p.id === project.activePatternId ? 'active' : ''}`}
              onClick={() => projectStore.update((s) => { s.activePatternId = p.id; }, false)}
            >
              <span>{p.name}</span>
            </button>
          ))}

          <div style={{ fontSize: 10.5, fontWeight: 700, color: '#FFFFFF', margin: '10px 0 5px' }}>
            Session NoteBook
          </div>
          <textarea
            value={project.notebookText}
            onChange={(e) => projectStore.update((s) => { s.notebookText = e.target.value; }, false)}
            style={{
              width: '100%',
              height: 120,
              background: 'var(--bg)',
              color: '#F8FAFC',
              border: '1px solid var(--border)',
              borderRadius: 4,
              padding: 7,
              fontFamily: 'var(--font-mono)',
              fontSize: 11,
              resize: 'vertical',
              userSelect: 'text',
            }}
          />
        </div>
      )}
    </aside>
  );
};
