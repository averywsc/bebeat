import React, { useEffect, useRef, useState } from 'react';
import { audioEngine } from '../audio/engine';

export const TelemetryFooterBar: React.FC = () => {
  const scopeRef = useRef<HTMLCanvasElement | null>(null);
  const specRef = useRef<HTMLCanvasElement | null>(null);
  const bandsRef = useRef<HTMLCanvasElement | null>(null);

  const [metrics, setMetrics] = useState({
    lufsM: -70,
    lufsS: -70,
    tpDb: -72,
    peakL: 0,
    peakR: 0,
    sab: false,
    onset: 0,
    beatPhase: 0,
  });

  useEffect(() => {
    let raf = 0;
    let tick = 0;

    const draw = () => {
      const t = audioEngine.readTelemetry();
      tick++;

      // 1. Oscilloscope
      const sc = scopeRef.current;
      if (sc) {
        const ctx = sc.getContext('2d');
        if (ctx) {
          const w = sc.width;
          const h = sc.height;
          ctx.fillStyle = '#080C18';
          ctx.fillRect(0, 0, w, h);
          ctx.strokeStyle = '#1E2A45';
          ctx.lineWidth = 1;
          ctx.beginPath();
          ctx.moveTo(0, h / 2);
          ctx.lineTo(w, h / 2);
          ctx.stroke();

          ctx.strokeStyle = '#FFFFFF';
          ctx.lineWidth = 1.4;
          ctx.beginPath();
          const n = t.wave.length;
          for (let i = 0; i < n; i++) {
            const x = (i / (n - 1)) * w;
            const y = h * 0.5 - t.wave[i] * (h * 0.44);
            if (i === 0) ctx.moveTo(x, y);
            else ctx.lineTo(x, y);
          }
          ctx.stroke();
        }
      }

      // 2. Compact 64-bin FFT Spectrum
      const sp = specRef.current;
      if (sp) {
        const ctx = sp.getContext('2d');
        if (ctx) {
          const w = sp.width;
          const h = sp.height;
          ctx.fillStyle = '#080C18';
          ctx.fillRect(0, 0, w, h);
          const bins = t.fft.length;
          const bw = w / bins;
          for (let i = 0; i < bins; i++) {
            const v = t.fft[i];
            const bh = v * (h - 2);
            ctx.fillStyle = v > 0.85 ? '#FFFFFF' : '#60A5FA';
            ctx.fillRect(i * bw, h - bh, Math.max(1, bw - 1), bh);
          }
        }
      }

      // 3. 4-Band Energy + Beat Phase + Kick Env + Onset
      const bc = bandsRef.current;
      if (bc) {
        const ctx = bc.getContext('2d');
        if (ctx) {
          const w = bc.width;
          const h = bc.height;
          ctx.fillStyle = '#080C18';
          ctx.fillRect(0, 0, w, h);

          const bars = [
            { label: 'SUB', val: t.bands.sub, col: '#FFFFFF' },
            { label: 'LOW', val: t.bands.lowMid, col: '#93C5FD' },
            { label: 'MID', val: t.bands.highMid, col: '#60A5FA' },
            { label: 'AIR', val: t.bands.air, col: '#38BDF8' },
            { label: 'KCK', val: t.kickEnv, col: '#E2E8F0' },
            { label: 'ONS', val: t.onset, col: '#FBBF24' },
            { label: 'PHS', val: t.beatPhase, col: '#CBD5E1' },
          ];
          const colW = w / bars.length;
          bars.forEach((b, idx) => {
            const x = idx * colW + 3;
            const bw = colW - 6;
            const barMaxH = h - 12;
            const bh = Math.min(1, Math.max(0, b.val)) * barMaxH;
            ctx.fillStyle = '#141F38';
            ctx.fillRect(x, 2, bw, barMaxH);
            ctx.fillStyle = b.col;
            ctx.fillRect(x, 2 + (barMaxH - bh), bw, bh);
            ctx.fillStyle = '#94A3B8';
            ctx.font = '8px JetBrains Mono, monospace';
            ctx.textAlign = 'center';
            ctx.fillText(b.label, x + bw / 2, h - 1);
          });
        }
      }

      if (tick % 3 === 0) {
        setMetrics({
          lufsM: t.lufsMomentary,
          lufsS: t.lufsShortTerm,
          tpDb: t.truePeakDb,
          peakL: t.peakL,
          peakR: t.peakR,
          sab: t.sabActive,
          onset: t.onset,
          beatPhase: t.beatPhase,
        });
      }

      raf = requestAnimationFrame(draw);
    };

    raf = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(raf);
  }, []);

  const peakDb = (lin: number) => (lin <= 0.0001 ? -72 : Math.max(-72, 20 * Math.log10(lin)));
  const meterPct = (lin: number) => Math.max(0, Math.min(100, ((peakDb(lin) + 60) / 60) * 100));

  return (
    <footer className="telemetry-bar">
      <div className="tele-cell">
        <div className="tele-label">
          <span>Oscilloscope</span>
          <span className="mono">{metrics.sab ? 'SAB LOCK-FREE' : 'WORKLET PORT'}</span>
        </div>
        <canvas ref={scopeRef} width={200} height={36} className="tele-canvas" />
      </div>

      <div className="tele-cell">
        <div className="tele-label">
          <span>Spectrum FFT</span>
          <span className="mono">64 BINS</span>
        </div>
        <canvas ref={specRef} width={200} height={36} className="tele-canvas" />
      </div>

      <div className="tele-cell">
        <div className="tele-label">
          <span>Beat &amp; 4-Band Mod</span>
          <span className="mono">PHASE {metrics.beatPhase.toFixed(2)}</span>
        </div>
        <canvas ref={bandsRef} width={220} height={36} className="tele-canvas" />
      </div>

      <div className="tele-cell">
        <div className="tele-label">
          <span>Master Loudness &amp; True Peak</span>
          <button
            className="sm"
            style={{ padding: '0 5px', fontSize: 9.5, height: 15 }}
            onClick={() => audioEngine.resetTruePeak()}
            title="Reset True Peak Hold"
          >
            RST TP
          </button>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
          <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 4 }}>
            {(['L', 'R'] as const).map((chLabel, idx) => {
              const val = idx === 0 ? metrics.peakL : metrics.peakR;
              const pct = meterPct(val);
              const col = pct > 96 ? '#F87171' : pct > 84 ? '#FBBF24' : '#FFFFFF';
              return (
                <div key={chLabel} style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                  <span className="mono" style={{ fontSize: 10, color: '#94A3B8', width: 10 }}>
                    {chLabel}
                  </span>
                  <div
                    style={{
                      flex: 1,
                      height: 8,
                      background: '#080C18',
                      border: '1px solid #24324D',
                      borderRadius: 2,
                      overflow: 'hidden',
                    }}
                  >
                    <div style={{ width: `${pct}%`, height: '100%', background: col }} />
                  </div>
                </div>
              );
            })}
          </div>
          <div className="mono" style={{ display: 'flex', gap: 12, fontSize: 11 }}>
            <div>
              <div style={{ fontSize: 9, color: '#64748B' }}>M-LUFS</div>
              <div style={{ color: '#FFFFFF', fontWeight: 600 }}>
                {metrics.lufsM <= -69 ? '-inf' : metrics.lufsM.toFixed(1)}
              </div>
            </div>
            <div>
              <div style={{ fontSize: 9, color: '#64748B' }}>S-LUFS</div>
              <div style={{ color: '#CBD5E1' }}>
                {metrics.lufsS <= -69 ? '-inf' : metrics.lufsS.toFixed(1)}
              </div>
            </div>
            <div>
              <div style={{ fontSize: 9, color: '#64748B' }}>TRUE PEAK</div>
              <div
                style={{
                  color: metrics.tpDb > -0.3 ? '#F87171' : '#FFFFFF',
                  fontWeight: 600,
                }}
              >
                {metrics.tpDb <= -71 ? '-inf' : `${metrics.tpDb.toFixed(1)} dBTP`}
              </div>
            </div>
          </div>
        </div>
      </div>
    </footer>
  );
};
