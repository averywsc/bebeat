import React, { useEffect, useRef, useState } from 'react';
import { Play, Sparkles, Sliders } from 'lucide-react';
import type { ProjectState } from '../types/daw';
import { createEmptySteps, projectStore } from '../state/projectStore';
import { euclid } from '../livecode/musicTheory';
import { audioEngine } from '../audio/engine';

interface PerformanceDrummerViewProps {
  project: ProjectState;
}

const DRUMMER_STYLES = [
  { id: 'electronic', name: 'Modern Electronic', kitId: '909_punch', swing: 0.08 },
  { id: 'ukg', name: 'UK Garage 2-Step', kitId: 'ukg_break', swing: 0.28 },
  { id: 'boombap', name: 'Boom Bap Hip-Hop', kitId: '808_clean', swing: 0.22 },
  { id: 'techno', name: 'Industrial Modular', kitId: 'fm_perc', swing: 0.04 },
  { id: 'rock', name: 'Studio Acoustic Rock', kitId: '909_punch', swing: 0.06 },
];

export const PerformanceDrummerView: React.FC<PerformanceDrummerViewProps> = ({ project }) => {
  const [drummerStyle, setDrummerStyle] = useState(DRUMMER_STYLES[0].id);
  const [complexity, setComplexity] = useState(0.55); // X axis 0..1
  const [loudness, setLoudness] = useState(0.75); // Y axis 0..1
  const [fillAmount, setFillAmount] = useState(0.35);
  const [visMode, setVisMode] = useState<'rings' | 'radial' | 'tunnel' | 'grid'>('radial');
  const [xyPad, setXyPad] = useState({ x: 0.5, y: 0.5 });
  const [formulaText, setFormulaText] = useState('0.5 + 0.5 * Math.sin(t * 2.5)');
  const [formulaVal, setFormulaVal] = useState(0.5);

  const zgameRef = useRef<HTMLCanvasElement | null>(null);

  // ZGameEditor 60fps Audio-Reactive Visualizer + Formula Controller tick
  useEffect(() => {
    let raf = 0;
    const draw = (ms: number) => {
      const t = audioEngine.readTelemetry();
      const sec = ms / 1000;

      // Evaluate Formula Controller safely
      try {
        const fn = new Function('t', 'beat', 'sub', 'highs', `return (${formulaText});`);
        const v = Number(fn(sec, t.beatPhase, t.bands.sub, t.bands.air));
        if (Number.isFinite(v)) setFormulaVal(Math.max(0, Math.min(1, v)));
      } catch {}

      const canvas = zgameRef.current;
      if (canvas) {
        const ctx = canvas.getContext('2d');
        if (ctx) {
          const w = canvas.width;
          const h = canvas.height;
          ctx.fillStyle = 'rgba(8, 12, 24, 0.28)';
          ctx.fillRect(0, 0, w, h);

          const cx = w / 2;
          const cy = h / 2;
          const subBoost = 1 + t.bands.sub * 0.85 + t.kickEnv * 0.45;

          if (visMode === 'radial') {
            const bins = t.fft.length;
            const baseR = Math.min(w, h) * 0.22 * subBoost;
            ctx.strokeStyle = '#FFFFFF';
            ctx.lineWidth = 1.6;
            ctx.beginPath();
            for (let i = 0; i <= bins; i++) {
              const ang = (i / bins) * Math.PI * 2 + sec * 0.4;
              const mag = t.fft[i % bins] * 75;
              const r = baseR + mag;
              const x = cx + Math.cos(ang) * r;
              const y = cy + Math.sin(ang) * r;
              if (i === 0) ctx.moveTo(x, y);
              else ctx.lineTo(x, y);
            }
            ctx.closePath();
            ctx.stroke();

            ctx.strokeStyle = '#60A5FA';
            ctx.beginPath();
            ctx.arc(cx, cy, baseR * 0.72, 0, Math.PI * 2);
            ctx.stroke();
          } else if (visMode === 'rings') {
            for (let k = 1; k <= 6; k++) {
              const r = ((k * 26 + t.beatPhase * 40) % 165) * subBoost;
              ctx.strokeStyle = k % 2 === 0 ? '#60A5FA' : '#FFFFFF';
              ctx.lineWidth = 1.4;
              ctx.beginPath();
              ctx.arc(cx, cy, r, 0, Math.PI * 2);
              ctx.stroke();
            }
          } else if (visMode === 'tunnel') {
            ctx.strokeStyle = '#FFFFFF';
            ctx.lineWidth = 1.5;
            ctx.beginPath();
            for (let i = 0; i < t.wave.length; i++) {
              const x = (i / (t.wave.length - 1)) * w;
              const y = cy + t.wave[i] * (h * 0.42) * subBoost;
              if (i === 0) ctx.moveTo(x, y);
              else ctx.lineTo(x, y);
            }
            ctx.stroke();
          } else {
            const cols = 16;
            const cw = w / cols;
            for (let i = 0; i < cols; i++) {
              const v = t.fft[i * 3] || 0;
              const bh = v * h * 0.9;
              ctx.fillStyle = i % 4 === 0 ? '#FFFFFF' : '#60A5FA';
              ctx.fillRect(i * cw + 3, h - bh, cw - 6, bh);
            }
          }
        }
      }

      raf = requestAnimationFrame(draw);
    };
    raf = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(raf);
  }, [visMode, formulaText]);

  const applyDrummerGroove = () => {
    const style = DRUMMER_STYLES.find((d) => d.id === drummerStyle) || DRUMMER_STYLES[0];
    const kickPulses = Math.max(2, Math.min(9, Math.round(3 + complexity * 5)));
    const hatPulses = Math.max(4, Math.min(16, Math.round(6 + complexity * 10)));
    const kickPat = euclid(kickPulses, 16);
    const hatPat = euclid(hatPulses, 16);

    projectStore.update((s) => {
      s.swing = style.swing;
      const pat = s.patterns.find((p) => p.id === s.activePatternId) || s.patterns[0];
      if (!pat) return;
      const len = pat.lengthSteps;

      const kickCh = s.channels.find((c) => c.engine === 'DrumSynth' && c.drumSynth.voice === 'bd');
      const snCh = s.channels.find((c) => c.engine === 'DrumSynth' && (c.drumSynth.voice === 'cp' || c.drumSynth.voice === 'sn'));
      const hhCh = s.channels.find((c) => c.engine === 'DrumSynth' && c.drumSynth.voice === 'hh');

      if (kickCh) {
        kickCh.drumSynth.kitId = style.kitId;
        const arr = createEmptySteps(len);
        for (let i = 0; i < len; i++) {
          arr[i].active = style.id === 'electronic' ? i % 4 === 0 : Boolean(kickPat[i % 16]);
          arr[i].velocity = Math.min(1, 0.55 + loudness * 0.45);
        }
        pat.steps[kickCh.id] = arr;
      }
      if (snCh) {
        snCh.drumSynth.kitId = style.kitId;
        const arr = createEmptySteps(len);
        for (let i = 0; i < len; i++) {
          const isBackbeat = i % 8 === 4;
          const isFill = i >= len - 3 && Math.random() < fillAmount;
          arr[i].active = isBackbeat || isFill;
          arr[i].velocity = isBackbeat ? Math.min(1, 0.6 + loudness * 0.38) : 0.58;
        }
        pat.steps[snCh.id] = arr;
      }
      if (hhCh) {
        hhCh.drumSynth.kitId = style.kitId;
        const arr = createEmptySteps(len);
        for (let i = 0; i < len; i++) {
          arr[i].active = Boolean(hatPat[i % 16]);
          arr[i].velocity = i % 4 === 2 ? Math.min(1, 0.55 + loudness * 0.4) : 0.45 + loudness * 0.25;
          if (complexity > 0.7 && i === len - 1) arr[i].ratchet = 2;
        }
        pat.steps[hhCh.id] = arr;
      }
    });
    void audioEngine.play({ scope: 'pattern-only' });
  };

  const handleXyDrag = (e: React.MouseEvent<HTMLDivElement>) => {
    if (e.buttons !== 1 && e.type === 'mousemove') return;
    const rect = e.currentTarget.getBoundingClientRect();
    const x = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
    const y = 1 - Math.max(0, Math.min(1, (e.clientY - rect.top) / rect.height));
    setXyPad({ x, y });
    // Live modulate active channel cutoff + resonance (and record automation if armed!)
    projectStore.update((s) => {
      const ch = s.channels.find((c) => c.id === s.selectedChannelId);
      if (!ch) return;
      ch.subSynth.cutoff = Math.round(140 + x * 11000);
      ch.subSynth.resonance = Math.round((0.5 + y * 14) * 10) / 10;
      ch.fmSynth.cutoff = Math.round(180 + x * 12000);
      ch.fmSynth.modIndex = Math.round((0.4 + y * 9) * 10) / 10;
      if (s.automationRecording && s.automationLanes[0]) {
        const beat = Math.round(audioEngine.readTelemetry().beatPosition * 4) / 4;
        s.automationLanes[0].points.push({ beat, value: x });
        s.automationLanes[0].points.sort((a, b) => a.beat - b.beat);
      }
    }, false);
  };

  return (
    <div style={{ flex: 1, display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 10, padding: 10, overflow: 'auto', background: '#080C18' }}>
      {/* Column 1: Virtual Drummer Editor */}
      <div className="inst-section" style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        <div className="inst-section-title">Drummer Editor (Session Groove AI)</div>
        <select value={drummerStyle} onChange={(e) => setDrummerStyle(e.target.value)}>
          {DRUMMER_STYLES.map((d) => (
            <option key={d.id} value={d.id}>{d.name}</option>
          ))}
        </select>

        {/* X/Y Complexity vs Loudness Pad */}
        <div
          onMouseDown={(e) => {
            const r = e.currentTarget.getBoundingClientRect();
            setComplexity(Math.max(0, Math.min(1, (e.clientX - r.left) / r.width)));
            setLoudness(1 - Math.max(0, Math.min(1, (e.clientY - r.top) / r.height)));
          }}
          onMouseMove={(e) => {
            if (e.buttons !== 1) return;
            const r = e.currentTarget.getBoundingClientRect();
            setComplexity(Math.max(0, Math.min(1, (e.clientX - r.left) / r.width)));
            setLoudness(1 - Math.max(0, Math.min(1, (e.clientY - r.top) / r.height)));
          }}
          style={{
            height: 170,
            background: '#080C18',
            border: '1px solid #24324D',
            borderRadius: 4,
            position: 'relative',
            cursor: 'crosshair',
          }}
        >
          <span style={{ position: 'absolute', top: 6, left: 8, fontSize: 10, color: '#64748B' }}>LOUD</span>
          <span style={{ position: 'absolute', bottom: 6, left: 8, fontSize: 10, color: '#64748B' }}>SOFT</span>
          <span style={{ position: 'absolute', bottom: 6, right: 8, fontSize: 10, color: '#64748B' }}>COMPLEX</span>
          <div
            style={{
              position: 'absolute',
              left: `${complexity * 100}%`,
              top: `${(1 - loudness) * 100}%`,
              width: 14,
              height: 14,
              borderRadius: '50%',
              background: '#FFFFFF',
              border: '2px solid #60A5FA',
              transform: 'translate(-50%, -50%)',
              pointerEvents: 'none',
            }}
          />
        </div>

        <div className="param-row">
          <label>Fills Density</label>
          <input type="range" min={0} max={1} step={0.05} value={fillAmount} onChange={(e) => setFillAmount(parseFloat(e.target.value))} />
          <span className="val">{Math.round(fillAmount * 100)}%</span>
        </div>

        <button className="primary" onClick={applyDrummerGroove}>
          <Sparkles size={13} /> Generate Drummer Pattern
        </button>
      </div>

      {/* Column 2: Performance Mode Clip Launcher + X-Y / Formula Controller */}
      <div className="inst-section" style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        <div className="inst-section-title">Performance Mode (Live Clip Launcher)</div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6 }}>
          {project.patterns.map((p) => {
            const isAct = p.id === project.activePatternId;
            return (
              <button
                key={p.id}
                className={isAct ? 'active' : ''}
                style={{ height: 46, justifyContent: 'space-between', padding: '0 10px' }}
                onClick={() => {
                  projectStore.update((s) => { s.activePatternId = p.id; }, false);
                  void audioEngine.play({ scope: 'pattern-only' });
                }}
              >
                <span style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>{p.name}</span>
                <Play size={12} />
              </button>
            );
          })}
        </div>

        <div className="inst-section-title" style={{ marginTop: 8, display: 'flex', alignItems: 'center', gap: 6 }}>
          <Sliders size={12} /> X-Y Controller / Control Surface
        </div>
        <div
          onMouseDown={handleXyDrag}
          onMouseMove={handleXyDrag}
          style={{
            height: 130,
            background: '#080C18',
            border: '1px solid #24324D',
            borderRadius: 4,
            position: 'relative',
            cursor: 'crosshair',
          }}
        >
          <span style={{ position: 'absolute', top: 6, left: 8, fontSize: 10, color: '#64748B' }}>Y: Resonance / FM</span>
          <span style={{ position: 'absolute', bottom: 6, right: 8, fontSize: 10, color: '#64748B' }}>X: Filter Cutoff</span>
          <div
            style={{
              position: 'absolute',
              left: `${xyPad.x * 100}%`,
              top: `${(1 - xyPad.y) * 100}%`,
              width: 12,
              height: 12,
              background: '#FFFFFF',
              transform: 'translate(-50%, -50%)',
              pointerEvents: 'none',
            }}
          />
        </div>

        <div style={{ fontSize: 11, color: '#94A3B8' }}>Formula Controller</div>
        <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
          <input
            type="text"
            className="mono"
            style={{ flex: 1 }}
            value={formulaText}
            onChange={(e) => setFormulaText(e.target.value)}
          />
          <span className="mono" style={{ width: 42, textAlign: 'right', color: '#FFFFFF' }}>
            {formulaVal.toFixed(2)}
          </span>
        </div>
      </div>

      {/* Column 3: ZGameEditor Visualizer */}
      <div className="inst-section" style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        <div className="inst-section-title" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <span>ZGameEditor Visualizer</span>
          <select value={visMode} onChange={(e) => setVisMode(e.target.value as typeof visMode)} style={{ padding: '2px 6px' }}>
            <option value="radial">Radial FFT Halo</option>
            <option value="rings">Beat Pulse Rings</option>
            <option value="tunnel">Oscilloscope Wave</option>
            <option value="grid">Spectrum Bars</option>
          </select>
        </div>

        <canvas
          ref={zgameRef}
          width={380}
          height={290}
          style={{
            width: '100%',
            flex: 1,
            minHeight: 240,
            background: '#080C18',
            border: '1px solid #24324D',
            borderRadius: 4,
          }}
        />
      </div>
    </div>
  );
};
