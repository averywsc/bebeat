import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  Play,
  BookmarkPlus,
  Layers,
  AudioWaveform,
  Volume2,
  Code2,
  Plus,
  Zap,
} from 'lucide-react';
import type { LiveCodeLang, ProjectState } from '../types/daw';
import { projectStore, uid } from '../state/projectStore';
import { BUILTIN_CODE_PRESETS, CODE_SNIPPETS } from '../state/presets';
import { compileJsLiveCode } from '../livecode/jsRuntime';
import { compilePythonLiveCode, type PythonRuntimeMode } from '../livecode/pythonRuntime';
import { extractInlineCodePreviews, type InlinePatternPreview } from '../livecode/astPreview';
import { audioEngine } from '../audio/engine';

interface LiveCodeStudioProps {
  project: ProjectState;
  pythonMode: PythonRuntimeMode;
}

export const LiveCodeStudio: React.FC<LiveCodeStudioProps> = ({ project, pythonMode }) => {
  const [drawerTab, setDrawerTab] = useState<'presets' | 'snippets'>('presets');
  const [langFilter, setLangFilter] = useState<'all' | LiveCodeLang>('all');
  const [consoleLines, setConsoleLines] = useState<string[]>([
    'Ready. Press Ctrl+Enter to evaluate and quantized hot-reload without stopping playback.',
  ]);
  const [statusBadge, setStatusBadge] = useState<'idle' | 'live' | 'pending' | 'error'>('idle');
  const [playStep16, setPlayStep16] = useState(-1);
  const [liveBands, setLiveBands] = useState({ sub: 0, low: 0, mid: 0, highs: 0, kick: 0, phase: 0 });
  const [bakingWav, setBakingWav] = useState(false);

  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const activeBuf =
    project.liveCodeBuffers.find((b) => b.id === project.activeLiveCodeBufferId) || project.liveCodeBuffers[0];

  const allPresets = useMemo(
    () => [...project.userCodePresets, ...BUILTIN_CODE_PRESETS],
    [project.userCodePresets]
  );

  const previews = useMemo(
    () => (activeBuf ? extractInlineCodePreviews(activeBuf.code) : []),
    [activeBuf?.code]
  );

  useEffect(() => {
    let raf = 0;
    let tick = 0;
    const poll = () => {
      const t = audioEngine.readTelemetry();
      tick++;
      if (t.playing) {
        setPlayStep16(Math.floor((t.beatPosition % 4) * 4));
      } else {
        setPlayStep16(-1);
      }
      if (tick % 4 === 0) {
        setLiveBands({
          sub: t.bands.sub,
          low: t.bands.lowMid,
          mid: t.bands.highMid,
          highs: t.bands.air,
          kick: t.kickEnv,
          phase: t.beatPhase,
        });
        if (audioEngine.isPendingHotReload()) {
          setStatusBadge('pending');
        } else if (activeBuf?.active && statusBadge === 'pending') {
          setStatusBadge('live');
        }
      }
      raf = requestAnimationFrame(poll);
    };
    raf = requestAnimationFrame(poll);
    return () => cancelAnimationFrame(raf);
  }, [activeBuf?.active, statusBadge]);

  if (!activeBuf) return null;

  const updateBufferCode = (nextCode: string) => {
    projectStore.update((s) => {
      const b = s.liveCodeBuffers.find((x) => x.id === activeBuf.id);
      if (b) b.code = nextCode;
    }, false);
  };

  const evaluateAndHotReload = async (autoStart = true) => {
    await audioEngine.ensureInitialized();
    const prog =
      activeBuf.lang === 'javascript'
        ? compileJsLiveCode(activeBuf.code, project.bpm)
        : await compilePythonLiveCode(activeBuf.code, pythonMode, project.bpm);

    if (!prog.ok) {
      setStatusBadge('error');
      setConsoleLines([`[ERROR] ${prog.error}`, ...prog.logs]);
      return;
    }

    projectStore.update((s) => {
      s.liveCodeBuffers.forEach((b) => {
        b.active = b.id === activeBuf.id;
      });
    }, false);

    audioEngine.applyLiveCodeProgram(prog, activeBuf.quantize);
    if (autoStart && !audioEngine.readTelemetry().playing) {
      await audioEngine.play({ scope: 'live-code-only' });
    }

    setStatusBadge(audioEngine.isPendingHotReload() ? 'pending' : 'live');
    setConsoleLines([
      `[OK] Compiled ${activeBuf.lang.toUpperCase()} (${prog.events.length} events across ${prog.loopBars} bar${prog.loopBars > 1 ? 's' : ''}, quantize=${activeBuf.quantize})`,
      ...prog.logs,
    ]);
  };

  const handleStopLiveCode = () => {
    audioEngine.setLiveCodeActive(false);
    projectStore.update((s) => {
      s.liveCodeBuffers.forEach((b) => { b.active = false; });
    }, false);
    setStatusBadge('idle');
    setConsoleLines((prev) => ['[LIVE CODE] Muted live code scheduler.', ...prev.slice(0, 6)]);
  };

  const handleBakeToPattern = async () => {
    const prog =
      activeBuf.lang === 'javascript'
        ? compileJsLiveCode(activeBuf.code, project.bpm)
        : await compilePythonLiveCode(activeBuf.code, pythonMode, project.bpm);
    if (!prog.ok) {
      setConsoleLines([`[ERROR] Cannot bake: ${prog.error}`]);
      return;
    }
    const pat = audioEngine.bakeLiveCodeToPattern(prog, `${activeBuf.name} Baked`);
    setConsoleLines([`[BAKED] Created editable pattern "${pat.name}" and placed on Playlist Track 2.`]);
  };

  const handleBakeToWav = async () => {
    setBakingWav(true);
    try {
      const prog =
        activeBuf.lang === 'javascript'
          ? compileJsLiveCode(activeBuf.code, project.bpm)
          : await compilePythonLiveCode(activeBuf.code, pythonMode, project.bpm);
      if (!prog.ok) {
        setConsoleLines([`[ERROR] Cannot render WAV: ${prog.error}`]);
        return;
      }
      await audioEngine.bakeLiveCodeToAudioClip(prog);
      setConsoleLines([`[BAKED WAV] Rendered ${prog.loopBars}-bar lossless 32-bit float clip onto Playlist Track 3.`]);
    } finally {
      setBakingWav(false);
    }
  };

  const loadPreset = (preset: (typeof allPresets)[number]) => {
    projectStore.update((s) => {
      const b = s.liveCodeBuffers.find((x) => x.id === activeBuf.id);
      if (b) {
        b.lang = preset.lang;
        b.code = preset.code;
        b.name = `${preset.name.toLowerCase().replace(/[^a-z0-9]+/g, '_').slice(0, 18)}.${preset.lang === 'python' ? 'py' : 'js'}`;
      }
      s.bpm = preset.bpm;
    });
    setConsoleLines([`[PRESET] Loaded "${preset.name}" (${preset.lang.toUpperCase()}, ${preset.bpm} BPM). Press Ctrl+Enter to run.`]);
  };

  const insertSnippetAtCursor = (snippetCode: string) => {
    const ta = textareaRef.current;
    if (!ta) {
      updateBufferCode(`${activeBuf.code}\n${snippetCode}`);
      return;
    }
    const start = ta.selectionStart ?? activeBuf.code.length;
    const end = ta.selectionEnd ?? activeBuf.code.length;
    const next = `${activeBuf.code.slice(0, start)}\n${snippetCode}\n${activeBuf.code.slice(end)}`;
    updateBufferCode(next);
  };

  const saveAsCustomPreset = () => {
    const title = window.prompt('Save current live code buffer as Code Preset:', activeBuf.name.replace(/\.(js|py)$/, ''));
    if (!title || !title.trim()) return;
    projectStore.addUserCodePreset({
      name: title.trim(),
      category: 'User',
      lang: activeBuf.lang,
      description: `Custom ${activeBuf.lang} live code preset`,
      bpm: project.bpm,
      code: activeBuf.code,
    });
    setConsoleLines([`[SAVED] Stored user code preset "${title.trim()}".`]);
  };

  const addBuffer = (lang: LiveCodeLang) => {
    const id = uid('buf');
    projectStore.update((s) => {
      s.liveCodeBuffers.push({
        id,
        name: lang === 'python' ? `sketch_${s.liveCodeBuffers.length + 1}.py` : `sketch_${s.liveCodeBuffers.length + 1}.js`,
        lang,
        code: lang === 'python' ? BUILTIN_CODE_PRESETS[5].code : BUILTIN_CODE_PRESETS[0].code,
        quantize: 'bar',
        active: false,
      });
      s.activeLiveCodeBufferId = id;
    });
  };

  const lineCount = activeBuf.code.split(/\r?\n/).length;

  return (
    <div className="livecode-layout">
      {/* Left Drawer: Built-in & Custom Code Presets + Code Snippets */}
      <aside className="panel-col">
        <div className="panel-header" style={{ gap: 4 }}>
          <button
            className={drawerTab === 'presets' ? 'active sm' : 'sm'}
            style={{ flex: 1 }}
            onClick={() => setDrawerTab('presets')}
          >
            Code Presets
          </button>
          <button
            className={drawerTab === 'snippets' ? 'active sm' : 'sm'}
            style={{ flex: 1 }}
            onClick={() => setDrawerTab('snippets')}
          >
            Snippets
          </button>
        </div>

        <div style={{ padding: '6px 8px', borderBottom: '1px solid #24324D', display: 'flex', gap: 4 }}>
          {(['all', 'javascript', 'python'] as const).map((lf) => (
            <button
              key={lf}
              className={langFilter === lf ? 'active sm' : 'sm'}
              style={{ flex: 1 }}
              onClick={() => setLangFilter(lf)}
            >
              {lf === 'all' ? 'All' : lf === 'javascript' ? 'JS' : 'Python'}
            </button>
          ))}
        </div>

        <div className="panel-scroll">
          {drawerTab === 'presets'
            ? allPresets
                .filter((p) => langFilter === 'all' || p.lang === langFilter)
                .map((p) => (
                  <button key={p.id} className="preset-item" onClick={() => loadPreset(p)}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', width: '100%' }}>
                      <span style={{ fontWeight: 600, color: '#FFFFFF' }}>{p.name}</span>
                      <span className="mono" style={{ fontSize: 9.5, color: '#60A5FA' }}>
                        {p.lang === 'python' ? 'PY' : 'JS'}
                      </span>
                    </div>
                    <span style={{ fontSize: 10.5, color: '#94A3B8', whiteSpace: 'normal', lineHeight: 1.3 }}>
                      {p.description}
                    </span>
                    <span className="mono" style={{ fontSize: 9.5, color: '#64748B' }}>
                      {p.category} · {p.bpm} BPM
                    </span>
                  </button>
                ))
            : CODE_SNIPPETS.filter((sn) => langFilter === 'all' || sn.lang === langFilter).map((sn) => (
                <button
                  key={sn.id}
                  className="preset-item"
                  onClick={() => insertSnippetAtCursor(sn.code)}
                  title="Click to insert snippet at editor cursor"
                >
                  <div style={{ display: 'flex', justifyContent: 'space-between', width: '100%' }}>
                    <span style={{ fontWeight: 600, color: '#FFFFFF' }}>{sn.name}</span>
                    <span className="mono" style={{ fontSize: 9.5, color: '#60A5FA' }}>
                      {sn.lang === 'python' ? 'PY' : 'JS'}
                    </span>
                  </div>
                  <code className="mono" style={{ fontSize: 10, color: '#94A3B8', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', width: '100%' }}>
                    {sn.code.split('\n')[0]}
                  </code>
                </button>
              ))}
        </div>
      </aside>

      {/* Center Code Editor + Toolbar + Console */}
      <div style={{ display: 'flex', flexDirection: 'column', minWidth: 0, minHeight: 0, borderRight: '1px solid #24324D' }}>
        <div className="panel-header" style={{ overflowX: 'auto' }}>
          <div style={{ display: 'flex', gap: 4 }}>
            {project.liveCodeBuffers.map((b) => (
              <button
                key={b.id}
                className={b.id === activeBuf.id ? 'active sm mono' : 'sm mono'}
                onClick={() => projectStore.update((s) => { s.activeLiveCodeBufferId = b.id; }, false)}
              >
                {b.name}
              </button>
            ))}
            <button className="sm icon-only" onClick={() => addBuffer('javascript')} title="New JS Buffer">
              <Plus size={11} />
            </button>
          </div>

          <div className="topbar-sep" />
          <select
            className="mono"
            value={activeBuf.lang}
            onChange={(e) => {
              const lang = e.target.value as LiveCodeLang;
              projectStore.update((s) => {
                const b = s.liveCodeBuffers.find((x) => x.id === activeBuf.id);
                if (b) b.lang = lang;
              });
            }}
          >
            <option value="javascript">JavaScript (Strudel/Gibber)</option>
            <option value="python">Python ({pythonMode})</option>
          </select>

          <select
            value={activeBuf.quantize}
            onChange={(e) =>
              projectStore.update((s) => {
                const b = s.liveCodeBuffers.find((x) => x.id === activeBuf.id);
                if (b) b.quantize = e.target.value as 'beat' | 'bar' | 'immediate';
              }, false)
            }
            title="Quantized Hot Reload Boundary"
          >
            <option value="bar">Sync: Bar</option>
            <option value="beat">Sync: Beat</option>
            <option value="immediate">Sync: Instant</option>
          </select>

          <button className="primary sm" onClick={() => void evaluateAndHotReload(true)} title="Evaluate & Hot Reload (Ctrl+Enter)">
            <Play size={11} fill="#080C18" /> Run (Ctrl+Enter)
          </button>
          {activeBuf.active && (
            <button className="sm danger-outline" onClick={handleStopLiveCode}>
              Mute Code
            </button>
          )}

          <div className="spacer" />

          <button className="sm" onClick={() => void handleBakeToPattern()} title="Bake live code into editable Piano Roll / Channel Rack Pattern">
            <Layers size={12} /> Bake Pattern
          </button>
          <button className="sm" disabled={bakingWav} onClick={() => void handleBakeToWav()} title="Render lossless WAV clip onto Playlist">
            <AudioWaveform size={12} /> {bakingWav ? 'Baking...' : 'Bake WAV'}
          </button>
          <button className="sm icon-only" onClick={saveAsCustomPreset} title="Save as Code Preset">
            <BookmarkPlus size={12} />
          </button>
        </div>

        {/* Live Beat/Audio Variables Bar */}
        <div
          className="mono"
          style={{
            flex: 'none',
            background: '#0B1020',
            borderBottom: '1px solid #24324D',
            padding: '4px 10px',
            display: 'flex',
            gap: 14,
            fontSize: 10.5,
            color: '#94A3B8',
            alignItems: 'center',
          }}
        >
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}>
            <span className={`status-dot ${statusBadge === 'live' ? 'live' : statusBadge === 'pending' ? 'pending' : ''}`} />
            {statusBadge.toUpperCase()}
          </span>
          <span>beat.phase={liveBands.phase.toFixed(2)}</span>
          <span>env.kick={liveBands.kick.toFixed(2)}</span>
          <span>bands.sub={liveBands.sub.toFixed(2)}</span>
          <span>bands.mid={liveBands.mid.toFixed(2)}</span>
          <span>bands.highs={liveBands.highs.toFixed(2)}</span>
        </div>

        {/* Monospace Code Editor */}
        <div className="code-editor-area">
          <div className="code-gutter">
            {Array.from({ length: lineCount }, (_, i) => (
              <div key={i}>{i + 1}</div>
            ))}
          </div>
          <textarea
            ref={textareaRef}
            className="code-textarea"
            spellCheck={false}
            value={activeBuf.code}
            onChange={(e) => updateBufferCode(e.target.value)}
            onKeyDown={(e) => {
              if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
                e.preventDefault();
                void evaluateAndHotReload(true);
              }
            }}
          />
        </div>

        {/* Live Execution Console */}
        <div className="code-console">
          {consoleLines.map((line, idx) => (
            <div
              key={idx}
              style={{
                color: line.startsWith('[ERROR]')
                  ? '#F87171'
                  : line.startsWith('[OK]') || line.startsWith('[BAKED')
                  ? '#FFFFFF'
                  : '#94A3B8',
              }}
            >
              {line}
            </div>
          ))}
        </div>
      </div>

      {/* Right Panel: Inline AST Pattern & Piano Roll Previews + Isolated Audition */}
      <aside className="panel-col" style={{ borderRight: 'none' }}>
        <div className="panel-header">
          <Code2 size={13} />
          <span className="panel-title">Live AST Previews</span>
          <span className="mono" style={{ marginLeft: 'auto', fontSize: 10, color: '#64748B' }}>
            {previews.length} DETECTED
          </span>
        </div>

        <div className="panel-scroll">
          {previews.length === 0 ? (
            <div style={{ color: '#64748B', fontSize: 11.5, padding: 8 }}>
              Write `.pattern(...)`, `.notes(...)`, `.euclid(...)`, or `Chord.min7(...)` in your code to see synced mini step grids, mini piano rolls, and 1-click audition previews here.
            </div>
          ) : (
            previews.map((prev: InlinePatternPreview) => (
              <div key={prev.id} className="preview-card">
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
                  <div style={{ minWidth: 0 }}>
                    <div className="mono" style={{ fontSize: 10, color: '#60A5FA' }}>LINE {prev.line}</div>
                    <div style={{ fontSize: 11, fontWeight: 600, color: '#FFFFFF', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                      {prev.label}
                    </div>
                  </div>
                  <button
                    className="sm"
                    onClick={() => void audioEngine.auditionInlinePreview(prev)}
                    title="Audition this pattern on isolated preview bus"
                  >
                    <Volume2 size={11} /> Audition
                  </button>
                </div>

                {/* Mini 16-Step Drum Grid */}
                {prev.drumRows && (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
                    {prev.drumRows.map((row) => (
                      <div key={row.voice} style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                        <span className="mono" style={{ width: 28, fontSize: 9.5, color: '#94A3B8' }}>
                          {row.voice.toUpperCase()}
                        </span>
                        <div style={{ flex: 1, display: 'grid', gridTemplateColumns: 'repeat(16, 1fr)', gap: 2 }}>
                          {row.steps.map((on, si) => (
                            <div
                              key={si}
                              style={{
                                height: 11,
                                borderRadius: 1,
                                background: on
                                  ? playStep16 === si
                                    ? '#60A5FA'
                                    : '#FFFFFF'
                                  : playStep16 === si
                                  ? '#2E3F61'
                                  : '#080C18',
                                border: '1px solid #1E2C49',
                              }}
                            />
                          ))}
                        </div>
                      </div>
                    ))}
                  </div>
                )}

                {/* Mini Piano Roll / Chord Preview */}
                {prev.notes && prev.notes.length > 0 && (() => {
                  const minM = Math.min(...prev.notes.map((n) => n.midi)) - 2;
                  const maxM = Math.max(...prev.notes.map((n) => n.midi)) + 2;
                  const span = Math.max(8, maxM - minM);
                  return (
                    <div
                      style={{
                        height: 52,
                        background: '#080C18',
                        border: '1px solid #24324D',
                        position: 'relative',
                        borderRadius: 2,
                        overflow: 'hidden',
                      }}
                    >
                      {prev.notes.map((n, ni) => {
                        const leftPct = (n.startBeat / 4) * 100;
                        const wPct = Math.max(4, (n.duration / 4) * 100);
                        const topPct = ((maxM - n.midi) / span) * 84 + 4;
                        const activeNow =
                          playStep16 >= 0 &&
                          playStep16 * 0.25 >= n.startBeat - 0.05 &&
                          playStep16 * 0.25 < n.startBeat + n.duration;
                        return (
                          <div
                            key={ni}
                            style={{
                              position: 'absolute',
                              left: `${leftPct}%`,
                              width: `${wPct}%`,
                              top: `${topPct}%`,
                              height: 5,
                              background: activeNow ? '#60A5FA' : '#FFFFFF',
                              borderRadius: 1,
                            }}
                          />
                        );
                      })}
                      {playStep16 >= 0 && (
                        <div
                          style={{
                            position: 'absolute',
                            top: 0,
                            bottom: 0,
                            left: `${(playStep16 / 16) * 100}%`,
                            width: 1,
                            background: 'rgba(255,255,255,0.65)',
                          }}
                        />
                      )}
                    </div>
                  );
                })()}
              </div>
            ))
          )}

          {/* Built-in Runtime API Quick Reference */}
          <div className="inst-section" style={{ marginTop: 10 }}>
            <div className="inst-section-title" style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
              <Zap size={11} /> Built-in Runtime Helpers
            </div>
            <div className="mono" style={{ fontSize: 10, color: '#94A3B8', lineHeight: 1.65 }}>
              <div>Scale.minor("C3"), Chord.min9("F3")</div>
              <div>euclid(5, 8), polyrhythm(3, 4), markov(...)</div>
              <div>lfo.sine(hz, lo, hi), lfo.tri / saw</div>
              <div>bands.sub / low / mid / highs.map(lo, hi)</div>
              <div>env.follow("kick").map(lo, hi)</div>
              <div>beat.phase.map(lo, hi), beat.onBeat(1)</div>
            </div>
          </div>
        </div>
      </aside>
    </div>
  );
};
