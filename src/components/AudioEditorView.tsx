import React, { useEffect, useRef, useState } from 'react';
import {
  Mic,
  Square,
  Play,
  RotateCcw,
  Scissors,
  Headphones,
  Upload,
  Plus,
  Activity,
  MessageSquare,
  Crop,
  Trash2,
  Music,
} from 'lucide-react';
import type { ProjectState } from '../types/daw';
import { audioEngine } from '../audio/engine';
import {
  applyFadeAudioBuffer,
  deleteRegionAudioBuffer,
  detectTransientSlices,
  liveAudioRecorder,
  normalizeAudioBuffer,
  reverseAudioBuffer,
  sliceAudioBuffer,
  type RecordedAudioTake,
  type TunerReading,
} from '../audio/audioRecorder';
import {
  RETRO_VOICE_PRESETS,
  createRetroSpeechAudioBuffer,
  type RetroVoiceId,
} from '../audio/dsp/retroSpeech';
import { createChannel, createEmptySteps, projectStore, uid } from '../state/projectStore';

interface AudioEditorViewProps {
  project: ProjectState;
}

const SPEECH_PHRASE_CHIPS = [
  'Bebeat in the studio',
  'Drop the bass',
  'System online',
  'One two three four',
  'Turn it up now',
  'Welcome to the future',
];

export const AudioEditorView: React.FC<AudioEditorViewProps> = ({ project }) => {
  const [takes, setTakes] = useState<RecordedAudioTake[]>(() => liveAudioRecorder.listTakes());
  const [selectedBufferKey, setSelectedBufferKey] = useState<string>('kits/808_clean/bd.wav');
  const [activeTakeId, setActiveTakeId] = useState<string | null>(null);
  const [isRecMic, setIsRecMic] = useState(false);
  const [monitoring, setMonitoring] = useState(liveAudioRecorder.getInputMonitoring());
  const [flexRate, setFlexRate] = useState(1.0);
  const [pitchSemi, setPitchSemi] = useState(0);
  const [slices, setSlices] = useState<number[]>([]);
  const [tunerReading, setTunerReading] = useState<TunerReading | null>(null);
  const [micLevel, setMicLevel] = useState(0);
  const [statusMsg, setStatusMsg] = useState(
    'Upload or drag & drop any MP3/WAV/FLAC song, drag across the waveform to select a bit, or generate Retro Speech.'
  );
  const [dragOver, setDragOver] = useState(false);

  // Waveform selection region [0..1 normalized]
  const [selStart, setSelStart] = useState<number | null>(null);
  const [selEnd, setSelEnd] = useState<number | null>(null);
  const selectingRef = useRef<{ anchor: number } | null>(null);

  // Right sidebar tab: Retro Speech TTS vs Tuner & Takes
  const [rightTab, setRightTab] = useState<'tts' | 'tuner'>('tts');

  // Retro Speech Synthesizer controls
  const [ttsText, setTtsText] = useState('Bebeat in the studio');
  const [ttsVoice, setTtsVoice] = useState<RetroVoiceId>('sam_82');
  const [ttsPitchHz, setTtsPitchHz] = useState(118);
  const [ttsSpeed, setTtsSpeed] = useState(1.0);
  const [ttsFormant, setTtsFormant] = useState(1.0);
  const [ttsCrush, setTtsCrush] = useState(0.55);
  const [ttsBusy, setTtsBusy] = useState(false);

  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  const activeBuffer: AudioBuffer | undefined = activeTakeId
    ? takes.find((t) => t.id === activeTakeId)?.buffer
    : audioEngine.getKitBuffer(selectedBufferKey);

  const activeLabel = activeTakeId
    ? takes.find((t) => t.id === activeTakeId)?.name || 'Audio Clip'
    : selectedBufferKey.replace(/^kits\//, '');

  const normSel =
    selStart !== null && selEnd !== null && Math.abs(selEnd - selStart) > 0.004
      ? { a: Math.min(selStart, selEnd), b: Math.max(selStart, selEnd) }
      : null;

  // Draw waveform + selection highlight + transient slice markers
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    const w = canvas.width;
    const h = canvas.height;

    ctx.fillStyle = '#141416';
    ctx.fillRect(0, 0, w, h);

    // Selection background highlight
    if (normSel) {
      const sx = normSel.a * w;
      const sw = (normSel.b - normSel.a) * w;
      ctx.fillStyle = 'rgba(47, 124, 246, 0.24)';
      ctx.fillRect(sx, 0, sw, h);
      ctx.strokeStyle = '#2f7cf6';
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.moveTo(sx, 0);
      ctx.lineTo(sx, h);
      ctx.moveTo(sx + sw, 0);
      ctx.lineTo(sx + sw, h);
      ctx.stroke();
    }

    // Center zero line
    ctx.strokeStyle = '#1E2C49';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(0, h / 2);
    ctx.lineTo(w, h / 2);
    ctx.stroke();

    if (!activeBuffer) {
      ctx.fillStyle = '#94A3B8';
      ctx.font = '13px "Inter", sans-serif';
      ctx.fillText('Drop an MP3, WAV, FLAC, or OGG file here — or click Upload Audio / Generate Retro Speech.', 20, h / 2);
      return;
    }

    const data = activeBuffer.getChannelData(0);
    const step = Math.max(1, Math.floor(data.length / w));
    for (let x = 0; x < w; x++) {
      let min = 1;
      let max = -1;
      const start = x * step;
      for (let j = 0; j < step && start + j < data.length; j++) {
        const v = data[start + j];
        if (v < min) min = v;
        if (v > max) max = v;
      }
      const inSel = normSel && x / w >= normSel.a && x / w <= normSel.b;
      ctx.fillStyle = inSel ? '#FFFFFF' : '#CBD5E1';
      const y1 = (1 - max) * (h / 2);
      const y2 = (1 - min) * (h / 2);
      ctx.fillRect(x, y1, 1, Math.max(1, y2 - y1));
    }

    // Draw Slicex / Flex Time transient markers
    if (slices.length > 0 && activeBuffer.duration > 0) {
      ctx.strokeStyle = '#38BDF8';
      ctx.lineWidth = 1.2;
      for (const s of slices) {
        const x = (s / activeBuffer.duration) * w;
        ctx.beginPath();
        ctx.moveTo(x, 0);
        ctx.lineTo(x, h);
        ctx.stroke();
      }
    }
  }, [activeBuffer, slices, normSel]);

  // Live Tuner polling loop
  useEffect(() => {
    let raf = 0;
    const poll = () => {
      const ac = audioEngine.getAudioContext();
      if (ac) {
        const res = liveAudioRecorder.readMicTuner(ac.sampleRate);
        setMicLevel(res.level);
        if (res.tuner) setTunerReading(res.tuner);
      }
      raf = requestAnimationFrame(poll);
    };
    raf = requestAnimationFrame(poll);
    return () => cancelAnimationFrame(raf);
  }, []);

  const ingestUploadedBytes = async (name: string, bytes: Uint8Array) => {
    try {
      const key = await audioEngine.loadCustomSample(name, bytes);
      const buf = audioEngine.getKitBuffer(key);
      if (buf) {
        const take = liveAudioRecorder.addTakeBuffer(name, buf);
        audioEngine.registerAudioBuffer(take.id, buf);
        setTakes(liveAudioRecorder.listTakes());
        setActiveTakeId(take.id);
        setSlices([]);
        setSelStart(null);
        setSelEnd(null);
        setStatusMsg(`Loaded "${name}" (${buf.duration.toFixed(2)}s). Drag on waveform to select any bit to extract.`);
      }
    } catch (err) {
      setStatusMsg(`Could not decode "${name}": ${err instanceof Error ? err.message : String(err)}`);
    }
  };

  const handleImportFile = async () => {
    if (window.bebeat?.pickAudioOrSf2) {
      const picked = await window.bebeat.pickAudioOrSf2();
      if (picked) await ingestUploadedBytes(picked.name, picked.bytes);
      return;
    }
    const inp = document.createElement('input');
    inp.type = 'file';
    inp.accept = '.mp3,.wav,.flac,.ogg,.m4a,.aac,audio/*';
    inp.onchange = async () => {
      const f = inp.files?.[0];
      if (f) await ingestUploadedBytes(f.name, new Uint8Array(await f.arrayBuffer()));
    };
    inp.click();
  };

  const handleDropFile = async (e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(false);
    const f = e.dataTransfer.files?.[0];
    if (!f) return;
    await ingestUploadedBytes(f.name, new Uint8Array(await f.arrayBuffer()));
  };

  const handleToggleMicRecord = async () => {
    await audioEngine.ensureInitialized();
    const ac = audioEngine.getAudioContext();
    if (!ac) return;
    if (!isRecMic) {
      try {
        await liveAudioRecorder.startRecording(ac);
        setIsRecMic(true);
        setStatusMsg('Recording live audio take... Click Stop Take when finished.');
      } catch (err) {
        setStatusMsg(`Microphone access denied: ${err instanceof Error ? err.message : String(err)}`);
      }
    } else {
      const take = await liveAudioRecorder.stopRecording(ac);
      setIsRecMic(false);
      if (take) {
        audioEngine.registerAudioBuffer(take.id, take.buffer);
        setTakes(liveAudioRecorder.listTakes());
        setActiveTakeId(take.id);
        setSlices([]);
        setSelStart(null);
        setSelEnd(null);
        setStatusMsg(`Captured "${take.name}" (${take.durationSec.toFixed(2)}s).`);
      }
    }
  };

  const replaceCurrentBuffer = (next: AudioBuffer, label: string) => {
    const updated = liveAudioRecorder.addTakeBuffer(label, next);
    audioEngine.registerAudioBuffer(updated.id, next);
    setTakes(liveAudioRecorder.listTakes());
    setActiveTakeId(updated.id);
    setSelStart(null);
    setSelEnd(null);
    setStatusMsg(`Created "${label}" (${next.duration.toFixed(2)}s).`);
  };

  const getSelectedSubBuffer = async (): Promise<{ buf: AudioBuffer; label: string } | null> => {
    await audioEngine.ensureInitialized();
    const ac = audioEngine.getAudioContext();
    if (!ac || !activeBuffer) return null;
    if (normSel) {
      const s = normSel.a * activeBuffer.duration;
      const e = normSel.b * activeBuffer.duration;
      const chopped = sliceAudioBuffer(ac, activeBuffer, s, e);
      return { buf: chopped, label: `${activeLabel} [${s.toFixed(1)}s-${e.toFixed(1)}s]` };
    }
    return { buf: activeBuffer, label: activeLabel };
  };

  const handleCropToSelection = async () => {
    const res = await getSelectedSubBuffer();
    if (!res) return;
    replaceCurrentBuffer(res.buf, `Chop — ${res.label}`);
  };

  const handleDeleteSelection = async () => {
    await audioEngine.ensureInitialized();
    const ac = audioEngine.getAudioContext();
    if (!ac || !activeBuffer || !normSel) return;
    const cut = deleteRegionAudioBuffer(ac, activeBuffer, normSel.a * activeBuffer.duration, normSel.b * activeBuffer.duration);
    replaceCurrentBuffer(cut, `${activeLabel} (Cut)`);
  };

  const handleSendBitToPlaylist = async (customBuf?: AudioBuffer, customLabel?: string) => {
    const picked = customBuf ? { buf: customBuf, label: customLabel || activeLabel } : await getSelectedSubBuffer();
    if (!picked) return;
    const key = `chop_${Date.now().toString(36)}`;
    audioEngine.registerAudioBuffer(key, picked.buf);
    const beats = Math.max(1, Math.round(((picked.buf.duration / flexRate) * project.bpm) / 60));
    projectStore.update((s) => {
      s.playlistClips.push({
        id: uid('clip'),
        trackIndex: 2,
        kind: 'audio',
        audioBufferId: key,
        label: picked.label,
        startBeat: 0,
        durationBeats: beats,
        offsetBeats: 0,
        muted: false,
      });
    });
    setStatusMsg(`Added "${picked.label}" (${beats} beats) to Playlist Track 3.`);
  };

  const handleSendBitToSamplerChannel = async (customBuf?: AudioBuffer, customLabel?: string) => {
    const picked = customBuf ? { buf: customBuf, label: customLabel || activeLabel } : await getSelectedSubBuffer();
    if (!picked) return;
    const key = `sampler_${Date.now().toString(36)}`;
    audioEngine.registerAudioBuffer(key, picked.buf);
    const insertTracks = project.mixerTracks.filter((m) => m.kind === 'insert');

    projectStore.update((s) => {
      const ch = createChannel({
        name: picked.label.slice(0, 26),
        engine: 'Sampler',
        mixerTrackId: insertTracks[s.channels.length % insertTracks.length]?.id || 'mx_1',
        color: '#38BDF8',
      });
      ch.sampler.sampleName = picked.label;
      ch.sampler.assetPath = key;
      ch.sampler.rootMidi = 60;
      s.channels.push(ch);
      for (const pat of s.patterns) {
        pat.steps[ch.id] = createEmptySteps(pat.lengthSteps);
        pat.notes[ch.id] = [];
      }
      s.selectedChannelId = ch.id;
    });
    void audioEngine.playBufferOnce(picked.buf, effectiveRate);
    setStatusMsg(`Created playable Sampler channel "${picked.label}" — play it on your keyboard or Piano Roll!`);
  };

  const handleGenerateRetroSpeech = async () => {
    if (!ttsText.trim()) return;
    setTtsBusy(true);
    try {
      await audioEngine.ensureInitialized();
      const ac = audioEngine.getAudioContext();
      if (!ac) return;

      let speechBuf: AudioBuffer;
      const preset = RETRO_VOICE_PRESETS.find((v) => v.id === ttsVoice) || RETRO_VOICE_PRESETS[0];

      if (ttsVoice === 'windows_sapi' && window.bebeat?.renderSapiTts) {
        const rateParam = Math.round((ttsSpeed - 1.0) * 6);
        const res = await window.bebeat.renderSapiTts(ttsText, rateParam);
        if (res.ok && res.bytes) {
          const copy = new Uint8Array(res.bytes.byteLength);
          copy.set(res.bytes);
          speechBuf = await ac.decodeAudioData(copy.buffer);
        } else {
          // Graceful fallback to SAM 1982 formant synth if SAPI unavailable
          speechBuf = createRetroSpeechAudioBuffer(ac, {
            text: ttsText,
            voiceId: 'sam_82',
            pitchHz: ttsPitchHz,
            speed: ttsSpeed,
            formantShift: ttsFormant,
            bitcrush: ttsCrush,
          });
          setStatusMsg(`Windows SAPI unavailable (${res.error || 'browser mode'}); rendered with SAM 1982 synth.`);
        }
      } else {
        speechBuf = createRetroSpeechAudioBuffer(ac, {
          text: ttsText,
          voiceId: ttsVoice === 'windows_sapi' ? 'sam_82' : ttsVoice,
          pitchHz: ttsPitchHz,
          speed: ttsSpeed,
          formantShift: ttsFormant,
          bitcrush: ttsCrush,
        });
      }

      const clipName = `TTS (${preset.name.split(' ')[0]}): ${ttsText.slice(0, 18)}`;
      const take = liveAudioRecorder.addTakeBuffer(clipName, speechBuf);
      audioEngine.registerAudioBuffer(take.id, speechBuf);
      setTakes(liveAudioRecorder.listTakes());
      setActiveTakeId(take.id);
      setSelStart(null);
      setSelEnd(null);
      setSlices([]);
      await audioEngine.playBufferOnce(speechBuf, 1.0);
      setStatusMsg(`Generated "${clipName}" (${speechBuf.duration.toFixed(2)}s). Send to Playlist or Sampler!`);
    } finally {
      setTtsBusy(false);
    }
  };

  const effectiveRate = flexRate * Math.pow(2, pitchSemi / 12);
  const allBufs = audioEngine.listAllLoadedBuffers();

  return (
    <div
      style={{ flex: 1, display: 'flex', minHeight: 0, background: 'var(--bg)' }}
      onDragOver={(e) => {
        e.preventDefault();
        setDragOver(true);
      }}
      onDragLeave={() => setDragOver(false)}
      onDrop={(e) => void handleDropFile(e)}
    >
      {/* Main Audio Editor, Music File Chopper, Flex Time & Slicex */}
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minWidth: 0 }}>
        <div className="panel-header" style={{ overflowX: 'auto' }}>
          <span className="panel-title">Audio Editor &amp; Sampler</span>

          <button className="primary sm" onClick={() => void handleImportFile()} title="Upload MP3, WAV, FLAC, OGG, or M4A music files to edit & chop">
            <Upload size={11} /> Upload MP3 / WAV
          </button>

          <button
            className={isRecMic ? 'rec-armed sm' : 'sm'}
            onClick={() => void handleToggleMicRecord()}
          >
            {isRecMic ? <Square size={11} /> : <Mic size={11} />}
            <span>{isRecMic ? 'Stop Take' : 'Record Mic'}</span>
          </button>

          <button
            className={monitoring ? 'active sm' : 'sm'}
            onClick={async () => {
              await audioEngine.ensureInitialized();
              const ac = audioEngine.getAudioContext();
              if (ac) {
                try { await liveAudioRecorder.ensureMic(ac); } catch {}
              }
              const next = !monitoring;
              liveAudioRecorder.setInputMonitoring(next);
              setMonitoring(next);
            }}
          >
            <Headphones size={11} /> Monitor
          </button>

          <div className="topbar-sep" />

          <button
            className="sm"
            disabled={!activeBuffer}
            onClick={() => {
              if (!activeBuffer) return;
              if (normSel) {
                const startS = normSel.a * activeBuffer.duration;
                const durS = (normSel.b - normSel.a) * activeBuffer.duration;
                void audioEngine.playBufferOnce(activeBuffer, effectiveRate, startS, durS);
              } else {
                void audioEngine.playBufferOnce(activeBuffer, effectiveRate);
              }
            }}
          >
            <Play size={11} /> {normSel ? 'Play Selection' : 'Play All'}
          </button>

          <button className="sm" disabled={!normSel} onClick={() => void handleCropToSelection()} title="Keep only the highlighted region">
            <Crop size={11} /> Crop
          </button>
          <button className="sm" disabled={!normSel} onClick={() => void handleDeleteSelection()} title="Remove the highlighted region">
            <Trash2 size={11} /> Cut Out
          </button>

          <button
            className="sm"
            disabled={!activeBuffer}
            onClick={async () => {
              await audioEngine.ensureInitialized();
              const ac = audioEngine.getAudioContext();
              if (ac && activeBuffer) replaceCurrentBuffer(reverseAudioBuffer(ac, activeBuffer), `${activeLabel} (Rev)`);
            }}
          >
            <RotateCcw size={11} /> Reverse
          </button>

          <button
            className="sm"
            disabled={!activeBuffer}
            onClick={async () => {
              await audioEngine.ensureInitialized();
              const ac = audioEngine.getAudioContext();
              if (ac && activeBuffer) replaceCurrentBuffer(normalizeAudioBuffer(ac, activeBuffer, 0.95), `${activeLabel} (Norm)`);
            }}
          >
            Normalize
          </button>

          <button
            className="sm"
            disabled={!activeBuffer}
            onClick={async () => {
              await audioEngine.ensureInitialized();
              const ac = audioEngine.getAudioContext();
              if (ac && activeBuffer) replaceCurrentBuffer(applyFadeAudioBuffer(ac, activeBuffer, 0.025, 0.08), `${activeLabel} (Fade)`);
            }}
          >
            Fade
          </button>

          <button
            className="sm"
            disabled={!activeBuffer}
            onClick={() => {
              if (!activeBuffer) return;
              const found = detectTransientSlices(activeBuffer, 0.6);
              setSlices(found);
              setStatusMsg(`Slicex auto-chopped ${found.length} transient slices. Click any slice pad below to play or extract.`);
            }}
          >
            <Scissors size={11} /> Auto-Slice
          </button>
        </div>

        {/* Row 2: Extract Selection to Track / Sampler + Flex Time + Pitch */}
        <div className="panel-header" style={{ height: 34, background: 'var(--bg-alt)', gap: 10, overflowX: 'auto' }}>
          <button
            className="primary sm"
            disabled={!activeBuffer}
            onClick={() => void handleSendBitToPlaylist()}
            title="Extract the highlighted bit (or whole clip) onto Playlist Track 3"
          >
            <Plus size={11} /> {normSel ? 'Add Selected Bit → Playlist' : 'Add Clip → Playlist'}
          </button>

          <button
            className="sm"
            disabled={!activeBuffer}
            onClick={() => void handleSendBitToSamplerChannel()}
            title="Extract the highlighted bit into a playable Sampler instrument in your Channel Rack"
          >
            <Music size={11} /> {normSel ? 'Extract Bit → Sampler Key' : 'Send → Sampler Key'}
          </button>

          {normSel && (
            <button className="sm" onClick={() => { setSelStart(null); setSelEnd(null); }}>
              Clear Sel
            </button>
          )}

          <div className="topbar-sep" />
          <label style={{ display: 'flex', alignItems: 'center', gap: 6, width: 170 }}>
            <span style={{ color: '#94A3B8', fontSize: 11 }}>Flex</span>
            <input type="range" min={0.5} max={2.0} step={0.05} value={flexRate} onChange={(e) => setFlexRate(parseFloat(e.target.value))} />
            <span className="mono" style={{ width: 38 }}>{flexRate.toFixed(2)}x</span>
          </label>

          <label style={{ display: 'flex', alignItems: 'center', gap: 6, width: 170 }}>
            <span style={{ color: '#94A3B8', fontSize: 11 }}>Pitch</span>
            <input type="range" min={-12} max={12} step={1} value={pitchSemi} onChange={(e) => setPitchSemi(parseInt(e.target.value, 10))} />
            <span className="mono" style={{ width: 38 }}>{pitchSemi >= 0 ? `+${pitchSemi}` : pitchSemi}st</span>
          </label>

          <select
            value={activeTakeId ? '' : selectedBufferKey}
            onChange={(e) => {
              setActiveTakeId(null);
              setSelectedBufferKey(e.target.value);
              setSlices([]);
              setSelStart(null);
              setSelEnd(null);
            }}
            style={{ maxWidth: 190, marginLeft: 'auto' }}
          >
            <option value="">-- Bundled Samples --</option>
            {allBufs.map((b) => (
              <option key={b.key} value={b.key}>
                {b.key.replace(/^kits\//, '')} ({b.durationSec.toFixed(2)}s)
              </option>
            ))}
          </select>
        </div>

        {/* Interactive Waveform Canvas (Drag to Select a Bit, Drop MP3/WAV anywhere) */}
        <div style={{ flex: 1, padding: 12, display: 'flex', flexDirection: 'column', gap: 8, minHeight: 0 }}>
          <canvas
            ref={canvasRef}
            width={960}
            height={260}
            onMouseDown={(e) => {
              if (!activeBuffer) return;
              const rect = e.currentTarget.getBoundingClientRect();
              const frac = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
              selectingRef.current = { anchor: frac };
              setSelStart(frac);
              setSelEnd(frac);
            }}
            onMouseMove={(e) => {
              if (!selectingRef.current || e.buttons !== 1) return;
              const rect = e.currentTarget.getBoundingClientRect();
              const frac = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
              setSelEnd(frac);
            }}
            onMouseUp={() => {
              if (!selectingRef.current) return;
              const anchor = selectingRef.current.anchor;
              selectingRef.current = null;
              if (activeBuffer && selEnd !== null && Math.abs(selEnd - anchor) < 0.005) {
                setSelStart(null);
                setSelEnd(null);
                void audioEngine.playBufferOnce(activeBuffer, effectiveRate, anchor * activeBuffer.duration);
              }
            }}
            style={{
              width: '100%',
              flex: 1,
              minHeight: 165,
              background: 'var(--bg)',
              border: dragOver ? '2px solid #FFFFFF' : '1px solid var(--border)',
              borderRadius: 4,
              cursor: 'text',
            }}
            title="Drag across waveform to highlight a bit to chop/sample, or click to audition from that spot"
          />

          {/* Slicex Auto-Slice Chop Pads */}
          {slices.length > 1 && activeBuffer && (
            <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
              {slices.slice(0, 16).map((startS, idx) => {
                const endS = slices[idx + 1] ?? activeBuffer.duration;
                return (
                  <button
                    key={idx}
                    className="sm mono"
                    onClick={() => void audioEngine.playBufferOnce(activeBuffer, effectiveRate, startS, endS - startS)}
                    onContextMenu={async (e) => {
                      e.preventDefault();
                      const ac = audioEngine.getAudioContext();
                      if (!ac) return;
                      const chop = sliceAudioBuffer(ac, activeBuffer, startS, endS);
                      await handleSendBitToSamplerChannel(chop, `${activeLabel} S${idx + 1}`);
                    }}
                    title="Click to play slice · Right-click to turn into Sampler channel"
                  >
                    S{idx + 1} ({(endS - startS).toFixed(2)}s)
                  </button>
                );
              })}
            </div>
          )}

          {/* Status & Selection Time Readout */}
          <div
            style={{
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              background: 'var(--panel)',
              border: '1px solid var(--border)',
              borderRadius: 4,
              padding: '6px 10px',
              fontSize: 11,
              color: 'var(--ink-dim)',
              gap: 10,
            }}
          >
            <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{statusMsg}</span>
            <span className="mono" style={{ flex: 'none', color: '#FFFFFF' }}>
              {activeBuffer && normSel
                ? `SEL ${(normSel.a * activeBuffer.duration).toFixed(2)}s–${(normSel.b * activeBuffer.duration).toFixed(2)}s (${((normSel.b - normSel.a) * activeBuffer.duration).toFixed(2)}s)`
                : activeBuffer
                ? `${activeLabel} · ${activeBuffer.duration.toFixed(2)}s`
                : 'No clip loaded'}
            </span>
          </div>
        </div>
      </div>

      {/* Right Studio Rail: Retro Text-to-Speech Synth + Tuner & Clips/Takes */}
      <aside className="mixer-fx-rack" style={{ width: 330 }}>
        <div className="panel-header" style={{ gap: 5, padding: '0 8px' }}>
          <button
            className={rightTab === 'tts' ? 'active sm' : 'sm'}
            style={{ flex: 1 }}
            onClick={() => setRightTab('tts')}
          >
            <MessageSquare size={11} /> Retro Speech (TTS)
          </button>
          <button
            className={rightTab === 'tuner' ? 'active sm' : 'sm'}
            style={{ flex: 1 }}
            onClick={() => setRightTab('tuner')}
          >
            <Activity size={11} /> Tuner &amp; Clips ({takes.length})
          </button>
        </div>

        {rightTab === 'tts' ? (
          <div className="panel-scroll" style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            <div style={{ fontSize: 11, color: 'var(--ink-dim)' }}>
              Generate classic 8-bit SAM, robotic DAW speech, vocoder, whisper, or Windows SAPI voices as editable audio clips.
            </div>

            <textarea
              value={ttsText}
              onChange={(e) => setTtsText(e.target.value)}
              placeholder="Type words, producer tags, or lyrics..."
              style={{
                width: '100%',
                height: 68,
                background: 'var(--bg)',
                color: 'var(--ink)',
                border: '1px solid var(--border)',
                borderRadius: 4,
                padding: 8,
                fontFamily: 'var(--font-ui)',
                fontSize: 12,
                resize: 'none',
                userSelect: 'text',
              }}
            />

            {/* Quick Vocal Tag Chips */}
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
              {SPEECH_PHRASE_CHIPS.map((phrase) => (
                <button
                  key={phrase}
                  className="sm"
                  style={{ fontSize: 10, padding: '2px 6px' }}
                  onClick={() => setTtsText(phrase)}
                >
                  {phrase}
                </button>
              ))}
            </div>

            <label className="field-label">
              Voice Character
              <select
                value={ttsVoice}
                onChange={(e) => {
                  const id = e.target.value as RetroVoiceId;
                  setTtsVoice(id);
                  const p = RETRO_VOICE_PRESETS.find((x) => x.id === id);
                  if (p) {
                    setTtsPitchHz(p.defaultPitchHz);
                    setTtsSpeed(p.defaultSpeed);
                    setTtsFormant(p.formantShift);
                    setTtsCrush(p.bitcrush);
                  }
                }}
              >
                {RETRO_VOICE_PRESETS.map((v) => (
                  <option key={v.id} value={v.id}>{v.name}</option>
                ))}
              </select>
            </label>

            <div className="inst-section" style={{ padding: 8 }}>
              <div className="param-row">
                <label>Pitch</label>
                <input type="range" min={55} max={320} step={1} value={ttsPitchHz} onChange={(e) => setTtsPitchHz(parseFloat(e.target.value))} />
                <span className="val">{Math.round(ttsPitchHz)}Hz</span>
              </div>
              <div className="param-row">
                <label>Speed</label>
                <input type="range" min={0.45} max={2.0} step={0.05} value={ttsSpeed} onChange={(e) => setTtsSpeed(parseFloat(e.target.value))} />
                <span className="val">{ttsSpeed.toFixed(2)}x</span>
              </div>
              <div className="param-row">
                <label>Throat</label>
                <input type="range" min={0.6} max={1.65} step={0.02} value={ttsFormant} onChange={(e) => setTtsFormant(parseFloat(e.target.value))} />
                <span className="val">{ttsFormant.toFixed(2)}</span>
              </div>
              <div className="param-row" style={{ marginBottom: 0 }}>
                <label>8-Bit Crush</label>
                <input type="range" min={0} max={1} step={0.05} value={ttsCrush} onChange={(e) => setTtsCrush(parseFloat(e.target.value))} />
                <span className="val">{Math.round(ttsCrush * 100)}%</span>
              </div>
            </div>

            <button
              className="primary"
              disabled={ttsBusy}
              onClick={() => void handleGenerateRetroSpeech()}
            >
              <Play size={12} fill="#080C18" />
              <span>{ttsBusy ? 'Synthesizing...' : 'Generate Speech Clip'}</span>
            </button>

            <div style={{ display: 'flex', gap: 6 }}>
              <button className="sm" style={{ flex: 1 }} disabled={!activeBuffer} onClick={() => void handleSendBitToPlaylist()}>
                + Playlist
              </button>
              <button className="sm" style={{ flex: 1 }} disabled={!activeBuffer} onClick={() => void handleSendBitToSamplerChannel()}>
                + Sampler Key
              </button>
            </div>
          </div>
        ) : (
          <>
            <div style={{ padding: 12, borderBottom: '1px solid var(--border)' }}>
              <div style={{ fontSize: 11, color: 'var(--ink-dim)', marginBottom: 6 }}>Live Chromatic Tuner (Mic / Line-In)</div>
              <div
                style={{
                  background: 'var(--bg)',
                  border: '1px solid var(--border)',
                  borderRadius: 4,
                  padding: 12,
                  textAlign: 'center',
                }}
              >
                <div className="mono" style={{ fontSize: 28, fontWeight: 700, color: '#FFFFFF' }}>
                  {tunerReading ? tunerReading.noteName : '--'}
                </div>
                <div className="mono" style={{ fontSize: 11, color: '#94A3B8', marginTop: 2 }}>
                  {tunerReading
                    ? `${tunerReading.frequency.toFixed(1)} Hz · ${tunerReading.cents >= 0 ? '+' : ''}${tunerReading.cents} ct`
                    : 'Enable Monitor or Record Mic'}
                </div>
                <div style={{ height: 6, background: 'var(--panel-elev)', borderRadius: 2, marginTop: 10, position: 'relative' }}>
                  <div style={{ position: 'absolute', left: '50%', top: 0, bottom: 0, width: 2, background: '#4ADE80' }} />
                  {tunerReading && (
                    <div
                      style={{
                        position: 'absolute',
                        left: `${Math.max(4, Math.min(96, 50 + tunerReading.cents))}%`,
                        top: -2,
                        width: 6,
                        height: 10,
                        background: Math.abs(tunerReading.cents) <= 5 ? '#4ADE80' : '#FFFFFF',
                        transform: 'translateX(-50%)',
                      }}
                    />
                  )}
                </div>
                <div style={{ height: 4, background: 'var(--panel-elev)', marginTop: 8 }}>
                  <div style={{ width: `${Math.min(100, Math.round(micLevel * 180))}%`, height: '100%', background: '#60A5FA' }} />
                </div>
              </div>
            </div>

            <div className="panel-scroll">
              <div style={{ fontSize: 11, fontWeight: 700, color: '#FFFFFF', marginBottom: 6 }}>
                Uploaded Songs, Chops, TTS &amp; Takes ({takes.length})
              </div>
              {takes.length === 0 ? (
                <div style={{ fontSize: 11, color: '#64748B' }}>
                  Upload an MP3/WAV, record a mic take, or generate Retro Speech to see all your clips here.
                </div>
              ) : (
                takes.map((t) => (
                  <button
                    key={t.id}
                    className={`preset-item ${activeTakeId === t.id ? 'active' : ''}`}
                    onClick={() => {
                      setActiveTakeId(t.id);
                      setSlices([]);
                      setSelStart(null);
                      setSelEnd(null);
                    }}
                  >
                    <div style={{ display: 'flex', justifyContent: 'space-between', width: '100%' }}>
                      <span style={{ fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis' }}>{t.name}</span>
                      <span className="mono" style={{ fontSize: 10 }}>{t.durationSec.toFixed(2)}s</span>
                    </div>
                    <span className="mono" style={{ fontSize: 9.5, opacity: 0.7 }}>{t.createdAt}</span>
                  </button>
                ))
              )}
            </div>
          </>
        )}
      </aside>
    </div>
  );
};
