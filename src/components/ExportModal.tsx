import React, { useState } from 'react';
import { X, Download, CheckCircle2 } from 'lucide-react';
import type { ExportConfig, ProjectState } from '../types/daw';
import { audioEngine } from '../audio/engine';
import { triggerBrowserDownload } from '../services/bridge';
import type { OfflineRenderStats } from '../audio/offlineRenderer';

interface ExportModalProps {
  project: ProjectState;
  ffmpegAvailable: boolean;
  onClose: () => void;
}

const FORMAT_EXT: Record<ExportConfig['format'], string> = {
  wav32f: 'wav',
  wav24: 'wav',
  wav16: 'wav',
  flac: 'flac',
  aiff: 'aiff',
  mp3: 'mp3',
  ogg: 'ogg',
};

export const ExportModal: React.FC<ExportModalProps> = ({ project, ffmpegAvailable, onClose }) => {
  const [config, setConfig] = useState<ExportConfig>({
    format: 'wav24',
    sampleRate: 48000,
    dither: 'tpdf',
    truePeakCeilingDb: -1.0,
    range: 'loop',
    exportStems: false,
    preserveTailSec: 2.0,
    selectionStartBeat: 0,
    selectionEndBeat: 16,
  });

  const [rendering, setRendering] = useState(false);
  const [progressMsg, setProgressMsg] = useState('');
  const [lastStats, setLastStats] = useState<OfflineRenderStats | null>(null);
  const [savedPath, setSavedPath] = useState<string | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const isElectron = Boolean(window.bebeat?.isElectron);

  const handleExport = async () => {
    setRendering(true);
    setErrorMsg(null);
    setSavedPath(null);
    setLastStats(null);

    try {
      const ext = FORMAT_EXT[config.format];
      const baseName = project.name.replace(/[^a-z0-9_-]+/gi, '_').toLowerCase();

      if (config.exportStems) {
        const insertTracks = project.mixerTracks.filter((t) => t.kind === 'insert');
        let folder: string | null = null;
        if (window.bebeat?.pickExportFolder) {
          folder = await window.bebeat.pickExportFolder();
          if (!folder) {
            setRendering(false);
            return;
          }
        }

        for (let i = 0; i < insertTracks.length; i++) {
          const track = insertTracks[i];
          setProgressMsg(`Rendering stem ${i + 1}/${insertTracks.length}: ${track.name}...`);
          const { wavBytes, stats } = await audioEngine.renderStemOffline(config, track.id);
          setLastStats(stats);
          const stemFile = `${baseName}_stem_${track.index}_${track.name.replace(/[^a-z0-9]+/gi, '_').toLowerCase()}.${ext}`;
          if (window.bebeat?.transcodeSave && folder) {
            const outPath = `${folder}\\${stemFile}`;
            const res = await window.bebeat.transcodeSave({
              wavBytes,
              outputPath: outPath,
              format: config.format,
              sampleRate: config.sampleRate,
              dither: config.dither,
              truePeakCeilingDb: config.truePeakCeilingDb,
            });
            if (!res.ok) throw new Error(res.error || 'Stem export failed');
          } else {
            triggerBrowserDownload(stemFile, wavBytes, 'audio/wav');
          }
        }
        setSavedPath(folder ? `${folder} (${insertTracks.length} stems)` : `Downloaded ${insertTracks.length} stems`);
        setProgressMsg('Batch stem export complete.');
      } else {
        let outPath: string | null = null;
        if (window.bebeat?.pickExportPath) {
          outPath = await window.bebeat.pickExportPath(`${baseName}.${ext}`, ext);
          if (!outPath) {
            setRendering(false);
            return;
          }
        }

        setProgressMsg('Running non-realtime offline DSP render...');
        const { wavBytes, stats } = await audioEngine.renderMasterOffline(config);
        setLastStats(stats);

        if (window.bebeat?.transcodeSave && outPath) {
          setProgressMsg(`Encoding ${config.format.toUpperCase()}...`);
          const res = await window.bebeat.transcodeSave({
            wavBytes,
            outputPath: outPath,
            format: config.format,
            sampleRate: config.sampleRate,
            dither: config.dither,
            truePeakCeilingDb: config.truePeakCeilingDb,
          });
          if (!res.ok) throw new Error(res.error || 'Export failed');
          setSavedPath(res.path);
        } else {
          triggerBrowserDownload(`${baseName}.${ext}`, wavBytes, 'audio/wav');
          setSavedPath(`${baseName}.${ext} (browser download)`);
        }
        setProgressMsg('Lossless render complete.');
      }
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : String(err));
    } finally {
      setRendering(false);
    }
  };

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal-box" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <div>
            <div className="panel-title">Lossless Mastering &amp; Stem Export</div>
            <div style={{ fontSize: 10.5, color: '#94A3B8', marginTop: 2 }}>
              True non-realtime OfflineAudioContext rendering with TPDF / Shaped Dither &amp; True Peak Ceiling
            </div>
          </div>
          <button className="icon-only sm" onClick={onClose}>
            <X size={14} />
          </button>
        </div>

        <div className="modal-body">
          <div className="kv-grid">
            <label className="field-label">
              Audio Format
              <select
                className="mono"
                value={config.format}
                onChange={(e) => setConfig({ ...config, format: e.target.value as ExportConfig['format'] })}
              >
                <option value="wav32f">WAV — 32-bit IEEE Float (Lossless Master)</option>
                <option value="wav24">WAV — 24-bit PCM (Studio Lossless)</option>
                <option value="wav16">WAV — 16-bit PCM (CD Master)</option>
                <option value="flac" disabled={isElectron && !ffmpegAvailable}>
                  FLAC — Lossless Compressed {ffmpegAvailable ? '(FFmpeg)' : '(Desktop .exe)'}
                </option>
                <option value="aiff" disabled={isElectron && !ffmpegAvailable}>
                  AIFF — 24-bit Uncompressed {ffmpegAvailable ? '(FFmpeg)' : '(Desktop .exe)'}
                </option>
                <option value="mp3" disabled={isElectron && !ffmpegAvailable}>
                  MP3 — 320 kbps CBR {ffmpegAvailable ? '(FFmpeg)' : '(Desktop .exe)'}
                </option>
                <option value="ogg" disabled={isElectron && !ffmpegAvailable}>
                  OGG Vorbis — Quality 8 {ffmpegAvailable ? '(FFmpeg)' : '(Desktop .exe)'}
                </option>
              </select>
            </label>

            <label className="field-label">
              Sample Rate
              <select
                className="mono"
                value={config.sampleRate}
                onChange={(e) => setConfig({ ...config, sampleRate: parseInt(e.target.value, 10) as 44100 | 48000 | 96000 })}
              >
                <option value={44100}>44,100 Hz</option>
                <option value={48000}>48,000 Hz</option>
                <option value={96000}>96,000 Hz (Hi-Res)</option>
              </select>
            </label>

            <label className="field-label">
              Dithering (24-bit / 16-bit)
              <select
                value={config.dither}
                disabled={config.format === 'wav32f'}
                onChange={(e) => setConfig({ ...config, dither: e.target.value as ExportConfig['dither'] })}
              >
                <option value="tpdf">TPDF (Triangular PDF)</option>
                <option value="shaped">High-Pass Noise Shaped</option>
                <option value="none">None (Truncate)</option>
              </select>
            </label>

            <label className="field-label">
              True Peak Ceiling (dBTP)
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <input
                  type="range"
                  min={-3.0}
                  max={0.0}
                  step={0.1}
                  value={config.truePeakCeilingDb}
                  onChange={(e) => setConfig({ ...config, truePeakCeilingDb: parseFloat(e.target.value) })}
                />
                <span className="mono" style={{ width: 58, textAlign: 'right' }}>
                  {config.truePeakCeilingDb.toFixed(1)} dBTP
                </span>
              </div>
            </label>

            <label className="field-label">
              Export Range
              <select
                value={config.range}
                onChange={(e) => setConfig({ ...config, range: e.target.value as ExportConfig['range'] })}
              >
                <option value="loop">Active Loop / Pattern</option>
                <option value="full">Full Song Arrangement</option>
                <option value="selection">Custom Beat Selection</option>
              </select>
            </label>

            <label className="field-label">
              Reverb / Delay Tail Preservation (sec)
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <input
                  type="range"
                  min={0}
                  max={6}
                  step={0.5}
                  value={config.preserveTailSec}
                  onChange={(e) => setConfig({ ...config, preserveTailSec: parseFloat(e.target.value) })}
                />
                <span className="mono" style={{ width: 42, textAlign: 'right' }}>
                  +{config.preserveTailSec.toFixed(1)}s
                </span>
              </div>
            </label>
          </div>

          {config.range === 'selection' && (
            <div className="kv-grid">
              <label className="field-label">
                Start Beat
                <input
                  type="number"
                  min={0}
                  value={config.selectionStartBeat}
                  onChange={(e) => setConfig({ ...config, selectionStartBeat: Math.max(0, Number(e.target.value) || 0) })}
                />
              </label>
              <label className="field-label">
                End Beat
                <input
                  type="number"
                  min={1}
                  value={config.selectionEndBeat}
                  onChange={(e) => setConfig({ ...config, selectionEndBeat: Math.max(1, Number(e.target.value) || 16) })}
                />
              </label>
            </div>
          )}

          <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer', color: '#F8FAFC' }}>
            <input
              type="checkbox"
              checked={config.exportStems}
              onChange={(e) => setConfig({ ...config, exportStems: e.target.checked })}
            />
            <span>Batch Export Stems (render separate lossless file per Mixer Insert bus)</span>
          </label>

          {progressMsg && (
            <div className="mono" style={{ fontSize: 11, color: '#93C5FD', background: 'var(--bg)', padding: '7px 10px', border: '1px solid var(--border)' }}>
              {progressMsg}
            </div>
          )}

          {errorMsg && (
            <div className="mono" style={{ fontSize: 11, color: '#F87171', background: 'var(--bg)', padding: '7px 10px', border: '1px solid #7F1D1D' }}>
              [ERROR] {errorMsg}
            </div>
          )}

          {lastStats && (
            <div className="inst-section">
              <div className="inst-section-title" style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                <CheckCircle2 size={13} color="#4ADE80" /> Master Verification Readout
              </div>
              <div className="mono" style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 8, fontSize: 11 }}>
                <div>
                  <div style={{ color: '#64748B', fontSize: 9.5 }}>INTEGRATED</div>
                  <div style={{ color: '#FFFFFF', fontWeight: 600 }}>{lastStats.lufsIntegrated.toFixed(1)} LUFS</div>
                </div>
                <div>
                  <div style={{ color: '#64748B', fontSize: 9.5 }}>TRUE PEAK</div>
                  <div style={{ color: '#FFFFFF', fontWeight: 600 }}>{lastStats.truePeakDb.toFixed(2)} dBTP</div>
                </div>
                <div>
                  <div style={{ color: '#64748B', fontSize: 9.5 }}>DURATION</div>
                  <div style={{ color: '#CBD5E1' }}>{lastStats.durationSec.toFixed(2)}s</div>
                </div>
                <div>
                  <div style={{ color: '#64748B', fontSize: 9.5 }}>SAMPLE RATE</div>
                  <div style={{ color: '#CBD5E1' }}>{lastStats.sampleRate} Hz</div>
                </div>
              </div>
              {savedPath && (
                <div className="mono" style={{ marginTop: 8, fontSize: 10.5, color: '#94A3B8', wordBreak: 'break-all' }}>
                  Saved: {savedPath}
                </div>
              )}
            </div>
          )}
        </div>

        <div className="modal-footer">
          <button onClick={onClose}>Close</button>
          <button className="primary" disabled={rendering} onClick={() => void handleExport()}>
            <Download size={13} />
            <span>{rendering ? 'Rendering...' : config.exportStems ? 'Export Stems' : 'Render & Save'}</span>
          </button>
        </div>
      </div>
    </div>
  );
};
