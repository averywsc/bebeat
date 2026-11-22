/**
 * Bebeat Master Clock AudioWorkletProcessor
 * Sample-accurate musical clock locked strictly to AudioContext sample frames.
 * Uses 25ms lookahead scheduling and 5ms tick emission inside process() — never setTimeout/setInterval.
 */

class BebeatClockProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this.playing = false;
    this.bpm = 128;
    this.swing = 0; // 0..0.5
    this.beatsPerBar = 4;
    this.loopEnabled = true;
    this.loopBars = 4;
    this.lookaheadSec = 0.025; // 25ms lookahead
    this.tickIntervalSec = 0.005; // 5ms scheduling interval

    this.beatPosition = 0; // current audible beat position
    this.nextScheduleBeat = 0; // next 16th-note step (0.25 beat) to emit in lookahead
    this.lastEmitFrame = 0;
    this.sabView = null;

    this.port.onmessage = (e) => {
      const msg = e.data;
      if (!msg || typeof msg !== 'object') return;
      switch (msg.type) {
        case 'init-sab':
          if (msg.sab) {
            this.sabView = new Float32Array(msg.sab);
          }
          break;
        case 'start':
          this.playing = true;
          if (typeof msg.beat === 'number') {
            this.beatPosition = msg.beat;
          }
          this.nextScheduleBeat = Math.floor(this.beatPosition * 4) / 4;
          this.lastEmitFrame = 0;
          break;
        case 'stop':
          this.playing = false;
          if (msg.reset) {
            this.beatPosition = 0;
            this.nextScheduleBeat = 0;
          }
          this._writeSab(0, 0, 0);
          break;
        case 'seek':
          this.beatPosition = Math.max(0, Number(msg.beat) || 0);
          this.nextScheduleBeat = Math.floor(this.beatPosition * 4) / 4;
          break;
        case 'params':
          if (typeof msg.bpm === 'number') this.bpm = Math.max(30, Math.min(300, msg.bpm));
          if (typeof msg.swing === 'number') this.swing = Math.max(0, Math.min(0.45, msg.swing));
          if (typeof msg.loopEnabled === 'boolean') this.loopEnabled = msg.loopEnabled;
          if (typeof msg.loopBars === 'number') this.loopBars = Math.max(1, msg.loopBars);
          break;
      }
    };
  }

  _writeSab(beatPos, beatPhase, barPhase) {
    if (!this.sabView) return;
    // Indices 0..3 reserved for clock telemetry in shared buffer
    this.sabView[0] = this.playing ? 1 : 0;
    this.sabView[1] = beatPos;
    this.sabView[2] = beatPhase;
    this.sabView[3] = barPhase;
  }

  process(inputs, outputs) {
    const out = outputs[0];
    const blockFrames = out && out[0] ? out[0].length : 128;
    const sr = sampleRate;
    const blockSec = blockFrames / sr;
    const nowTime = currentFrame / sr;

    if (!this.playing) {
      return true;
    }

    const beatsPerSec = this.bpm / 60;
    const loopBeats = this.loopBars * this.beatsPerBar;

    // Emit lookahead 16th-note step events within [nowTime, nowTime + 25ms]
    const horizonBeats = this.beatPosition + this.lookaheadSec * beatsPerSec;
    const events = [];

    let safety = 0;
    while (this.nextScheduleBeat <= horizonBeats && safety < 16) {
      safety++;
      let stepBeat = this.nextScheduleBeat;
      const stepIndexGlobal = Math.round(stepBeat * 4);
      const isOffSixteenth = stepIndexGlobal % 2 === 1;
      const swingBeats = isOffSixteenth ? this.swing * 0.125 : 0;

      const deltaBeats = stepBeat + swingBeats - this.beatPosition;
      const targetAudioTime = nowTime + Math.max(0, deltaBeats / beatsPerSec);

      const wrappedBeat = this.loopEnabled && loopBeats > 0
        ? ((stepBeat % loopBeats) + loopBeats) % loopBeats
        : stepBeat;

      const bar = Math.floor(wrappedBeat / this.beatsPerBar);
      const beatInBar = Math.floor(wrappedBeat % this.beatsPerBar);
      const stepInBar = Math.floor((wrappedBeat % this.beatsPerBar) * 4);
      const stepInLoop = Math.floor(wrappedBeat * 4);

      events.push({
        audioTime: targetAudioTime,
        beat: wrappedBeat,
        absBeat: stepBeat,
        bar,
        beatInBar,
        stepInBar,
        stepInLoop,
        stepDurationSec: 0.25 / beatsPerSec,
      });

      this.nextScheduleBeat += 0.25;
    }

    // Advance audible playhead
    this.beatPosition += blockSec * beatsPerSec;
    if (this.loopEnabled && loopBeats > 0 && this.beatPosition >= loopBeats) {
      this.beatPosition -= loopBeats;
      this.nextScheduleBeat -= loopBeats;
    }

    const beatPhase = this.beatPosition % 1;
    const barPhase = (this.beatPosition % this.beatsPerBar) / this.beatsPerBar;
    this._writeSab(this.beatPosition, beatPhase, barPhase);

    const tickFrames = Math.max(128, Math.round(this.tickIntervalSec * sr));
    const shouldEmitTick = events.length > 0 || currentFrame - this.lastEmitFrame >= tickFrames;
    if (shouldEmitTick) {
      this.lastEmitFrame = currentFrame;
      this.port.postMessage({
        type: 'clock',
        audioTime: nowTime,
        beatPosition: this.beatPosition,
        beatPhase,
        barPhase,
        bpm: this.bpm,
        events,
      });
    }

    return true;
  }
}

registerProcessor('bebeat-clock-processor', BebeatClockProcessor);
