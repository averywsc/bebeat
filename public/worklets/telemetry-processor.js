/**
 * Bebeat Lock-Free Telemetry & Beat-Reactive Analyzer AudioWorkletProcessor
 * Computes real-time:
 *  - Stereo Peak & RMS
 *  - 4x Oversampled True Peak (dBTP)
 *  - K-weighted Momentary & Short-Term LUFS (BS.1770)
 *  - 4-Band Energy (Sub 20-90Hz, LowMid 90-350Hz, HighMid 350-4kHz, Air 4k-20kHz)
 *  - Configurable Attack/Release Envelope Follower
 *  - Transient / Onset Detector
 *  - 128-point Radix-2 FFT (64 spectrum bins) + 256-sample Oscilloscope frame
 * Writes lock-free to SharedArrayBuffer when available, with automatic MessagePort fallback.
 */

const FFT_SIZE = 128;
const WAVE_SIZE = 256;
// SAB Layout (Float32Array of length 512):
// [0..3]: clock (reserved)
// [4]: peakL, [5]: peakR, [6]: rmsL, [7]: rmsR
// [8]: truePeakDb, [9]: lufsMomentary, [10]: lufsShortTerm
// [11]: bandSub, [12]: bandLowMid, [13]: bandHighMid, [14]: bandAir
// [15]: envFollower, [16]: onsetTrigger, [17]: frameCounter
// [32..95]: 64 FFT magnitude bins (0..1)
// [128..383]: 256 waveform samples (-1..1)

class Biquad {
  constructor() {
    this.b0 = 1; this.b1 = 0; this.b2 = 0;
    this.a1 = 0; this.a2 = 0;
    this.z1 = 0; this.z2 = 0;
  }
  setLP(fc, q, sr) {
    const w0 = (2 * Math.PI * Math.min(fc, sr * 0.45)) / sr;
    const c = Math.cos(w0);
    const alpha = Math.sin(w0) / (2 * q);
    const a0 = 1 + alpha;
    this.b0 = ((1 - c) / 2) / a0;
    this.b1 = (1 - c) / a0;
    this.b2 = ((1 - c) / 2) / a0;
    this.a1 = (-2 * c) / a0;
    this.a2 = (1 - alpha) / a0;
  }
  setHP(fc, q, sr) {
    const w0 = (2 * Math.PI * Math.min(fc, sr * 0.45)) / sr;
    const c = Math.cos(w0);
    const alpha = Math.sin(w0) / (2 * q);
    const a0 = 1 + alpha;
    this.b0 = ((1 + c) / 2) / a0;
    this.b1 = -(1 + c) / a0;
    this.b2 = ((1 + c) / 2) / a0;
    this.a1 = (-2 * c) / a0;
    this.a2 = (1 - alpha) / a0;
  }
  setHighShelf(fc, gainDb, sr) {
    const A = Math.pow(10, gainDb / 40);
    const w0 = (2 * Math.PI * Math.min(fc, sr * 0.45)) / sr;
    const c = Math.cos(w0);
    const s = Math.sin(w0);
    const alpha = (s / 2) * Math.sqrt((A + 1 / A) * (1 / 0.707 - 1) + 2);
    const twoSqrtA = 2 * Math.sqrt(A) * alpha;
    const a0 = (A + 1) - (A - 1) * c + twoSqrtA;
    this.b0 = (A * ((A + 1) + (A - 1) * c + twoSqrtA)) / a0;
    this.b1 = (-2 * A * ((A - 1) + (A + 1) * c)) / a0;
    this.b2 = (A * ((A + 1) + (A - 1) * c - twoSqrtA)) / a0;
    this.a1 = (2 * ((A - 1) - (A + 1) * c)) / a0;
    this.a2 = ((A + 1) - (A - 1) * c - twoSqrtA) / a0;
  }
  process(x) {
    const y = this.b0 * x + this.z1;
    this.z1 = this.b1 * x - this.a1 * y + this.z2;
    this.z2 = this.b2 * x - this.a2 * y;
    return y;
  }
}

class BebeatTelemetryProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this.sabView = null;
    this.frameCount = 0;
    this.emitStride = Math.max(1, Math.round((sampleRate / 128) / 60)); // ~60fps

    // 4-band crossover filters (90Hz, 350Hz, 4000Hz)
    this.lp90 = new Biquad(); this.lp90.setLP(90, 0.707, sampleRate);
    this.hp90 = new Biquad(); this.hp90.setHP(90, 0.707, sampleRate);
    this.lp350 = new Biquad(); this.lp350.setLP(350, 0.707, sampleRate);
    this.hp350 = new Biquad(); this.hp350.setHP(350, 0.707, sampleRate);
    this.lp4k = new Biquad(); this.lp4k.setLP(4000, 0.707, sampleRate);
    this.hp4k = new Biquad(); this.hp4k.setHP(4000, 0.707, sampleRate);

    // K-weighting filters for BS.1770 LUFS (pre-filter high shelf +4dB @ 1681Hz, HP @ 38Hz)
    this.kwShelfL = new Biquad(); this.kwShelfL.setHighShelf(1681, 4.0, sampleRate);
    this.kwHpL = new Biquad(); this.kwHpL.setHP(38, 0.5, sampleRate);
    this.kwShelfR = new Biquad(); this.kwShelfR.setHighShelf(1681, 4.0, sampleRate);
    this.kwHpR = new Biquad(); this.kwHpR.setHP(38, 0.5, sampleRate);

    this.lufsMomMean = 1e-10;
    this.lufsShortMean = 1e-10;

    // Envelope follower & onset detector
    this.envAttack = 0.006; // sec
    this.envRelease = 0.14; // sec
    this.envValue = 0;
    this.onsetFast = 0;
    this.onsetSlow = 0.001;
    this.onsetPulse = 0;

    // True peak 4-point history per channel
    this.hL = [0, 0, 0, 0];
    this.hR = [0, 0, 0, 0];
    this.peakL = 0;
    this.peakR = 0;
    this.truePeakHold = 1e-6;

    // Smoothed band energies
    this.bandSub = 0;
    this.bandLowMid = 0;
    this.bandHighMid = 0;
    this.bandAir = 0;

    // Waveform & FFT ring buffers
    this.waveRing = new Float32Array(WAVE_SIZE);
    this.waveIdx = 0;
    this.fftRe = new Float32Array(FFT_SIZE);
    this.fftIm = new Float32Array(FFT_SIZE);
    this.fftBins = new Float32Array(FFT_SIZE / 2);
    this.hann = new Float32Array(FFT_SIZE);
    for (let i = 0; i < FFT_SIZE; i++) {
      this.hann[i] = 0.5 * (1 - Math.cos((2 * Math.PI * i) / (FFT_SIZE - 1)));
    }

    this.port.onmessage = (e) => {
      const msg = e.data;
      if (!msg) return;
      if (msg.type === 'init-sab' && msg.sab) {
        this.sabView = new Float32Array(msg.sab);
      } else if (msg.type === 'env-config') {
        if (typeof msg.attack === 'number') this.envAttack = Math.max(0.001, Math.min(0.5, msg.attack));
        if (typeof msg.release === 'number') this.envRelease = Math.max(0.01, Math.min(2.0, msg.release));
      } else if (msg.type === 'reset-peaks') {
        this.truePeakHold = 1e-6;
      }
    };
  }

  _cubicTruePeak(h) {
    // Evaluate 4x oversampled cubic Catmull-Rom between h[1] and h[2]
    let m = Math.max(Math.abs(h[1]), Math.abs(h[2]));
    const y0 = h[0], y1 = h[1], y2 = h[2], y3 = h[3];
    const a0 = -0.5 * y0 + 1.5 * y1 - 1.5 * y2 + 0.5 * y3;
    const a1 = y0 - 2.5 * y1 + 2.0 * y2 - 0.5 * y3;
    const a2 = -0.5 * y0 + 0.5 * y2;
    const a3 = y1;
    for (let k = 1; k <= 3; k++) {
      const t = k * 0.25;
      const v = Math.abs(((a0 * t + a1) * t + a2) * t + a3);
      if (v > m) m = v;
    }
    return m;
  }

  _computeFft() {
    // Copy most recent FFT_SIZE samples from waveRing with Hann window
    for (let i = 0; i < FFT_SIZE; i++) {
      const idx = (this.waveIdx - FFT_SIZE + i + WAVE_SIZE) & (WAVE_SIZE - 1);
      this.fftRe[i] = this.waveRing[idx] * this.hann[i];
      this.fftIm[i] = 0;
    }
    // Bit-reversal permutation
    let j = 0;
    for (let i = 1; i < FFT_SIZE; i++) {
      let bit = FFT_SIZE >> 1;
      while (j & bit) {
        j ^= bit;
        bit >>= 1;
      }
      j ^= bit;
      if (i < j) {
        const tr = this.fftRe[i]; this.fftRe[i] = this.fftRe[j]; this.fftRe[j] = tr;
      }
    }
    // Cooley-Tukey radix-2 FFT
    for (let len = 2; len <= FFT_SIZE; len <<= 1) {
      const ang = (-2 * Math.PI) / len;
      const wLenRe = Math.cos(ang);
      const wLenIm = Math.sin(ang);
      for (let i = 0; i < FFT_SIZE; i += len) {
        let wRe = 1, wIm = 0;
        const half = len >> 1;
        for (let k = 0; k < half; k++) {
          const uRe = this.fftRe[i + k];
          const uIm = this.fftIm[i + k];
          const vRe = this.fftRe[i + k + half] * wRe - this.fftIm[i + k + half] * wIm;
          const vIm = this.fftRe[i + k + half] * wIm + this.fftIm[i + k + half] * wRe;
          this.fftRe[i + k] = uRe + vRe;
          this.fftIm[i + k] = uIm + vIm;
          this.fftRe[i + k + half] = uRe - vRe;
          this.fftIm[i + k + half] = uIm - vIm;
          const nwRe = wRe * wLenRe - wIm * wLenIm;
          wIm = wRe * wLenIm + wIm * wLenRe;
          wRe = nwRe;
        }
      }
    }
    const halfN = FFT_SIZE >> 1;
    for (let i = 0; i < halfN; i++) {
      const mag = Math.sqrt(this.fftRe[i] * this.fftRe[i] + this.fftIm[i] * this.fftIm[i]) / halfN;
      const db = 20 * Math.log10(mag + 1e-6);
      const norm = Math.max(0, Math.min(1, (db + 72) / 72));
      this.fftBins[i] = this.fftBins[i] * 0.55 + norm * 0.45;
    }
  }

  process(inputs, outputs) {
    const input = inputs[0];
    const output = outputs[0];
    if (!input || input.length === 0) return true;

    const inL = input[0];
    const inR = input[1] || inL;
    const outL = output && output[0];
    const outR = output && output[1];
    const n = inL.length;

    let sumSqL = 0, sumSqR = 0;
    let blkPeakL = 0, blkPeakR = 0;
    let blkTruePeak = 0;
    let kSum = 0;
    let subSq = 0, lowMidSq = 0, highMidSq = 0, airSq = 0;

    const atkCoeff = Math.exp(-1 / (this.envAttack * sampleRate));
    const relCoeff = Math.exp(-1 / (this.envRelease * sampleRate));

    for (let i = 0; i < n; i++) {
      const l = inL[i];
      const r = inR[i];
      if (outL) outL[i] = l;
      if (outR) outR[i] = r;

      const al = Math.abs(l);
      const ar = Math.abs(r);
      if (al > blkPeakL) blkPeakL = al;
      if (ar > blkPeakR) blkPeakR = ar;
      sumSqL += l * l;
      sumSqR += r * r;

      // 4x True Peak
      this.hL[0] = this.hL[1]; this.hL[1] = this.hL[2]; this.hL[2] = this.hL[3]; this.hL[3] = l;
      this.hR[0] = this.hR[1]; this.hR[1] = this.hR[2]; this.hR[2] = this.hR[3]; this.hR[3] = r;
      const tp = Math.max(this._cubicTruePeak(this.hL), this._cubicTruePeak(this.hR));
      if (tp > blkTruePeak) blkTruePeak = tp;

      // K-weighting for LUFS
      const kl = this.kwHpL.process(this.kwShelfL.process(l));
      const kr = this.kwHpR.process(this.kwShelfR.process(r));
      kSum += kl * kl + kr * kr;

      const mono = 0.5 * (l + r);
      this.waveRing[this.waveIdx] = mono;
      this.waveIdx = (this.waveIdx + 1) & (WAVE_SIZE - 1);

      // Envelope follower
      const absM = Math.abs(mono);
      if (absM > this.envValue) {
        this.envValue = atkCoeff * this.envValue + (1 - atkCoeff) * absM;
      } else {
        this.envValue = relCoeff * this.envValue + (1 - relCoeff) * absM;
      }

      // 4-band split
      const sub = this.lp90.process(mono);
      const above90 = this.hp90.process(mono);
      const lowMid = this.lp350.process(above90);
      const above350 = this.hp350.process(above90);
      const highMid = this.lp4k.process(above350);
      const air = this.hp4k.process(above350);

      subSq += sub * sub;
      lowMidSq += lowMid * lowMid;
      highMidSq += highMid * highMid;
      airSq += air * air;
    }

    const rmsL = Math.sqrt(sumSqL / n);
    const rmsR = Math.sqrt(sumSqR / n);
    this.peakL = Math.max(blkPeakL, this.peakL * 0.92);
    this.peakR = Math.max(blkPeakR, this.peakR * 0.92);
    this.truePeakHold = Math.max(blkTruePeak, this.truePeakHold * 0.996);

    // LUFS exponential integration (400ms momentary, 3000ms short-term)
    const blockPower = kSum / n;
    const dt = n / sampleRate;
    const alphaMom = 1 - Math.exp(-dt / 0.4);
    const alphaShort = 1 - Math.exp(-dt / 3.0);
    this.lufsMomMean = this.lufsMomMean * (1 - alphaMom) + blockPower * alphaMom;
    this.lufsShortMean = this.lufsShortMean * (1 - alphaShort) + blockPower * alphaShort;

    const lufsMomentary = Math.max(-70, -0.691 + 10 * Math.log10(Math.max(1e-10, this.lufsMomMean)));
    const lufsShortTerm = Math.max(-70, -0.691 + 10 * Math.log10(Math.max(1e-10, this.lufsShortMean)));
    const truePeakDb = Math.max(-72, 20 * Math.log10(Math.max(1e-6, this.truePeakHold)));

    // 4-band normalized energy (0..1)
    const sSub = Math.min(1, Math.sqrt(subSq / n) * 2.6);
    const sLow = Math.min(1, Math.sqrt(lowMidSq / n) * 3.0);
    const sMid = Math.min(1, Math.sqrt(highMidSq / n) * 3.4);
    const sAir = Math.min(1, Math.sqrt(airSq / n) * 4.5);
    this.bandSub = this.bandSub * 0.65 + sSub * 0.35;
    this.bandLowMid = this.bandLowMid * 0.65 + sLow * 0.35;
    this.bandHighMid = this.bandHighMid * 0.65 + sMid * 0.35;
    this.bandAir = this.bandAir * 0.65 + sAir * 0.35;

    // Onset / transient detection
    const energy = Math.sqrt((sumSqL + sumSqR) / (2 * n));
    this.onsetFast = this.onsetFast * 0.4 + energy * 0.6;
    this.onsetSlow = this.onsetSlow * 0.95 + energy * 0.05;
    if (this.onsetFast > this.onsetSlow * 1.65 && this.onsetFast > 0.06) {
      this.onsetPulse = 1.0;
    } else {
      this.onsetPulse *= 0.84;
    }

    this.frameCount++;
    if (this.frameCount % this.emitStride === 0) {
      this._computeFft();

      if (this.sabView) {
        this.sabView[4] = this.peakL;
        this.sabView[5] = this.peakR;
        this.sabView[6] = rmsL;
        this.sabView[7] = rmsR;
        this.sabView[8] = truePeakDb;
        this.sabView[9] = lufsMomentary;
        this.sabView[10] = lufsShortTerm;
        this.sabView[11] = this.bandSub;
        this.sabView[12] = this.bandLowMid;
        this.sabView[13] = this.bandHighMid;
        this.sabView[14] = this.bandAir;
        this.sabView[15] = Math.min(1, this.envValue * 2.2);
        this.sabView[16] = this.onsetPulse;
        this.sabView[17] = this.frameCount;
        for (let i = 0; i < 64; i++) {
          this.sabView[32 + i] = this.fftBins[i];
        }
        for (let i = 0; i < WAVE_SIZE; i++) {
          this.sabView[128 + i] = this.waveRing[(this.waveIdx + i) & (WAVE_SIZE - 1)];
        }
      } else {
        const waveOut = new Float32Array(WAVE_SIZE);
        for (let i = 0; i < WAVE_SIZE; i++) {
          waveOut[i] = this.waveRing[(this.waveIdx + i) & (WAVE_SIZE - 1)];
        }
        this.port.postMessage({
          type: 'telemetry',
          peakL: this.peakL,
          peakR: this.peakR,
          rmsL,
          rmsR,
          truePeakDb,
          lufsMomentary,
          lufsShortTerm,
          bands: {
            sub: this.bandSub,
            lowMid: this.bandLowMid,
            highMid: this.bandHighMid,
            air: this.bandAir,
          },
          env: Math.min(1, this.envValue * 2.2),
          onset: this.onsetPulse,
          fft: Array.from(this.fftBins),
          wave: Array.from(waveOut),
        });
      }
    }

    return true;
  }
}

registerProcessor('bebeat-telemetry-processor', BebeatTelemetryProcessor);
