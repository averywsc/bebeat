import React, { useState } from 'react';
import {
  Plus,
  FolderOpen,
  Trash2,
  ArrowRight,
  BookOpen,
  Clock,
  Music,
  Code2,
  Sliders,
  Mic,
  Keyboard,
} from 'lucide-react';
import type { ProjectState, WorkspaceTab } from '../types/daw';
import {
  createTemplateProject,
  deleteRecentProject,
  listRecentProjects,
  type RecentProjectRecord,
} from '../state/recentProjects';

interface HomeScreenProps {
  hasActiveSession: boolean;
  currentProjectName: string;
  onResumeCurrent: () => void;
  onLaunchProject: (state: ProjectState, recordId?: string, initialTab?: WorkspaceTab) => void;
  onOpenProjectFile: () => Promise<void>;
}

const TEMPLATES: Array<{
  id: string;
  name: string;
  bpm: number;
  desc: string;
  tab?: WorkspaceTab;
}> = [
  { id: 'blank', name: 'Empty Project', bpm: 128, desc: 'Clean 16-step rack with synths, drums, and mixer ready to build from scratch.' },
  { id: 'studio-groove', name: 'Main Studio Groove', bpm: 128, desc: 'Pre-loaded 808 kit, Acid 303 bass, FM arp, and SoundFont EPiano.' },
  { id: 'loop-trap', name: 'Dark 808 Trap', bpm: 142, desc: 'Hard 808 pattern, rolling hi-hats, sub-bass line, and minor-7 chords.' },
  { id: 'loop-ukg', name: 'UK Garage 2-Step', bpm: 134, desc: 'Swung 2-step pocket, tight UKG kit, and warm minor-9 keys.' },
  { id: 'loop-lofi', name: 'Lo-Fi Boom Bap', bpm: 86, desc: 'Dusty swung groove with chill major-7 chords and mellow sub.' },
  { id: 'studio-groove-code', name: 'Live Coding Studio', bpm: 128, desc: 'Jump straight into JavaScript & Python live coding with presets and AST previews.', tab: 'live-code' },
];

const GUIDE_SECTIONS = [
  {
    id: 'start',
    title: '1. Quick Start',
    icon: Music,
    steps: [
      'Pick a template or Empty Project to open the studio. Press Space to play only the tab you are editing, or Shift+Space (Play All) to hear the entire mix together.',
      'In the Channel Rack, click step buttons to build drum grooves, use Quick Fill (4-on-Floor, 2-Step, Euclid 5/16) for instant rhythms, or open Graph Editor to draw per-step velocity and pitch.',
      'Open the left Browser Sidebar anytime to browse 31 Generators (FLEX, Harmor, Transistor Bass, Sakura, FPC, Drummer, Strings, Guitar), 83 Effect Plugins, Loop Starters, and 24-bit WAV kits.',
    ],
  },
  {
    id: 'piano',
    title: '2. Playing & Recording Piano',
    icon: Keyboard,
    steps: [
      'Play any selected instrument straight from your PC keyboard: Z S X D C V G B H N J M , for the lower octave and Q 2 W 3 E R 5 T 6 Y 7 U I 9 O 0 P for the upper octave. Press [ or ] to shift octaves.',
      'Click Rec in the top bar and play on your PC keyboard or USB MIDI controller to record live notes directly into the Piano Roll with real hold lengths. Turn on Step Entry to stamp notes one step at a time while stopped.',
      'In Piano Roll, use Generate Chords, Arpeggiate, Ghost Notes, Quantize, Humanize, Strum, Legato, and the 9 editing tools (Draw, Paint, Delete, Mute, Slip, Slice, Select, Zoom, Playback).',
    ],
  },
  {
    id: 'mixer',
    title: '3. Mixing, FX & Modulation',
    icon: Sliders,
    steps: [
      'Route any channel to a Mixer Insert (M1-M5+) from the Channel Rack, then open Mixer to adjust volume, pan, Reverb/Delay sends, and stack any of the 83 built-in FX plugins (Parametric EQ 2, Soundgoodizer, Maximus, Gross Beat, LuxeVerb, Blood Overdrive, Amp Designer).',
      'Open Instruments to sculpt SubSynth wavetables, 4-op FMSynth algorithms, 24-bit Drum kits, Samplers, and .sf2 SoundFonts — or click Randomize for instant new patches.',
      'Route real-time beat.phase, env.kick, or 4-band frequency energy (Sub, Low-Mid, High-Mid, Air) in the Beat-Reactive Mod Matrix to animate filter cutoff, resonance, or FM index automatically.',
    ],
  },
  {
    id: 'audio',
    title: '4. Audio, Chopping, TTS & Drummer',
    icon: Mic,
    steps: [
      'Use Audio / Edison to upload or drag-and-drop any MP3, WAV, FLAC, or OGG song, drag across the waveform to select any bit, and click Crop, Cut Out, Reverse, Auto-Slice (Slicex), Add Selected Bit → Playlist, or Extract Bit → Sampler Key to play that sample on your keyboard.',
      'Open the Retro Speech (TTS) panel inside Audio / Edison to type producer tags or lyrics using classic 8-bit SAM 1982, Robot, Cyber Vocoder, Whisper, Giant Sub-Bot, Chipmunk, Alien Ring-Mod, or Windows Classic SAPI voices — then drop them straight onto your tracks.',
      'Record live mic/line-in takes with Input Monitoring and Chromatic Tuner, view Grand Staff Score notation, or use Drummer & Live for virtual drummer grooves, Performance Mode clip launching, and the ZGameEditor Visualizer.',
    ],
  },
  {
    id: 'code',
    title: '5. Live Code, Saving & Export',
    icon: Code2,
    steps: [
      'In Live Code, pick any built-in JavaScript or Python preset (or insert snippets), edit live, and press Ctrl+Enter to quantized hot-reload on the next beat or bar without stopping playback. Click Audition on inline AST previews or Bake Pattern / Bake WAV to move code into your timeline.',
      'Click Save (or press Ctrl+S) to save your project to Recent Projects, or Save File to export a portable .bebeat project file. Click Export (top right) for lossless 32-bit float / 24-bit / 16-bit WAV (with TPDF/shaped dither and True Peak ceiling), FLAC, AIFF, MP3, OGG, and per-track Stems.',
    ],
  },
];

export const HomeScreen: React.FC<HomeScreenProps> = ({
  hasActiveSession,
  currentProjectName,
  onResumeCurrent,
  onLaunchProject,
  onOpenProjectFile,
}) => {
  const [recents, setRecents] = useState<RecentProjectRecord[]>(() => listRecentProjects());
  const [newName, setNewName] = useState('Untitled Studio Session');
  const [guideTab, setGuideTab] = useState<string>(GUIDE_SECTIONS[0].id);

  const handleStartTemplate = (tpl: (typeof TEMPLATES)[number]) => {
    const id = tpl.id === 'studio-groove-code' ? 'studio-groove' : tpl.id;
    const projectName = newName.trim() || tpl.name;
    const proj = createTemplateProject(id, projectName);
    onLaunchProject(proj, undefined, tpl.tab || 'channel-rack');
  };

  const handleDeleteRecent = (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    setRecents(deleteRecentProject(id));
  };

  const activeGuide = GUIDE_SECTIONS.find((g) => g.id === guideTab) || GUIDE_SECTIONS[0];

  return (
    <div
      style={{
        height: '100vh',
        width: '100vw',
        background: 'var(--bg)',
        color: 'var(--ink)',
        display: 'flex',
        flexDirection: 'column',
        overflow: 'hidden',
      }}
    >
      {/* Clean Top Header */}
      <header
        style={{
          flex: 'none',
          height: 54,
          background: 'var(--panel)',
          borderBottom: '1px solid var(--border)',
          padding: '0 24px',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: 12,
        }}
      >
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 12 }}>
          <span className="wordmark" style={{ fontSize: 20 }}>Bebeat</span>
          <span style={{ color: 'var(--ink-dim)', fontSize: 12 }}>
            Music Production, Live Coding &amp; Mastering Studio
          </span>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <button onClick={() => void onOpenProjectFile()}>
            <FolderOpen size={13} /> Open .bebeat File
          </button>
          {hasActiveSession && (
            <button className="primary" onClick={onResumeCurrent}>
              <span>Resume {currentProjectName}</span>
              <ArrowRight size={13} />
            </button>
          )}
        </div>
      </header>

      {/* Main Scrollable Home Content */}
      <div style={{ flex: 1, overflow: 'auto', padding: '24px 28px 36px' }}>
        <div style={{ maxWidth: 1180, margin: '0 auto', display: 'flex', flexDirection: 'column', gap: 22 }}>
          {/* Row 1: New Project + Recent Projects */}
          <div style={{ display: 'grid', gridTemplateColumns: '1.35fr 1fr', gap: 18, alignItems: 'start' }}>
            {/* New Project & Starter Templates */}
            <section
              style={{
                background: 'var(--panel)',
                border: '1px solid var(--border)',
                borderRadius: 4,
                padding: 18,
                display: 'flex',
                flexDirection: 'column',
                gap: 14,
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10 }}>
                <div className="panel-title" style={{ fontSize: 12 }}>New Project</div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, flex: 1, maxWidth: 340 }}>
                  <input
                    type="text"
                    value={newName}
                    onChange={(e) => setNewName(e.target.value)}
                    placeholder="Project name..."
                    style={{ flex: 1 }}
                  />
                  <button
                    className="primary"
                    onClick={() => handleStartTemplate(TEMPLATES[0])}
                  >
                    <Plus size={13} /> Create Blank
                  </button>
                </div>
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: 8 }}>
                {TEMPLATES.map((tpl) => (
                  <button
                    key={tpl.id}
                    onClick={() => handleStartTemplate(tpl)}
                    style={{
                      flexDirection: 'column',
                      alignItems: 'flex-start',
                      justifyContent: 'space-between',
                      textAlign: 'left',
                      padding: '11px 12px',
                      background: 'var(--bg-alt)',
                      whiteSpace: 'normal',
                      gap: 5,
                    }}
                  >
                    <div style={{ display: 'flex', justifyContent: 'space-between', width: '100%', alignItems: 'center' }}>
                      <span style={{ fontWeight: 700, fontSize: 12.5, color: 'var(--white)' }}>{tpl.name}</span>
                      <span className="mono" style={{ fontSize: 10.5, color: 'var(--accent-blue)' }}>{tpl.bpm} BPM</span>
                    </div>
                    <span style={{ fontSize: 11, color: 'var(--ink-dim)', lineHeight: 1.4 }}>{tpl.desc}</span>
                  </button>
                ))}
              </div>
            </section>

            {/* Recent Projects */}
            <section
              style={{
                background: 'var(--panel)',
                border: '1px solid var(--border)',
                borderRadius: 4,
                padding: 18,
                display: 'flex',
                flexDirection: 'column',
                gap: 12,
                minHeight: 280,
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                <div className="panel-title" style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12 }}>
                  <Clock size={13} /> Recent Projects ({recents.length})
                </div>
                <button className="sm" onClick={() => void onOpenProjectFile()}>
                  <FolderOpen size={11} /> Browse Disk
                </button>
              </div>

              {recents.length === 0 ? (
                <div
                  style={{
                    flex: 1,
                    display: 'flex',
                    flexDirection: 'column',
                    justifyContent: 'center',
                    alignItems: 'center',
                    textAlign: 'center',
                    padding: 20,
                    background: 'var(--bg-alt)',
                    border: '1px solid var(--border)',
                    borderRadius: 4,
                    color: 'var(--ink-dim)',
                    gap: 6,
                  }}
                >
                  <div style={{ fontWeight: 600, color: 'var(--ink)' }}>No saved projects yet</div>
                  <div style={{ fontSize: 11.5, maxWidth: '34ch' }}>
                    Start a new project on the left, then click Save (or press Ctrl+S) to keep it here for 1-click reopening.
                  </div>
                </div>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 6, maxHeight: 260, overflow: 'auto' }}>
                  {recents.map((rec) => (
                    <div
                      key={rec.id}
                      onClick={() => onLaunchProject(rec.state, rec.id)}
                      style={{
                        background: 'var(--bg-alt)',
                        border: '1px solid var(--border)',
                        borderRadius: 4,
                        padding: '9px 11px',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'space-between',
                        gap: 8,
                        cursor: 'pointer',
                      }}
                    >
                      <div style={{ minWidth: 0 }}>
                        <div style={{ fontWeight: 600, fontSize: 12.5, color: 'var(--white)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                          {rec.name}
                        </div>
                        <div className="mono" style={{ fontSize: 10, color: 'var(--ink-dim)', marginTop: 2 }}>
                          {rec.bpm} BPM · {rec.channelsCount} ch · {rec.patternsCount} pat · {rec.updatedAt}
                        </div>
                      </div>
                      <div style={{ display: 'flex', gap: 4, flex: 'none' }}>
                        <button
                          className="sm"
                          onClick={(e) => {
                            e.stopPropagation();
                            onLaunchProject(rec.state, rec.id);
                          }}
                        >
                          Open
                        </button>
                        <button
                          className="sm icon-only danger-outline"
                          onClick={(e) => handleDeleteRecent(rec.id, e)}
                          title="Remove from Recent Projects"
                        >
                          <Trash2 size={11} />
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </section>
          </div>

          {/* Row 2: Easy-to-Read Interactive Studio Guide & Tutorial */}
          <section
            style={{
              background: 'var(--panel)',
              border: '1px solid var(--border)',
              borderRadius: 4,
              overflow: 'hidden',
            }}
          >
            <div
              style={{
                padding: '12px 18px',
                background: 'var(--panel-elev)',
                borderBottom: '1px solid var(--border)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                flexWrap: 'wrap',
                gap: 10,
              }}
            >
              <div className="panel-title" style={{ display: 'flex', alignItems: 'center', gap: 7, fontSize: 12 }}>
                <BookOpen size={14} /> Studio Guide &amp; Quick Tutorial
              </div>
              <div style={{ display: 'flex', gap: 5, flexWrap: 'wrap' }}>
                {GUIDE_SECTIONS.map((g) => {
                  const Icon = g.icon;
                  return (
                    <button
                      key={g.id}
                      className={guideTab === g.id ? 'active sm' : 'sm'}
                      onClick={() => setGuideTab(g.id)}
                    >
                      <Icon size={11} />
                      <span>{g.title}</span>
                    </button>
                  );
                })}
              </div>
            </div>

            <div style={{ padding: 18, display: 'grid', gridTemplateColumns: '1.6fr 1fr', gap: 18 }}>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                <div style={{ fontWeight: 700, fontSize: 14, color: 'var(--white)' }}>{activeGuide.title}</div>
                {activeGuide.steps.map((text, idx) => (
                  <div
                    key={idx}
                    style={{
                      display: 'flex',
                      gap: 10,
                      alignItems: 'flex-start',
                      background: 'var(--bg-alt)',
                      border: '1px solid var(--border)',
                      borderRadius: 4,
                      padding: '10px 12px',
                    }}
                  >
                    <span
                      className="mono"
                      style={{
                        width: 22,
                        height: 22,
                        flex: 'none',
                        borderRadius: 3,
                        background: 'var(--white)',
                        color: 'var(--navy-ink)',
                        fontWeight: 700,
                        fontSize: 11,
                        display: 'inline-flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                      }}
                    >
                      {idx + 1}
                    </span>
                    <p style={{ margin: 0, fontSize: 12.5, color: 'var(--ink)', lineHeight: 1.55 }}>{text}</p>
                  </div>
                ))}
              </div>

              {/* Essential Keybinds Cheat Card */}
              <div
                style={{
                  background: 'var(--bg-alt)',
                  border: '1px solid var(--border)',
                  borderRadius: 4,
                  padding: 14,
                  display: 'flex',
                  flexDirection: 'column',
                  gap: 8,
                }}
              >
                <div className="panel-title" style={{ fontSize: 11 }}>Essential Controls</div>
                {[
                  ['Space', 'Play / Pause active tab only'],
                  ['Shift + Space', 'Play All (full mix + live code)'],
                  ['Z-M / Q-P', 'Play piano on PC keyboard'],
                  ['[ / ]', 'Shift keyboard octave down / up'],
                  ['Rec', 'Record live notes into Piano Roll'],
                  ['Ctrl + S', 'Save project to Recent Projects'],
                  ['Ctrl + Enter', 'Hot-reload JS / Python live code'],
                  ['Ctrl + Z / Y', 'Undo / Redo'],
                ].map(([key, label]) => (
                  <div
                    key={key}
                    style={{
                      display: 'flex',
                      justifyContent: 'space-between',
                      alignItems: 'center',
                      borderBottom: '1px solid #18233C',
                      paddingBottom: 5,
                      fontSize: 11.5,
                    }}
                  >
                    <span
                      className="mono"
                      style={{
                        background: 'var(--panel)',
                        border: '1px solid var(--border-strong)',
                        borderRadius: 3,
                        padding: '1px 6px',
                        color: 'var(--white)',
                        fontSize: 10.5,
                      }}
                    >
                      {key}
                    </span>
                    <span style={{ color: 'var(--ink-dim)' }}>{label}</span>
                  </div>
                ))}
              </div>
            </div>
          </section>
        </div>
      </div>
    </div>
  );
};
