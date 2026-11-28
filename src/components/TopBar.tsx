import React, { useEffect, useRef, useState } from 'react';
import {
  Play,
  Square,
  Repeat,
  Undo2,
  Redo2,
  FolderOpen,
  Save,
  SlidersHorizontal,
  Download,
  Radio,
  Keyboard,
  Layers,
  PanelLeft,
  HelpCircle,
  Home,
  Search,
  Upload,
} from 'lucide-react';
import type { ProjectState, WorkspaceTab } from '../types/daw';
import { projectStore } from '../state/projectStore';
import { audioEngine } from '../audio/engine';

interface TopBarProps {
  project: ProjectState;
  activeTab: WorkspaceTab;
  onPlayCurrentPart: () => void;
  onPlayAll: () => void;
  onGoHome: () => void;
  onQuickSave: () => void;
  onSaveProjectFile: () => void;
  onOpenProjectFile: () => void;
  onImportMidi: () => void;
  onOpenCommandPalette: () => void;
  onOpenExport: () => void;
  onOpenSettings: () => void;
  onOpenHelp: () => void;
}

const PART_PLAY_LABELS: Record<WorkspaceTab, string> = {
  'channel-rack': 'Play Pattern',
  'piano-roll': 'Play Piano',
  playlist: 'Play Song',
  mixer: 'Play Mix',
  instruments: 'Play Inst',
  'audio-editor': 'Play Part',
  score: 'Play Score',
  performance: 'Play Live',
  'live-code': 'Play Code',
};

export const TopBar: React.FC<TopBarProps> = ({
  project,
  activeTab,
  onPlayCurrentPart,
  onPlayAll,
  onGoHome,
  onQuickSave,
  onSaveProjectFile,
  onOpenProjectFile,
  onImportMidi,
  onOpenCommandPalette,
  onOpenExport,
  onOpenSettings,
  onOpenHelp,
}) => {
  const [playing, setPlaying] = useState(false);
  const [playScope, setPlayScope] = useState<string>('all');
  const [timecode, setTimecode] = useState('001:1:1');
  const tapTimesRef = useRef<number[]>([]);

  useEffect(() => {
    let raf = 0;
    const poll = () => {
      const t = audioEngine.readTelemetry();
      setPlaying(t.playing);
      setPlayScope(audioEngine.getPlaybackScope().scope);
      const totalSteps = Math.floor(Math.max(0, t.beatPosition) * 4);
      const bar = Math.floor(totalSteps / 16) + 1;
      const beat = Math.floor((totalSteps % 16) / 4) + 1;
      const step = (totalSteps % 4) + 1;
      setTimecode(`${String(bar).padStart(3, '0')}:${beat}:${step}`);
      raf = requestAnimationFrame(poll);
    };
    raf = requestAnimationFrame(poll);
    return () => cancelAnimationFrame(raf);
  }, []);

  const handleStop = () => {
    audioEngine.stop(true);
  };

  const handleToggleRecord = async () => {
    const nextRec = !project.recording;
    projectStore.update((s) => {
      s.recording = nextRec;
    }, false);
    if (nextRec && !playing) {
      onPlayCurrentPart();
    }
  };

  const handleTapTempo = () => {
    const now = performance.now();
    const list = tapTimesRef.current.filter((t) => now - t < 2500);
    list.push(now);
    tapTimesRef.current = list.slice(-6);
    if (list.length >= 2) {
      let sum = 0;
      for (let i = 1; i < list.length; i++) sum += list[i] - list[i - 1];
      const avgMs = sum / (list.length - 1);
      const bpm = Math.max(40, Math.min(260, Math.round(60000 / avgMs)));
      projectStore.update((s) => {
        s.bpm = bpm;
      }, false);
    }
  };

  const isPlayingPart = playing && playScope !== 'all';
  const isPlayingAll = playing && playScope === 'all';
  const masterTrack = project.mixerTracks.find((t) => t.kind === 'master');

  return (
    <div className="topbar-stack">
      {/* Row 1: App Brand, File Actions, Command Search, Settings & Export */}
      <header className="topbar">
        <div className="transport-group">
          <button
            className="sm icon-only"
            onClick={onGoHome}
            title="Home Screen (Recent Projects, New Templates & Guide)"
          >
            <Home size={13} />
          </button>
          <button
            className={project.browserOpen ? 'active sm icon-only' : 'sm icon-only'}
            onClick={() => projectStore.update((s) => { s.browserOpen = !s.browserOpen; }, false)}
            title="Toggle Studio Browser (Plugins, Loops, Sound Library, Files, Project)"
          >
            <PanelLeft size={13} />
          </button>
          <div className="wordmark" style={{ cursor: 'pointer', marginLeft: 2 }} onClick={onGoHome}>Bebeat</div>
        </div>

        <input
          type="text"
          value={project.name}
          onChange={(e) => projectStore.update((s) => { s.name = e.target.value; }, false)}
          title="Project Name"
          style={{ width: 138, padding: '3px 8px', fontSize: 11.5 }}
        />

        <div className="topbar-sep" />

        <div className="transport-group">
          <button className="sm" onClick={onOpenProjectFile} title="Open .bebeat Project File">
            <FolderOpen size={12} />
            <span>Open</span>
          </button>
          <button className="sm" onClick={onQuickSave} title="Save to Recent Projects (Ctrl+S)">
            <Save size={12} />
            <span>Save</span>
          </button>
          <button className="sm" onClick={onSaveProjectFile} title="Save .bebeat Project File to Disk">
            <span>Save As</span>
          </button>
          <button className="sm" onClick={onImportMidi} title="Upload & Import .mid MIDI Song (Multi-Track + Sheet Music)">
            <Upload size={12} />
            <span>Import .mid</span>
          </button>
        </div>

        <div className="topbar-sep" />

        <div className="transport-group">
          <button
            className="sm icon-only"
            disabled={!projectStore.canUndo()}
            onClick={() => projectStore.undo()}
            title="Undo (Ctrl+Z)"
          >
            <Undo2 size={13} />
          </button>
          <button
            className="sm icon-only"
            disabled={!projectStore.canRedo()}
            onClick={() => projectStore.redo()}
            title="Redo (Ctrl+Y)"
          >
            <Redo2 size={13} />
          </button>
        </div>

        <div className="spacer" />

        <button
          className="cmd-trigger"
          onClick={onOpenCommandPalette}
          title="Search tools, plugins, MIDI, sheet music (Ctrl+K)"
        >
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, minWidth: 0, overflow: 'hidden' }}>
            <Search size={12} style={{ flex: 'none' }} />
            <span style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>Search tools, plugins...</span>
          </span>
          <span className="cmd-kbd">Ctrl+K</span>
        </button>

        <div className="spacer" />

        <div className="transport-group">
          <button className="sm icon-only" onClick={onOpenHelp} title="Quick Help & Keyboard Shortcuts">
            <HelpCircle size={13} />
          </button>
          <button className="sm" onClick={onOpenSettings} title="Audio WASAPI, MIDI Learn, Theme & Python Settings">
            <SlidersHorizontal size={12} />
            <span>Settings</span>
          </button>
          <button className="primary sm" onClick={onOpenExport} title="Lossless Mastering & Stem Export">
            <Download size={12} />
            <span>Export</span>
          </button>
        </div>
      </header>

      {/* Row 2: Dedicated Transport, Timecode, BPM, Swing, Keys, Master Vol & Pitch */}
      <div className="transport-strip">
        <div className="transport-group">
          <button
            className={isPlayingPart ? 'active sm' : 'sm'}
            onClick={() => (isPlayingPart ? audioEngine.stop(false) : onPlayCurrentPart())}
            title="Play only the active section / instrument you are editing (Space)"
          >
            <Play size={11} fill={isPlayingPart ? '#ffffff' : 'none'} />
            <span>{isPlayingPart ? 'Pause' : PART_PLAY_LABELS[activeTab]}</span>
          </button>

          <button
            className={isPlayingAll ? 'active sm' : 'sm'}
            onClick={() => (isPlayingAll ? audioEngine.stop(false) : onPlayAll())}
            title="Play all channels, patterns, and active live code together (Shift+Space)"
          >
            <Layers size={11} />
            <span>{isPlayingAll ? 'Playing All' : 'Play All'}</span>
          </button>

          <button className="sm icon-only" onClick={handleStop} title="Stop and Reset Playhead">
            <Square size={11} />
          </button>

          <button
            className={project.recording ? 'rec-armed sm' : 'sm'}
            onClick={() => void handleToggleRecord()}
            title="Record notes live from your PC Keyboard or MIDI controller into the Piano Roll"
          >
            <span className="rec-dot" />
            <span>{project.recording ? 'Rec ON' : 'Rec'}</span>
          </button>

          <button
            className={project.loopEnabled ? 'active sm' : 'sm'}
            onClick={() => projectStore.update((s) => { s.loopEnabled = !s.loopEnabled; }, false)}
            title="Toggle Loop"
          >
            <Repeat size={11} />
            <span>Loop</span>
          </button>

          <button
            className={project.metronome ? 'active sm' : 'sm'}
            onClick={() => projectStore.update((s) => { s.metronome = !s.metronome; }, false)}
            title="Metronome Click"
          >
            <Radio size={11} />
            <span>Click</span>
          </button>
        </div>

        <div className="time-readout mono" title="BAR : BEAT : STEP">
          {timecode}
        </div>

        <div className="param-pill">
          <span>BPM</span>
          <input
            type="number"
            min={40}
            max={260}
            step={1}
            value={project.bpm}
            onChange={(e) => {
              const val = Number(e.target.value);
              if (!Number.isNaN(val)) {
                projectStore.update((s) => { s.bpm = Math.max(40, Math.min(260, val)); }, false);
              }
            }}
          />
        </div>
        <button className="sm" onClick={handleTapTempo} title="Click rhythmically to set BPM">
          Tap
        </button>

        <div className="param-pill">
          <span>Swing</span>
          <input
            type="number"
            min={0}
            max={45}
            step={1}
            style={{ width: 36 }}
            value={Math.round(project.swing * 100)}
            onChange={(e) => {
              const val = Number(e.target.value);
              if (!Number.isNaN(val)) {
                projectStore.update((s) => { s.swing = Math.max(0, Math.min(0.45, val / 100)); }, false);
              }
            }}
          />
          <span className="mono">%</span>
        </div>

        <button
          className={project.typingKeyboardEnabled ? 'active sm' : 'sm'}
          onClick={() =>
            projectStore.update((s) => {
              s.typingKeyboardEnabled = !s.typingKeyboardEnabled;
            }, false)
          }
          title="Play piano on your computer keyboard (Z-M lower octave, Q-P upper octave, [ / ] change octave)"
        >
          <Keyboard size={11} />
          <span>Keys Oct {project.typingOctave}</span>
        </button>

        <div className="spacer" />

        <div className="param-pill" title="Master Output Volume">
          <span>Vol</span>
          <input
            type="range"
            min={0}
            max={1.3}
            step={0.02}
            style={{ width: 58 }}
            value={masterTrack?.volume ?? 0.96}
            onChange={(e) => {
              const v = parseFloat(e.target.value);
              projectStore.update((s) => {
                const m = s.mixerTracks.find((t) => t.kind === 'master');
                if (m) m.volume = v;
              }, false);
            }}
          />
        </div>

        <div className="param-pill" title="Global Master Pitch Shift (Semitones)">
          <span>Pitch</span>
          <input
            type="number"
            min={-12}
            max={12}
            step={1}
            style={{ width: 34 }}
            value={project.masterPitchSemi}
            onChange={(e) => {
              const v = Math.max(-12, Math.min(12, parseInt(e.target.value, 10) || 0));
              projectStore.update((s) => { s.masterPitchSemi = v; }, false);
            }}
          />
        </div>

        <button
          className={project.automationRecording ? 'rec-armed sm' : 'sm'}
          onClick={() => projectStore.update((s) => { s.automationRecording = !s.automationRecording; }, false)}
          title="Record live knob/X-Y controller movements into Automation Lanes"
        >
          Auto Rec
        </button>
      </div>
    </div>
  );
};
