import React, { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react';
import {
  Pencil,
  Paintbrush,
  Trash2,
  VolumeX,
  MoveHorizontal,
  Scissors,
  MousePointer2,
  ZoomIn,
  PlayCircle,
  X,
} from 'lucide-react';
import type { EditorTool, ProjectState, WorkspaceTab } from './types/daw';
import { projectStore } from './state/projectStore';
import { saveProjectToRecents } from './state/recentProjects';
import { audioEngine } from './audio/engine';
import { getSystemCapabilities, triggerBrowserDownload, type SystemCapabilities } from './services/bridge';
import type { PythonRuntimeMode } from './livecode/pythonRuntime';
import { TYPING_KEY_TO_SEMITONE } from './livecode/musicTheory';
import { THEME_PRESETS } from './audio/catalog/plugins';
import { HomeScreen } from './components/HomeScreen';
import { TopBar } from './components/TopBar';
import { TelemetryFooterBar } from './components/Visualizers';
import { BrowserSidebar } from './components/BrowserSidebar';
import { ChannelRack } from './components/ChannelRack';
import { PianoRoll } from './components/PianoRoll';
import { PlaylistView } from './components/PlaylistView';
import { MixerView } from './components/MixerView';
import { InstrumentRack } from './components/InstrumentRack';
import { AudioEditorView } from './components/AudioEditorView';
import { ScoreEditorView } from './components/ScoreEditorView';
import { PerformanceDrummerView } from './components/PerformanceDrummerView';
import { LiveCodeStudio } from './components/LiveCodeStudio';
import { ExportModal } from './components/ExportModal';
import { SettingsModal } from './components/SettingsModal';

const TABS: Array<{ id: WorkspaceTab; label: string }> = [
  { id: 'channel-rack', label: 'Channel Rack' },
  { id: 'piano-roll', label: 'Piano Roll' },
  { id: 'playlist', label: 'Playlist' },
  { id: 'mixer', label: 'Mixer' },
  { id: 'instruments', label: 'Instruments' },
  { id: 'audio-editor', label: 'Audio / Edison' },
  { id: 'score', label: 'Score' },
  { id: 'performance', label: 'Drummer & Live' },
  { id: 'live-code', label: 'Live Code' },
];

const TOOLS: Array<{ id: EditorTool; label: string; icon: React.ComponentType<{ size?: number }> }> = [
  { id: 'draw', label: 'Draw', icon: Pencil },
  { id: 'paint', label: 'Paint', icon: Paintbrush },
  { id: 'delete', label: 'Delete', icon: Trash2 },
  { id: 'mute', label: 'Mute', icon: VolumeX },
  { id: 'slip', label: 'Slip', icon: MoveHorizontal },
  { id: 'slice', label: 'Slice', icon: Scissors },
  { id: 'select', label: 'Select', icon: MousePointer2 },
  { id: 'zoom', label: 'Zoom', icon: ZoomIn },
  { id: 'playback', label: 'Playback', icon: PlayCircle },
];

export const App: React.FC = () => {
  const project = useSyncExternalStore(projectStore.subscribe, projectStore.getState);
  const [showHome, setShowHome] = useState(true);
  const [hasLaunchedOnce, setHasLaunchedOnce] = useState(false);
  const [currentRecentId, setCurrentRecentId] = useState<string | undefined>(undefined);
  const [activeTab, setActiveTab] = useState<WorkspaceTab>('channel-rack');
  const [showExport, setShowExport] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [showHelp, setShowHelp] = useState(false);
  const [hintText, setHintText] = useState(
    'Ready — Press Space to play current section, Shift+Space to Play All, Z-M / Q-P to play piano, Ctrl+S to save.'
  );
  const [capabilities, setCapabilities] = useState<SystemCapabilities | null>(null);
  const [pythonMode, setPythonMode] = useState<PythonRuntimeMode>('auto');
  const heldKeysRef = useRef<Map<string, { channelId: string; midi: number }>>(new Map());

  const handleQuickSave = useCallback(() => {
    const saved = saveProjectToRecents(projectStore.getState(), currentRecentId);
    setCurrentRecentId(saved.id);
    setHintText(`Saved "${saved.name}" to Recent Projects (${saved.updatedAt}).`);
  }, [currentRecentId]);

  const handleSaveProjectFile = useCallback(async () => {
    const state = projectStore.getState();
    const json = JSON.stringify(state, null, 2);
    const filename = `${state.name.replace(/[^a-z0-9_-]+/gi, '_').toLowerCase()}.bebeat`;
    let savedPath: string | undefined;
    if (window.bebeat?.saveProject) {
      const p = await window.bebeat.saveProject(filename, json);
      if (!p) return;
      savedPath = p;
    } else {
      triggerBrowserDownload(filename, json, 'application/json');
    }
    const rec = saveProjectToRecents(state, currentRecentId, savedPath);
    setCurrentRecentId(rec.id);
    setHintText(`Saved project file "${savedPath || filename}" and updated Recent Projects.`);
  }, [currentRecentId]);

  const handleOpenProjectFile = useCallback(async () => {
    const applyLoaded = (jsonText: string, filePath?: string) => {
      try {
        const parsed = JSON.parse(jsonText) as ProjectState;
        if (parsed.channels && parsed.patterns) {
          projectStore.replaceState(parsed);
          const rec = saveProjectToRecents(parsed, undefined, filePath);
          setCurrentRecentId(rec.id);
          setHasLaunchedOnce(true);
          setShowHome(false);
          setHintText(`Opened project "${parsed.name}".`);
        }
      } catch {}
    };

    if (window.bebeat?.openProject) {
      const res = await window.bebeat.openProject();
      if (res?.json) applyLoaded(res.json, res.path);
      return;
    }
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.bebeat,.json';
    input.onchange = async () => {
      const file = input.files?.[0];
      if (file) applyLoaded(await file.text(), file.name);
    };
    input.click();
  }, []);

  const handleLaunchProject = useCallback((state: ProjectState, recordId?: string, initialTab?: WorkspaceTab) => {
    audioEngine.stop(true);
    projectStore.replaceState(state);
    const rec = saveProjectToRecents(state, recordId);
    setCurrentRecentId(rec.id);
    setHasLaunchedOnce(true);
    if (initialTab) setActiveTab(initialTab);
    setShowHome(false);
    setHintText(`Opened "${state.name}" (${state.bpm} BPM).`);
  }, []);

  const handleGoHome = useCallback(() => {
    audioEngine.stop(false);
    const saved = saveProjectToRecents(projectStore.getState(), currentRecentId);
    setCurrentRecentId(saved.id);
    setShowHome(true);
  }, [currentRecentId]);

  useEffect(() => {
    getSystemCapabilities().then(setCapabilities).catch(() => {});
  }, []);

  // Apply selected theme CSS variables dynamically
  useEffect(() => {
    const theme = THEME_PRESETS.find((t) => t.id === project.themeId) || THEME_PRESETS[0];
    const root = document.documentElement;
    for (const [k, v] of Object.entries(theme.vars)) {
      root.style.setProperty(k, v);
    }
  }, [project.themeId]);

  /** Play ONLY the part you are currently editing */
  const playCurrentPart = useCallback(async () => {
    const state = projectStore.getState();
    if (activeTab === 'piano-roll' || activeTab === 'instruments' || activeTab === 'score') {
      await audioEngine.play({ scope: 'solo-channel', soloChannelId: state.selectedChannelId });
      setHintText('Playing solo active instrument part (use Play All for full mix).');
    } else if (activeTab === 'playlist') {
      projectStore.update((s) => { s.playbackMode = 'song'; }, false);
      await audioEngine.play({ scope: 'song-only' });
      setHintText('Playing Playlist song arrangement.');
    } else if (activeTab === 'live-code') {
      await audioEngine.play({ scope: 'live-code-only' });
      setHintText('Playing Live Code buffer.');
    } else if (activeTab === 'channel-rack' || activeTab === 'performance') {
      projectStore.update((s) => { s.playbackMode = 'pattern'; }, false);
      await audioEngine.play({ scope: 'pattern-only' });
      setHintText('Playing active Pattern.');
    } else {
      await audioEngine.playAll();
      setHintText('Playing full mix.');
    }
  }, [activeTab]);

  /** Play ALL parts together */
  const playAllParts = useCallback(async () => {
    await audioEngine.playAll();
    setHintText('Playing all channels, arrangement, and active live code together.');
  }, []);

  // Global DAW shortcuts + Computer Keyboard Typing-to-Piano
  useEffect(() => {
    if (showHome) return;
    const onKeyDown = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement)?.tagName;
      const inEditor = tag === 'TEXTAREA' || tag === 'INPUT' || tag === 'SELECT';
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') {
        e.preventDefault();
        handleQuickSave();
        return;
      }
      if (inEditor) return;

      if (e.code === 'Space') {
        e.preventDefault();
        const t = audioEngine.readTelemetry();
        if (t.playing) {
          audioEngine.stop(false);
        } else if (e.shiftKey) {
          void playAllParts();
        } else {
          void playCurrentPart();
        }
        return;
      }

      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') {
        e.preventDefault();
        if (e.shiftKey) projectStore.redo();
        else projectStore.undo();
        return;
      }
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'y') {
        e.preventDefault();
        projectStore.redo();
        return;
      }

      if (e.ctrlKey || e.metaKey || e.altKey) return;

      const state = projectStore.getState();
      if (!state.typingKeyboardEnabled) return;

      if (e.key === '[') {
        e.preventDefault();
        projectStore.update((s) => { s.typingOctave = Math.max(1, s.typingOctave - 1); }, false);
        return;
      }
      if (e.key === ']') {
        e.preventDefault();
        projectStore.update((s) => { s.typingOctave = Math.min(6, s.typingOctave + 1); }, false);
        return;
      }

      const lower = e.key.toLowerCase();
      const semi = TYPING_KEY_TO_SEMITONE[lower];
      if (semi === undefined || e.repeat || heldKeysRef.current.has(lower)) return;

      const baseMidi = (state.typingOctave + 1) * 12;
      const midi = Math.max(12, Math.min(108, baseMidi + semi));
      heldKeysRef.current.set(lower, { channelId: state.selectedChannelId, midi });
      void audioEngine.noteOnLive(state.selectedChannelId, midi, 0.86);
    };

    const onKeyUp = (e: KeyboardEvent) => {
      const lower = e.key.toLowerCase();
      const held = heldKeysRef.current.get(lower);
      if (!held) return;
      heldKeysRef.current.delete(lower);
      audioEngine.noteOffLive(held.channelId, held.midi);
    };

    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
    };
  }, [showHome, playCurrentPart, playAllParts, handleQuickSave]);

  if (showHome) {
    return (
      <HomeScreen
        hasActiveSession={hasLaunchedOnce}
        currentProjectName={project.name}
        onResumeCurrent={() => setShowHome(false)}
        onLaunchProject={handleLaunchProject}
        onOpenProjectFile={handleOpenProjectFile}
      />
    );
  }

  return (
    <div className="app-shell">
      <TopBar
        project={project}
        activeTab={activeTab}
        onPlayCurrentPart={() => void playCurrentPart()}
        onPlayAll={() => void playAllParts()}
        onGoHome={handleGoHome}
        onQuickSave={handleQuickSave}
        onSaveProjectFile={() => void handleSaveProjectFile()}
        onOpenProjectFile={() => void handleOpenProjectFile()}
        onOpenExport={() => setShowExport(true)}
        onOpenSettings={() => setShowSettings(true)}
        onOpenHelp={() => setShowHelp(true)}
      />

      {/* Workspace Tabs + 9 FL Editing Tools */}
      <nav className="nav-tabs" style={{ overflowX: 'auto' }}>
        {TABS.map((t) => (
          <button
            key={t.id}
            className={`nav-tab ${activeTab === t.id ? 'active' : ''}`}
            onClick={() => {
              setActiveTab(t.id);
              setHintText(`Switched to ${t.label}.`);
            }}
          >
            {t.label}
          </button>
        ))}

        <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 3, paddingLeft: 10 }}>
          {TOOLS.map((tool) => {
            const Icon = tool.icon;
            const active = project.activeTool === tool.id;
            return (
              <button
                key={tool.id}
                className={active ? 'active sm icon-only' : 'sm icon-only'}
                onClick={() => {
                  projectStore.update((s) => { s.activeTool = tool.id; }, false);
                  setHintText(`Active Tool: ${tool.label} Tool`);
                }}
                onMouseEnter={() => setHintText(`${tool.label} Tool`)}
                title={`${tool.label} Tool`}
              >
                <Icon size={12} />
              </button>
            );
          })}
        </div>
      </nav>

      <main className="workspace-body">
        <div className="workspace-pane">
          {project.browserOpen && (
            <BrowserSidebar
              project={project}
              onHint={setHintText}
              onSelectTab={(t) => setActiveTab(t)}
            />
          )}

          {activeTab === 'channel-rack' && (
            <ChannelRack
              project={project}
              onOpenPianoRoll={(chId) => {
                projectStore.update((s) => { s.selectedChannelId = chId; }, false);
                setActiveTab('piano-roll');
              }}
              onOpenInstrument={(chId) => {
                projectStore.update((s) => { s.selectedChannelId = chId; }, false);
                setActiveTab('instruments');
              }}
            />
          )}

          {activeTab === 'piano-roll' && <PianoRoll project={project} />}
          {activeTab === 'playlist' && <PlaylistView project={project} />}
          {activeTab === 'mixer' && <MixerView project={project} />}
          {activeTab === 'instruments' && <InstrumentRack project={project} />}
          {activeTab === 'audio-editor' && <AudioEditorView project={project} />}
          {activeTab === 'score' && <ScoreEditorView project={project} />}
          {activeTab === 'performance' && <PerformanceDrummerView project={project} />}
          {activeTab === 'live-code' && (
            <LiveCodeStudio project={project} pythonMode={pythonMode} />
          )}
        </div>
      </main>

      <TelemetryFooterBar />

      {/* Hint Bar */}
      <div
        style={{
          flex: 'none',
          height: 22,
          background: 'var(--bg-alt)',
          borderTop: '1px solid var(--border)',
          padding: '0 12px',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          fontSize: 11,
          color: 'var(--ink-dim)',
        }}
      >
        <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{hintText}</span>
        <span style={{ color: 'var(--ink-mute)' }}>Tool: {project.activeTool.toUpperCase()}</span>
      </div>

      {showExport && (
        <ExportModal
          project={project}
          ffmpegAvailable={Boolean(capabilities?.ffmpegAvailable)}
          onClose={() => setShowExport(false)}
        />
      )}

      {showSettings && (
        <SettingsModal
          project={project}
          capabilities={capabilities}
          pythonMode={pythonMode}
          onChangePythonMode={setPythonMode}
          onClose={() => setShowSettings(false)}
        />
      )}

      {showHelp && (
        <div className="modal-backdrop" onClick={() => setShowHelp(false)}>
          <div className="modal-box" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <span className="panel-title">Quick Help &amp; Keyboard Shortcuts</span>
              <button className="icon-only sm" onClick={() => setShowHelp(false)}>
                <X size={14} />
              </button>
            </div>
            <div className="modal-body" style={{ fontSize: 12 }}>
              <div className="inst-section">
                <div className="inst-section-title">Transport &amp; Recording</div>
                <div><strong>Space</strong> — Play / Pause current section (Piano Roll solos active instrument)</div>
                <div><strong>Shift + Space</strong> — Play All (all channels, arrangement &amp; live code)</div>
                <div><strong>Rec</strong> — Arm real-time MIDI / PC keyboard recording into Piano Roll</div>
                <div><strong>Step Entry</strong> — Stamp notes step-by-step from your keyboard while stopped</div>
                <div><strong>Auto Rec</strong> — Record X-Y Controller &amp; knob sweeps into Automation Lanes</div>
              </div>
              <div className="inst-section">
                <div className="inst-section-title">Musical Typing (PC Keyboard Piano)</div>
                <div><strong>Lower Octave</strong>: Z S X D C V G B H N J M ,</div>
                <div><strong>Upper Octave</strong>: Q 2 W 3 E R 5 T 6 Y 7 U I 9 O 0 P</div>
                <div><strong>[ / ]</strong> — Shift Typing Keyboard Octave down / up</div>
              </div>
              <div className="inst-section">
                <div className="inst-section-title">Editing &amp; Studio Tools</div>
                <div><strong>Ctrl+Z / Ctrl+Y</strong> — Undo / Redo</div>
                <div><strong>Ctrl+D</strong> — Duplicate selected Playlist clip</div>
                <div><strong>Ctrl+Enter</strong> — Quantized live code hot-reload in JS / Python Studio</div>
                <div><strong>Browser Sidebar</strong> — Browse all 31 Generators, 76 Effect Plugins, Loop Starters &amp; 24-bit Kits</div>
              </div>
            </div>
            <div className="modal-footer">
              <button className="primary" onClick={() => setShowHelp(false)}>Got it</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
