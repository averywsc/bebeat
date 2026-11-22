import React, { useEffect, useState, useSyncExternalStore } from 'react';
import type { WorkspaceTab } from './types/daw';
import { projectStore } from './state/projectStore';
import { audioEngine } from './audio/engine';
import { getSystemCapabilities, type SystemCapabilities } from './services/bridge';
import type { PythonRuntimeMode } from './livecode/pythonRuntime';
import { TopBar } from './components/TopBar';
import { TelemetryFooterBar } from './components/Visualizers';
import { ChannelRack } from './components/ChannelRack';
import { PianoRoll } from './components/PianoRoll';
import { PlaylistView } from './components/PlaylistView';
import { MixerView } from './components/MixerView';
import { InstrumentRack } from './components/InstrumentRack';
import { LiveCodeStudio } from './components/LiveCodeStudio';
import { ExportModal } from './components/ExportModal';
import { SettingsModal } from './components/SettingsModal';

const TABS: Array<{ id: WorkspaceTab; label: string }> = [
  { id: 'channel-rack', label: 'Channel Rack' },
  { id: 'piano-roll', label: 'Piano Roll' },
  { id: 'playlist', label: 'Playlist' },
  { id: 'mixer', label: 'Mixer' },
  { id: 'instruments', label: 'Instruments & Mod' },
  { id: 'live-code', label: 'Live Code (JS / Py)' },
];

export const App: React.FC = () => {
  const project = useSyncExternalStore(projectStore.subscribe, projectStore.getState);
  const [activeTab, setActiveTab] = useState<WorkspaceTab>('channel-rack');
  const [showExport, setShowExport] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [capabilities, setCapabilities] = useState<SystemCapabilities | null>(null);
  const [pythonMode, setPythonMode] = useState<PythonRuntimeMode>('auto');

  useEffect(() => {
    getSystemCapabilities().then(setCapabilities).catch(() => {});
  }, []);

  // Global DAW shortcuts: Space (Play/Stop), Ctrl+Z (Undo), Ctrl+Y (Redo)
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement)?.tagName;
      const inEditor = tag === 'TEXTAREA' || tag === 'INPUT' || tag === 'SELECT';

      if (e.code === 'Space' && !inEditor) {
        e.preventDefault();
        const t = audioEngine.readTelemetry();
        if (t.playing) audioEngine.stop(false);
        else void audioEngine.play();
      } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z' && !inEditor) {
        e.preventDefault();
        if (e.shiftKey) projectStore.redo();
        else projectStore.undo();
      } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'y' && !inEditor) {
        e.preventDefault();
        projectStore.redo();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);

  const liveCodeRunning = project.liveCodeBuffers.some((b) => b.active);

  return (
    <div className="app-shell">
      <TopBar
        project={project}
        onOpenExport={() => setShowExport(true)}
        onOpenSettings={() => setShowSettings(true)}
      />

      <nav className="nav-tabs">
        {TABS.map((t) => (
          <button
            key={t.id}
            className={`nav-tab ${activeTab === t.id ? 'active' : ''}`}
            onClick={() => setActiveTab(t.id)}
          >
            {t.label}
          </button>
        ))}

        <div className="nav-status mono">
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}>
            <span className={`status-dot ${liveCodeRunning ? 'live' : ''}`} />
            LIVE CODE: {liveCodeRunning ? 'ACTIVE' : 'IDLE'}
          </span>
          <span>48kHz / 32-BIT FLOAT DSP</span>
          {capabilities?.wasapiSupported && <span>WASAPI</span>}
        </div>
      </nav>

      <main className="workspace-body">
        <div className="workspace-pane">
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
          {activeTab === 'live-code' && (
            <LiveCodeStudio project={project} pythonMode={pythonMode} />
          )}
        </div>
      </main>

      <TelemetryFooterBar />

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
    </div>
  );
};
