import React, { useEffect, useState } from 'react';
import { X, Trash2 } from 'lucide-react';
import type { ProjectState } from '../types/daw';
import type { SystemCapabilities } from '../services/bridge';
import type { PythonRuntimeMode } from '../livecode/pythonRuntime';
import { audioEngine } from '../audio/engine';
import { projectStore } from '../state/projectStore';
import { THEME_PRESETS } from '../audio/catalog/plugins';

interface SettingsModalProps {
  project: ProjectState;
  capabilities: SystemCapabilities | null;
  pythonMode: PythonRuntimeMode;
  onChangePythonMode: (mode: PythonRuntimeMode) => void;
  onClose: () => void;
}

export const SettingsModal: React.FC<SettingsModalProps> = ({
  project,
  capabilities,
  pythonMode,
  onChangePythonMode,
  onClose,
}) => {
  const [devices, setDevices] = useState<MediaDeviceInfo[]>([]);
  const current = audioEngine.getAudioOutputSettings();
  const [selectedSink, setSelectedSink] = useState(current.outputDeviceId);
  const [wasapiMode, setWasapiMode] = useState<'shared' | 'exclusive'>(current.wasapiMode);
  const midiDevices = audioEngine.getMidiDevices();

  useEffect(() => {
    if (navigator.mediaDevices?.enumerateDevices) {
      navigator.mediaDevices
        .enumerateDevices()
        .then((list) => setDevices(list.filter((d) => d.kind === 'audiooutput')))
        .catch(() => {});
    }
  }, []);

  const applyAudio = async () => {
    await audioEngine.setOutputDevice(selectedSink, wasapiMode);
  };

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal-box" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <span className="panel-title">Audio Output (WASAPI), Web MIDI &amp; Python Runtime</span>
          <button className="icon-only sm" onClick={onClose}>
            <X size={14} />
          </button>
        </div>

        <div className="modal-body">
          {/* Audio Output & WASAPI */}
          <div className="inst-section">
            <div className="inst-section-title">Windows Audio Engine &amp; WASAPI</div>
            <div className="kv-grid">
              <label className="field-label">
                Output Device
                <select value={selectedSink} onChange={(e) => setSelectedSink(e.target.value)}>
                  <option value="default">System Default (WASAPI)</option>
                  {devices.map((d) => (
                    <option key={d.deviceId} value={d.deviceId}>
                      {d.label || `Audio Output (${d.deviceId.slice(0, 8)})`}
                    </option>
                  ))}
                </select>
              </label>

              <label className="field-label">
                WASAPI Mode
                <select value={wasapiMode} onChange={(e) => setWasapiMode(e.target.value as 'shared' | 'exclusive')}>
                  <option value="shared">WASAPI Shared (Low-Latency Interactive)</option>
                  <option value="exclusive">WASAPI Exclusive (Direct Hardware)</option>
                </select>
              </label>
            </div>

            <div className="mono" style={{ display: 'flex', gap: 16, marginTop: 10, fontSize: 10.5, color: '#94A3B8' }}>
              <span>SR: {current.sampleRate} Hz</span>
              <span>BASE LATENCY: {current.baseLatencyMs} ms</span>
              <span>TELEMETRY: {current.sabActive ? 'SharedArrayBuffer Lock-Free' : 'MessagePort Fallback'}</span>
            </div>
            <div style={{ marginTop: 8 }}>
              <button className="sm" onClick={() => void applyAudio()}>
                Apply Output Device
              </button>
            </div>
          </div>

          {/* Python Live Coding Bridge */}
          <div className="inst-section">
            <div className="inst-section-title">Python Live Coding Runtime</div>
            <label className="field-label">
              Execution Engine
              <select value={pythonMode} onChange={(e) => onChangePythonMode(e.target.value as PythonRuntimeMode)}>
                <option value="auto">Auto (Local Python 3 Bridge with Embedded Fallback)</option>
                <option value="local">Local System Python 3 (NumPy / SciPy / Full Stdlib)</option>
                <option value="embedded">Embedded Zero-Install Python Evaluator</option>
              </select>
            </label>
            <div className="mono" style={{ marginTop: 8, fontSize: 10.5, color: '#94A3B8' }}>
              Detected System Python: {capabilities?.pythonVersion || 'Not detected (Embedded mode ready)'}
              <br />
              FFmpeg Lossless Transcoder: {capabilities?.ffmpegAvailable ? 'Bundled Ready' : 'Offline WAV Mode'}
              <br />
              Resource Root: {capabilities?.resourceRoot || './assets'}
            </div>
          </div>

          {/* Theme Customization & Audio Unit / Plugin Extensions */}
          <div className="inst-section">
            <div className="inst-section-title">Theme Customization &amp; Plugin Extensions</div>
            <div className="kv-grid">
              <label className="field-label">
                Studio Color Theme
                <select
                  value={project.themeId}
                  onChange={(e) => projectStore.update((s) => { s.themeId = e.target.value; }, false)}
                >
                  {THEME_PRESETS.map((th) => (
                    <option key={th.id} value={th.id}>{th.name}</option>
                  ))}
                </select>
              </label>

              <label className="field-label">
                Plugin Host Bridge
                <input
                  type="text"
                  readOnly
                  value="AudioWorklet + WASM + SF2 + AU/VST3 Bridge"
                />
              </label>
            </div>
          </div>

          {/* Web MIDI Hardware & MIDI Learn Mappings */}
          <div className="inst-section">
            <div className="inst-section-title">Web MIDI Controllers &amp; MIDI Learn Mappings</div>
            <div className="mono" style={{ fontSize: 10.5, color: '#94A3B8', marginBottom: 8 }}>
              {midiDevices.length === 0
                ? 'No hardware MIDI controllers detected. Plug in a USB MIDI keyboard or controller for plug-and-play note & CC input.'
                : midiDevices.map((d) => `${d.name} (${d.state})`).join(' · ')}
            </div>

            {project.midiMappings.length === 0 ? (
              <div style={{ fontSize: 11, color: '#64748B' }}>
                No MIDI CC mappings yet. Use "MIDI Learn Cutoff" in the Instruments view and turn any hardware knob.
              </div>
            ) : (
              project.midiMappings.map((m, idx) => (
                <div
                  key={idx}
                  className="mono"
                  style={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                    padding: '4px 0',
                    borderBottom: '1px solid var(--border)',
                    fontSize: 11,
                  }}
                >
                  <span>
                    CH{m.channel} CC#{m.cc} → {m.targetType}:{m.param} ({m.min}..{m.max})
                  </span>
                  <button
                    className="sm icon-only danger-outline"
                    onClick={() =>
                      projectStore.update((s) => {
                        s.midiMappings.splice(idx, 1);
                      })
                    }
                  >
                    <Trash2 size={11} />
                  </button>
                </div>
              ))
            )}
          </div>
        </div>

        <div className="modal-footer">
          <button className="primary" onClick={onClose}>Done</button>
        </div>
      </div>
    </div>
  );
};
