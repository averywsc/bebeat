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
import { parseSmfMultiTrack, type ParsedMidiFile } from './audio/midiCodec';
import { liveAudioRecorder } from './audio/audioRecorder';
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
import { CommandPalette } from './components/CommandPalette';
import { MidiImportModal } from './components/MidiImportModal';

const TABS: Array<{ id: WorkspaceTab; label: string }> = [
  { id: 'channel-rack', label: 'Channel Rack' },
  { id: 'piano-roll', label: 'Piano Roll' },
  { id: 'score', label: 'Sheet Music' },
  { id: 'playlist', label: 'Playlist' },
  { id: 'mixer', label: 'Mixer' },
  { id: 'instruments', label: 'Instruments' },
  { id: 'audio-editor', label: 'Audio / TTS' },
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
  const [showCmdPalette, setShowCmdPalette] = useState(false);
  const [pendingMidiImport, setPendingMidiImport] = useState<ParsedMidiFile | null>(null);
  const [hintText, setHintText] = useState(
    'Ready — Press Ctrl+K to search any tool/plugin, Space to play current tab, Shift+Space to Play All, or drop any .mid / .mp3 file.'
  );
  const [capabilities, setCapabilities] = useState<SystemCapabilities | null>(null);
  const [pythonMode, setPythonMode] = useState<PythonRuntimeMode>('auto');
  const heldKeysRef = useRef<Map<string, { channelId: string; midi: number }>>(new Map());

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

  const openMidiBytes = useCallback((name: string, bytes: Uint8Array) => {
    try {
      const parsed = parseSmfMultiTrack(bytes, name, projectStore.getState().bpm);
      if (parsed.tracks.length === 0) {
        setHintText(`MIDI file "${name}" contained no note events.`);
        return;
      }
      setHasLaunchedOnce(true);
      setShowHome(false);
      setPendingMidiImport(parsed);
    } catch (err) {
      setHintText(`Failed to parse MIDI "${name}": ${err instanceof Error ? err.message : String(err)}`);
    }
  }, []);

  const handleImportMidiFile = useCallback(async () => {
    if (window.bebeat?.pickAudioOrSf2) {
      const picked = await window.bebeat.pickAudioOrSf2();
      if (picked && /\.(mid|midi)$/i.test(picked.name)) {
        openMidiBytes(picked.name, picked.bytes);
      } else if (picked) {
        // Also allow picking an audio file directly
        const key = await audioEngine.loadCustomSample(picked.name, picked.bytes);
        const buf = audioEngine.getKitBuffer(key);
        if (buf) {
          const take = liveAudioRecorder.addTakeBuffer(picked.name, buf);
          audioEngine.registerAudioBuffer(take.id, buf);
          setHasLaunchedOnce(true);
          setShowHome(false);
          setActiveTab('audio-editor');
          setHintText(`Loaded audio "${picked.name}" into Audio / TTS Editor.`);
        }
      }
      return;
    }
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.mid,.midi';
    input.onchange = async () => {
      const file = input.files?.[0];
      if (file) openMidiBytes(file.name, new Uint8Array(await file.arrayBuffer()));
    };
    input.click();
  }, [openMidiBytes]);

  const handleGlobalDrop = async (e: React.DragEvent) => {
    const file = e.dataTransfer.files?.[0];
    if (!file) return;
    const lower = file.name.toLowerCase();
    if (lower.endsWith('.mid') || lower.endsWith('.midi')) {
      e.preventDefault();
      openMidiBytes(file.name, new Uint8Array(await file.arrayBuffer()));
    } else if (lower.endsWith('.bebeat') || lower.endsWith('.json')) {
      e.preventDefault();
      try {
        const parsed = JSON.parse(await file.text()) as ProjectState;
        if (parsed.channels && parsed.patterns) {
          projectStore.replaceState(parsed);
          setHasLaunchedOnce(true);
          setShowHome(false);
          setHintText(`Opened dropped project "${parsed.name}".`);
        }
      } catch {}
    } else if (/\.(mp3|wav|flac|ogg|m4a|aac)$/.test(lower)) {
      e.preventDefault();
      const key = await audioEngine.loadCustomSample(file.name, new Uint8Array(await file.arrayBuffer()));
      const buf = audioEngine.getKitBuffer(key);
      if (buf) {
        const take = liveAudioRecorder.addTakeBuffer(file.name, buf);
        audioEngine.registerAudioBuffer(take.id, buf);
        setHasLaunchedOnce(true);
        setShowHome(false);
        setActiveTab('audio-editor');
        setHintText(`Loaded "${file.name}" into Audio / TTS Editor.`);
      }
    }
  };

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

  const playAllParts = useCallback(async () => {
    await audioEngine.playAll();
    setHintText('Playing all channels, arrangement, and active live code together.');
  }, []);

  // Global DAW shortcuts + Command Palette (Ctrl+K) + Computer Keyboard Typing-to-Piano
  useEffect(() => {
    if (showHome) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setShowCmdPalette((v) => !v);
        return;
      }
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') {
        e.preventDefault();
        handleQuickSave();
        return;
      }
      const tag = (e.target as HTMLElement)?.tagName;
      const inEditor = tag === 'TEXTAREA' || tag === 'INPUT' || tag === 'SELECT';
      if (inEditor || showCmdPalette) return;

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
  }, [showHome, showCmdPalette, playCurrentPart, playAllParts, handleQuickSave]);

  if (showHome) {
    return (
      <div onDragOver={(e) => e.preventDefault()} onDrop={(e) => void handleGlobalDrop(e)}>
        <HomeScreen
          hasActiveSession={hasLaunchedOnce}
          currentProjectName={project.name}
          onResumeCurrent={() => setShowHome(false)}
          onLaunchProject={handleLaunchProject}
          onOpenProjectFile={handleOpenProjectFile}
          onImportMidiFile={handleImportMidiFile}
        />
      </div>
    );
  }

  return (
    <div
      className="app-shell"
      onDragOver={(e) => e.preventDefault()}
      onDrop={(e) => void handleGlobalDrop(e)}
    >
      <TopBar
        project={project}
        activeTab={activeTab}
        onPlayCurrentPart={() => void playCurrentPart()}
        onPlayAll={() => void playAllParts()}
        onGoHome={handleGoHome}
        onQuickSave={handleQuickSave}
        onSaveProjectFile={() => void handleSaveProjectFile()}
        onOpenProjectFile={() => void handleOpenProjectFile()}
        onImportMidi={() => void handleImportMidiFile()}
        onOpenCommandPalette={() => setShowCmdPalette(true)}
        onOpenExport={() => setShowExport(true)}
        onOpenSettings={() => setShowSettings(true)}
        onOpenHelp={() => setShowHelp(true)}
      />

      {/* Clean Spacious Workspace Navigation Tabs */}
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
      </nav>

      <main className="workspace-body">
        <div className="workspace-pane">
          {/* Totone Studio Pro Left Vertical Tool Dock */}
          <nav className="tool-dock" aria-label="Editing Tools">
            {TOOLS.map((tool) => {
              const Icon = tool.icon;
              const active = project.activeTool === tool.id;
              return (
                <button
                  key={tool.id}
                  className={`tool-dock-btn ${active ? 'active' : ''}`}
                  onClick={() => {
                    projectStore.update((s) => { s.activeTool = tool.id; }, false);
                    setHintText(`Active Tool: ${tool.label} Tool`);
                  }}
                  onMouseEnter={() => setHintText(`${tool.label} Tool`)}
                  title={`${tool.label} Tool`}
                >
                  <Icon size={14} />
                </button>
              );
            })}
          </nav>

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

          {activeTab === 'piano-roll' && (
            <PianoRoll project={project} onRequestMidiUpload={() => void handleImportMidiFile()} />
          )}
          {activeTab === 'score' && (
            <ScoreEditorView project={project} onRequestMidiUpload={() => void handleImportMidiFile()} />
          )}
          {activeTab === 'playlist' && <PlaylistView project={project} />}
          {activeTab === 'mixer' && <MixerView project={project} />}
          {activeTab === 'instruments' && <InstrumentRack project={project} />}
          {activeTab === 'audio-editor' && <AudioEditorView project={project} />}
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
          color: 'var(--ink-mute)',
        }}
      >
        <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{hintText}</span>
        <span>Tool: {project.activeTool}</span>
      </div>

      {showCmdPalette && (
        <CommandPalette
          project={project}
          onClose={() => setShowCmdPalette(false)}
          onNavigateTab={(t) => setActiveTab(t)}
          onImportMidi={() => void handleImportMidiFile()}
          onOpenExport={() => setShowExport(true)}
          onOpenSettings={() => setShowSettings(true)}
          onHint={setHintText}
        />
      )}

      {pendingMidiImport && (
        <MidiImportModal
          parsed={pendingMidiImport}
          project={project}
          onClose={() => setPendingMidiImport(null)}
          onImported={(tab, summary) => {
            setActiveTab(tab);
            setHintText(summary);
          }}
        />
      )}

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
                <div className="inst-section-title">Search, MIDI &amp; Sheet Music</div>
                <div><strong>Ctrl + K</strong> — Command Palette (search any tool, 31 generators, 83 effects, or loop starter)</div>
                <div><strong>Drag &amp; Drop .mid</strong> — Smart multi-track MIDI importer into Piano Roll, Playlist &amp; Printable Sheet Music</div>
                <div><strong>Sheet Music Tab</strong> — Download 300-DPI PNG, SVG, Print/PDF, or MusicXML sheet music</div>
              </div>
              <div className="inst-section">
                <div className="inst-section-title">Transport &amp; Musical Typing</div>
                <div><strong>Space</strong> — Play / Pause active tab only · <strong>Shift + Space</strong> — Play All</div>
                <div><strong>Z-M / Q-P</strong> — Play piano on PC keyboard · <strong>[ / ]</strong> — Shift octave</div>
                <div><strong>Rec</strong> — Live record notes into Piano Roll · <strong>Ctrl + S</strong> — Save to Recent Projects</div>
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
