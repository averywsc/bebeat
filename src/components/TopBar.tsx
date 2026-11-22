import React, { useEffect, useState } from 'react';
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
} from 'lucide-react';
import type { ProjectState } from '../types/daw';
import { projectStore } from '../state/projectStore';
import { audioEngine } from '../audio/engine';
import { triggerBrowserDownload } from '../services/bridge';

interface TopBarProps {
  project: ProjectState;
  onOpenExport: () => void;
  onOpenSettings: () => void;
}

export const TopBar: React.FC<TopBarProps> = ({ project, onOpenExport, onOpenSettings }) => {
  const [playing, setPlaying] = useState(false);
  const [timecode, setTimecode] = useState('001:1:1');

  useEffect(() => {
    let raf = 0;
    const poll = () => {
      const t = audioEngine.readTelemetry();
      setPlaying(t.playing);
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

  const handlePlayToggle = async () => {
    if (playing) {
      audioEngine.stop(false);
    } else {
      await audioEngine.play();
    }
  };

  const handleStop = () => {
    audioEngine.stop(true);
  };

  const handleSaveProject = async () => {
    const json = JSON.stringify(projectStore.getState(), null, 2);
    const filename = `${project.name.replace(/[^a-z0-9_-]+/gi, '_').toLowerCase()}.bebeat`;
    if (window.bebeat?.saveProject) {
      await window.bebeat.saveProject(filename, json);
    } else {
      triggerBrowserDownload(filename, json, 'application/json');
    }
  };

  const handleOpenProject = async () => {
    if (window.bebeat?.openProject) {
      const res = await window.bebeat.openProject();
      if (res?.json) {
        try {
          const parsed = JSON.parse(res.json) as ProjectState;
          if (parsed.channels && parsed.patterns) {
            projectStore.replaceState(parsed);
          }
        } catch {
          // ignore malformed file
        }
      }
      return;
    }
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.bebeat,.json';
    input.onchange = async () => {
      const file = input.files?.[0];
      if (!file) return;
      try {
        const parsed = JSON.parse(await file.text()) as ProjectState;
        if (parsed.channels && parsed.patterns) projectStore.replaceState(parsed);
      } catch {}
    };
    input.click();
  };

  return (
    <header className="topbar">
      <div className="wordmark">Bebeat</div>
      <div className="topbar-sep" />

      {/* Transport Controls */}
      <div className="transport-group">
        <button
          className={playing ? 'active' : ''}
          onClick={handlePlayToggle}
          title="Play / Pause (Space)"
        >
          <Play size={13} fill={playing ? '#080C18' : 'none'} />
          <span>{playing ? 'Playing' : 'Play'}</span>
        </button>
        <button className="icon-only" onClick={handleStop} title="Stop and Reset Playhead">
          <Square size={12} />
        </button>
        <button
          className={project.loopEnabled ? 'active sm' : 'sm'}
          onClick={() => projectStore.update((s) => { s.loopEnabled = !s.loopEnabled; }, false)}
          title="Toggle Loop"
        >
          <Repeat size={12} />
          <span>Loop</span>
        </button>
        <button
          className={project.metronome ? 'active sm' : 'sm'}
          onClick={() => projectStore.update((s) => { s.metronome = !s.metronome; }, false)}
          title="Metronome Click"
        >
          <Radio size={12} />
          <span>Click</span>
        </button>
      </div>

      {/* Mode Switch: Pattern vs Song */}
      <div className="transport-group">
        <button
          className={project.playbackMode === 'pattern' ? 'active sm' : 'sm'}
          onClick={() => projectStore.update((s) => { s.playbackMode = 'pattern'; }, false)}
        >
          PAT
        </button>
        <button
          className={project.playbackMode === 'song' ? 'active sm' : 'sm'}
          onClick={() => projectStore.update((s) => { s.playbackMode = 'song'; }, false)}
        >
          SONG
        </button>
      </div>

      <div className="time-readout mono" title="BAR : BEAT : STEP">
        {timecode}
      </div>

      {/* BPM & Swing */}
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

      <div className="param-pill">
        <span>SWING</span>
        <input
          type="number"
          min={0}
          max={45}
          step={1}
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

      <div className="topbar-sep" />

      <div className="transport-group">
        <button
          className="icon-only"
          disabled={!projectStore.canUndo()}
          onClick={() => projectStore.undo()}
          title="Undo (Ctrl+Z)"
        >
          <Undo2 size={13} />
        </button>
        <button
          className="icon-only"
          disabled={!projectStore.canRedo()}
          onClick={() => projectStore.redo()}
          title="Redo (Ctrl+Y)"
        >
          <Redo2 size={13} />
        </button>
      </div>

      <div className="spacer" />

      <div className="transport-group">
        <button onClick={handleOpenProject} title="Open .bebeat Project">
          <FolderOpen size={13} />
          <span>Open</span>
        </button>
        <button onClick={handleSaveProject} title="Save .bebeat Project">
          <Save size={13} />
          <span>Save</span>
        </button>
        <button onClick={onOpenSettings} title="Audio WASAPI, MIDI Learn & Python Runtime Settings">
          <SlidersHorizontal size={13} />
          <span>Audio / MIDI</span>
        </button>
        <button className="primary" onClick={onOpenExport} title="Lossless Mastering & Stem Export">
          <Download size={13} />
          <span>Export</span>
        </button>
      </div>
    </header>
  );
};
