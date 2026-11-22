import type { ModRoute, ModSourceId, ModTargetParam, TelemetryFrame } from '../../types/daw';

export function sampleModSource(source: ModSourceId, telemetry: TelemetryFrame, timeSec: number): number {
  switch (source) {
    case 'beat.phase':
      return telemetry.beatPhase;
    case 'bar.phase':
      return telemetry.barPhase;
    case 'beat.onBeat1': {
      // Sharp transient decay on beat 1 of each bar
      const d = telemetry.barPhase * 4;
      return d < 1 ? Math.max(0, 1 - d * 1.4) : 0;
    }
    case 'onset':
      return telemetry.onset;
    case 'env.master':
      return telemetry.env;
    case 'env.kick':
      return telemetry.kickEnv;
    case 'bands.sub':
      return telemetry.bands.sub;
    case 'bands.lowMid':
      return telemetry.bands.lowMid;
    case 'bands.highMid':
      return telemetry.bands.highMid;
    case 'bands.air':
      return telemetry.bands.air;
    case 'lfo.1':
      return 0.5 + 0.5 * Math.sin(2 * Math.PI * 0.5 * timeSec);
    default:
      return 0;
  }
}

export function evaluateModulatedParam(
  routes: ModRoute[],
  targetType: 'channel' | 'mixer',
  targetId: string,
  param: ModTargetParam,
  baseValue: number,
  telemetry: TelemetryFrame,
  timeSec: number
): number {
  let result = baseValue;
  for (const r of routes) {
    if (!r.enabled) continue;
    if (r.targetType !== targetType || r.targetId !== targetId || r.param !== param) continue;
    const raw = sampleModSource(r.source, telemetry, timeSec);
    const mapped = r.min + raw * (r.max - r.min);
    // Blend by depth (0..1 or negative inversion)
    const d = Math.max(-1, Math.min(1, r.depth));
    if (d >= 0) {
      result = result * (1 - d) + mapped * d;
    } else {
      const invMapped = r.max - raw * (r.max - r.min);
      result = result * (1 + d) + invMapped * -d;
    }
  }
  return result;
}

export const MOD_SOURCE_LABELS: Record<ModSourceId, string> = {
  'beat.phase': 'Beat Phase (0-1)',
  'bar.phase': 'Bar Phase (0-1)',
  'beat.onBeat1': 'Downbeat Pulse (Beat 1)',
  onset: 'Transient / Onset Trigger',
  'env.master': 'Master Envelope Follower',
  'env.kick': 'Kick Envelope Follower',
  'bands.sub': 'Band: Sub (20-90Hz)',
  'bands.lowMid': 'Band: Low-Mid (90-350Hz)',
  'bands.highMid': 'Band: High-Mid (350-4kHz)',
  'bands.air': 'Band: Air (4k-20kHz)',
  'lfo.1': 'Global LFO 1',
};

export const MOD_PARAM_RANGES: Record<ModTargetParam, { label: string; min: number; max: number }> = {
  cutoff: { label: 'Filter Cutoff (Hz)', min: 120, max: 12000 },
  resonance: { label: 'Filter Resonance', min: 0.5, max: 16 },
  fmIndex: { label: 'FM Index', min: 0.2, max: 12 },
  pitch: { label: 'Pitch Offset (semi)', min: -12, max: 12 },
  detune: { label: 'Detune (cents)', min: -50, max: 50 },
  pan: { label: 'Stereo Pan', min: -1, max: 1 },
  gain: { label: 'Level / Gain', min: 0.1, max: 1.2 },
  reverbMix: { label: 'Reverb Mix', min: 0, max: 1 },
  delayFeedback: { label: 'Delay Feedback', min: 0, max: 0.85 },
  saturationDrive: { label: 'Saturation Drive', min: 0, max: 1 },
};
