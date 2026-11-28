import type {
  Channel,
  DrumVoiceName,
  ExportConfig,
  LiveCodeCompiledProgram,
  ModRoute,
  Pattern,
  ProjectState,
  TelemetryFrame,
} from '../types/daw';
import { projectStore, uid } from '../state/projectStore';
import { FM_SYNTH_PRESETS, SUB_SYNTH_PRESETS } from '../state/presets';
import { loadAssetBinary, loadAssetJson } from '../services/bridge';
import { MixerTrackNode } from './dsp/mixerTrack';
import { triggerSubSynthNote } from './dsp/subSynth';
import { triggerFmSynthNote } from './dsp/fmSynth';
import { triggerSampleBuffer, triggerSynthesizedDrum } from './dsp/drumSynth';
import { SoundFontPlayer } from './dsp/sf2Player';
import { evaluateModulatedParam } from './dsp/modulation';
import { WebMidiManager, type MidiDeviceSummary } from './midiCodec';
import { renderProjectOffline, type OfflineRenderStats } from './offlineRenderer';
import type { InlinePatternPreview } from '../livecode/astPreview';

interface ClockTickEvent {
  audioTime: number;
  beat: number;
  absBeat: number;
  bar: number;
  beatInBar: number;
  stepInBar: number;
  stepInLoop: number;
  stepDurationSec: number;
}

interface KitManifest {
  kits: Record<string, { label: string; files: Record<string, string> }>;
  wavetables: Record<string, { file: string; frames: number; frameLength: number }>;
  soundfonts: Array<{ id: string; label: string; file: string }>;
}

export class BebeatAudioEngine {
  private ctx: AudioContext | null = null;
  private clockNode: AudioWorkletNode | null = null;
  private telemetryNode: AudioWorkletNode | null = null;
  private masterLimiter: DynamicsCompressorNode | null = null;
  private previewBus: GainNode | null = null;

  private sab: SharedArrayBuffer | null = null;
  private sabView: Float32Array | null = null;

  private trackNodes = new Map<string, MixerTrackNode>();
  private kitBuffers = new Map<string, AudioBuffer>();
  private customAudioClips = new Map<string, AudioBuffer>();
  readonly sf2Player = new SoundFontPlayer();
  readonly midiManager = new WebMidiManager();

  private initialized = false;
  private initPromise: Promise<void> | null = null;
  private assetsLoaded = false;

  // Live coding runtime state
  private activeLiveProgram: LiveCodeCompiledProgram | null = null;
  private pendingLiveProgram: { program: LiveCodeCompiledProgram; quantize: 'beat' | 'bar' | 'immediate' } | null = null;
  private liveCodeActive = false;

  // Context-aware playback scope ('all' plays everything; 'solo-channel' plays only selected piano/instrument part; 'live-code-only' plays only live code)
  private playbackScope: 'all' | 'solo-channel' | 'pattern-only' | 'song-only' | 'live-code-only' = 'all';
  private activeSoloChannelId: string | null = null;

  // Live recording state (tracks held keys -> writes duration on keyup)
  private heldRecNotes = new Map<string, { channelId: string; midi: number; startBeat: number; velocity: number }>();
  private stepEntryBeatCursor = 0;
  private activePressedMidi = new Set<number>();
  private pressedListeners = new Set<(notes: Set<number>) => void>();

  // Kick envelope follower state
  private kickEnv = 0;
  private lastKickTriggerMs = 0;

  // MIDI Learn state
  private midiLearnTarget: { targetType: 'channel' | 'mixer' | 'transport'; targetId: string; param: string; min: number; max: number } | null = null;
  private midiDevices: MidiDeviceSummary[] = [];
  private midiListeners = new Set<(devices: MidiDeviceSummary[]) => void>();

  // Output device / WASAPI preferences
  private outputDeviceId = 'default';
  private wasapiMode: 'shared' | 'exclusive' = 'shared';

  // Telemetry state snapshot
  private telemetry: TelemetryFrame = {
    playing: false,
    beatPosition: 0,
    beatPhase: 0,
    barPhase: 0,
    peakL: 0,
    peakR: 0,
    rmsL: 0,
    rmsR: 0,
    truePeakDb: -72,
    lufsMomentary: -70,
    lufsShortTerm: -70,
    bands: { sub: 0, lowMid: 0, highMid: 0, air: 0 },
    env: 0,
    kickEnv: 0,
    onset: 0,
    fft: new Float32Array(64),
    wave: new Float32Array(256),
    sabActive: false,
  };

  constructor() {
    projectStore.subscribe(() => {
      this.syncFromStore();
    });
  }

  async ensureInitialized(): Promise<void> {
    if (this.initialized) {
      if (this.ctx && this.ctx.state === 'suspended') {
        await this.ctx.resume();
      }
      return;
    }
    if (this.initPromise) return this.initPromise;

    this.initPromise = this._initInternal();
    return this.initPromise;
  }

  private async _initInternal(): Promise<void> {
    const AudioCtx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    this.ctx = new AudioCtx({ latencyHint: 'interactive', sampleRate: 48000 });

    // Load AudioWorklet modules using relative URL safe for Vite dev and Electron file://
    const baseUrl = new URL('./', window.location.href);
    const clockUrl = new URL('worklets/clock-processor.js', baseUrl).href;
    const teleUrl = new URL('worklets/telemetry-processor.js', baseUrl).href;

    await this.ctx.audioWorklet.addModule(clockUrl);
    await this.ctx.audioWorklet.addModule(teleUrl);

    // Setup lock-free SharedArrayBuffer when cross-origin isolated
    if (typeof SharedArrayBuffer !== 'undefined' && window.crossOriginIsolated) {
      this.sab = new SharedArrayBuffer(512 * 4);
      this.sabView = new Float32Array(this.sab);
      this.telemetry.sabActive = true;
    }

    this.clockNode = new AudioWorkletNode(this.ctx, 'bebeat-clock-processor', {
      numberOfInputs: 0,
      numberOfOutputs: 1,
      outputChannelCount: [1],
    });
    // Keep clock processor alive silently
    const silentGain = this.ctx.createGain();
    silentGain.gain.value = 0;
    this.clockNode.connect(silentGain).connect(this.ctx.destination);

    this.telemetryNode = new AudioWorkletNode(this.ctx, 'bebeat-telemetry-processor', {
      numberOfInputs: 1,
      numberOfOutputs: 1,
      outputChannelCount: [2],
    });

    if (this.sab) {
      this.clockNode.port.postMessage({ type: 'init-sab', sab: this.sab });
      this.telemetryNode.port.postMessage({ type: 'init-sab', sab: this.sab });
    }

    this.clockNode.port.onmessage = (e) => {
      if (e.data?.type === 'clock') {
        this.handleClockMessage(e.data);
      }
    };

    this.telemetryNode.port.onmessage = (e) => {
      const d = e.data;
      if (d?.type === 'telemetry' && !this.sabView) {
        this.telemetry.peakL = d.peakL;
        this.telemetry.peakR = d.peakR;
        this.telemetry.rmsL = d.rmsL;
        this.telemetry.rmsR = d.rmsR;
        this.telemetry.truePeakDb = d.truePeakDb;
        this.telemetry.lufsMomentary = d.lufsMomentary;
        this.telemetry.lufsShortTerm = d.lufsShortTerm;
        this.telemetry.bands = d.bands;
        this.telemetry.env = d.env;
        this.telemetry.onset = d.onset;
        if (d.fft) this.telemetry.fft.set(d.fft);
        if (d.wave) this.telemetry.wave.set(d.wave);
      }
    };

    // Safety brickwall limiter on final output
    this.masterLimiter = this.ctx.createDynamicsCompressor();
    this.masterLimiter.threshold.value = -1.2;
    this.masterLimiter.knee.value = 1.5;
    this.masterLimiter.ratio.value = 20;
    this.masterLimiter.attack.value = 0.0015;
    this.masterLimiter.release.value = 0.06;

    this.previewBus = this.ctx.createGain();
    this.previewBus.gain.value = 0.78;
    this.previewBus.connect(this.masterLimiter);

    this.telemetryNode.connect(this.masterLimiter);
    this.masterLimiter.connect(this.ctx.destination);

    this.rebuildMixerGraph(projectStore.getState());
    this.syncClockParams(projectStore.getState());

    // Initialize Web MIDI hardware support
    this.midiDevices = await this.midiManager.init({
      onNoteOn: (midi, vel) => this.handleMidiNoteOn(midi, vel),
      onNoteOff: (midi) => this.handleMidiNoteOff(midi),
      onControlChange: (cc, norm, ch) => this.handleMidiCc(cc, norm, ch),
      onDevicesChanged: (devs) => {
        this.midiDevices = devs;
        this.midiListeners.forEach((fn) => fn(devs));
      },
    });

    this.initialized = true;
    void this.loadBundledAssets();
  }

  async loadBundledAssets(): Promise<void> {
    if (this.assetsLoaded || !this.ctx) return;
    this.assetsLoaded = true;
    try {
      const manifest = await loadAssetJson<KitManifest>('kits/manifest.json');
      const tasks: Promise<void>[] = [];

      for (const [kitId, kit] of Object.entries(manifest.kits)) {
        for (const [voice, relFile] of Object.entries(kit.files)) {
          const key = `kits/${kitId}/${voice}.wav`;
          tasks.push(
            loadAssetBinary(`kits/${relFile}`)
              .then((ab) => this.ctx!.decodeAudioData(ab.slice(0)))
              .then((decoded) => {
                this.kitBuffers.set(key, decoded);
              })
              .catch(() => {})
          );
        }
      }

      for (const sf of manifest.soundfonts || []) {
        tasks.push(
          loadAssetBinary(sf.file)
            .then((ab) => {
              this.sf2Player.registerSoundFont(`${sf.id}.sf2`, ab);
            })
            .catch(() => {})
        );
      }

      await Promise.all(tasks);
    } catch {
      // Synthesized DSP fallback always works cleanly even if asset manifest is absent
    }
  }

  async loadCustomSample(name: string, bytes: Uint8Array): Promise<string> {
    await this.ensureInitialized();
    const ab = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
    const decoded = await this.ctx!.decodeAudioData(ab);
    const key = `custom/${name}`;
    this.kitBuffers.set(key, decoded);
    this.customAudioClips.set(key, decoded);
    return key;
  }

  async loadCustomSoundFont(name: string, bytes: Uint8Array): Promise<{ id: string; presets: string[] }> {
    const ab = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
    const parsed = this.sf2Player.registerSoundFont(name, ab);
    return { id: name, presets: parsed.presets.map((p) => p.name) };
  }

  getKitBuffer(key: string): AudioBuffer | undefined {
    return this.kitBuffers.get(key) || this.customAudioClips.get(key);
  }

  getAudioContext(): AudioContext | null {
    return this.ctx;
  }

  registerAudioBuffer(key: string, buffer: AudioBuffer): void {
    this.kitBuffers.set(key, buffer);
    this.customAudioClips.set(key, buffer);
  }

  listAllLoadedBuffers(): Array<{ key: string; durationSec: number; sampleRate: number }> {
    const out: Array<{ key: string; durationSec: number; sampleRate: number }> = [];
    const seen = new Set<string>();
    for (const [key, buf] of this.customAudioClips.entries()) {
      seen.add(key);
      out.push({ key, durationSec: buf.duration, sampleRate: buf.sampleRate });
    }
    for (const [key, buf] of this.kitBuffers.entries()) {
      if (seen.has(key)) continue;
      out.push({ key, durationSec: buf.duration, sampleRate: buf.sampleRate });
    }
    return out;
  }

  async playBufferOnce(buffer: AudioBuffer, playbackRate = 1.0, startSec = 0, durationSec?: number): Promise<void> {
    await this.ensureInitialized();
    if (!this.ctx || !this.previewBus) return;
    const src = this.ctx.createBufferSource();
    src.buffer = buffer;
    src.playbackRate.value = Math.max(0.25, Math.min(4, playbackRate));
    src.connect(this.previewBus);
    src.start(this.ctx.currentTime + 0.01, Math.max(0, startSec), durationSec);
  }

  private rebuildMixerGraph(state: ProjectState): void {
    if (!this.ctx || !this.telemetryNode) return;
    const anySolo = state.mixerTracks.some((t) => t.kind === 'insert' && t.solo);

    // Ensure every track has a node
    for (const t of state.mixerTracks) {
      if (!this.trackNodes.has(t.id)) {
        const node = new MixerTrackNode(this.ctx, t, state.bpm);
        this.trackNodes.set(t.id, node);
      }
    }

    const master = this.trackNodes.get('mx_master');
    const sendA = this.trackNodes.get('mx_send_a');
    const sendB = this.trackNodes.get('mx_send_b');
    if (!master) return;

    for (const t of state.mixerTracks) {
      const node = this.trackNodes.get(t.id)!;
      try {
        node.output.disconnect();
        node.sendAGain.disconnect();
        node.sendBGain.disconnect();
      } catch {}

      if (t.kind === 'master') {
        node.output.connect(this.telemetryNode);
      } else if (t.kind === 'send') {
        node.output.connect(master.input);
      } else {
        node.output.connect(master.input);
        if (sendA) node.sendAGain.connect(sendA.input);
        if (sendB) node.sendBGain.connect(sendB.input);
      }
      node.applyState(t, state.bpm, anySolo);
    }
  }

  private syncFromStore(): void {
    if (!this.ctx || !this.initialized) return;
    const state = projectStore.getState();
    const anySolo = state.mixerTracks.some((t) => t.kind === 'insert' && t.solo);
    let needsRebuild = false;
    for (const t of state.mixerTracks) {
      const node = this.trackNodes.get(t.id);
      if (!node) {
        needsRebuild = true;
        break;
      }
      node.applyState(t, state.bpm, anySolo);
    }
    if (needsRebuild) this.rebuildMixerGraph(state);
    this.syncClockParams(state);
  }

  private syncClockParams(state: ProjectState): void {
    if (!this.clockNode) return;
    let loopBars = 4;
    if (state.playbackMode === 'pattern') {
      const pat = state.patterns.find((p) => p.id === state.activePatternId);
      loopBars = Math.max(1, (pat?.lengthSteps ?? 16) / 16);
      if (this.liveCodeActive && this.activeLiveProgram) {
        loopBars = Math.max(loopBars, this.activeLiveProgram.loopBars);
      }
    } else {
      loopBars = Math.max(1, Math.ceil((state.loopEndBeat - state.loopStartBeat) / 4));
    }

    this.clockNode.port.postMessage({
      type: 'params',
      bpm: state.bpm,
      swing: state.swing,
      loopEnabled: state.loopEnabled,
      loopBars,
    });
  }

  async play(opts?: {
    scope?: 'all' | 'solo-channel' | 'pattern-only' | 'song-only' | 'live-code-only';
    soloChannelId?: string | null;
  }): Promise<void> {
    await this.ensureInitialized();
    const state = projectStore.getState();
    this.playbackScope = opts?.scope ?? 'all';
    this.activeSoloChannelId = opts?.soloChannelId ?? null;
    this.syncClockParams(state);
    this.telemetry.playing = true;
    this.clockNode?.port.postMessage({ type: 'start' });
  }

  async playAll(): Promise<void> {
    await this.play({ scope: 'all', soloChannelId: null });
  }

  getPlaybackScope() {
    return { scope: this.playbackScope, soloChannelId: this.activeSoloChannelId };
  }

  stop(reset = false): void {
    this.telemetry.playing = false;
    this.heldRecNotes.clear();
    this.clockNode?.port.postMessage({ type: 'stop', reset });
    if (reset) {
      this.telemetry.beatPosition = 0;
      this.telemetry.beatPhase = 0;
      this.telemetry.barPhase = 0;
    }
  }

  subscribePressedNotes(fn: (notes: Set<number>) => void): () => void {
    this.pressedListeners.add(fn);
    return () => this.pressedListeners.delete(fn);
  }

  private emitPressedNotes(): void {
    const snap = new Set(this.activePressedMidi);
    this.pressedListeners.forEach((fn) => fn(snap));
  }

  /** Play note live from PC keyboard, onscreen piano, or MIDI keyboard; records into Piano Roll when Record or Step Entry is active */
  async noteOnLive(channelId: string, midi: number, velocity = 0.85): Promise<void> {
    this.activePressedMidi.add(midi);
    this.emitPressedNotes();
    await this.auditionChannelNote(channelId, midi, velocity, 0.4);

    const state = projectStore.getState();
    const pat = state.patterns.find((p) => p.id === state.activePatternId);
    const ch = state.channels.find((c) => c.id === channelId);
    if (!pat || !ch) return;
    const patBeats = pat.lengthSteps / 4;

    // Note Step Entry mode: stamps note at cursor and advances by 0.5 beat even while stopped
    if (state.stepEntryMode && !this.telemetry.playing) {
      const at = this.stepEntryBeatCursor % patBeats;
      projectStore.update((s) => {
        const p = s.patterns.find((x) => x.id === s.activePatternId);
        if (!p) return;
        if (!p.notes[channelId]) p.notes[channelId] = [];
        p.notes[channelId].push({
          id: uid('step'),
          midi,
          startBeat: at,
          duration: 0.5,
          velocity,
          pan: 0,
        });
      });
      this.stepEntryBeatCursor = (at + 0.5) % patBeats;
      return;
    }

    const t = this.readTelemetry();
    if (!state.recording || !t.playing) return;

    let localBeat = ((t.beatPosition % patBeats) + patBeats) % patBeats;
    if (state.recordQuantize) {
      localBeat = Math.round(localBeat * 4) / 4;
      if (localBeat >= patBeats) localBeat = 0;
    }

    if (ch.engine === 'DrumSynth') {
      const stepIdx = Math.floor(localBeat * 4) % pat.lengthSteps;
      projectStore.update((s) => {
        const p = s.patterns.find((x) => x.id === s.activePatternId);
        if (p?.steps[channelId]?.[stepIdx]) {
          p.steps[channelId][stepIdx].active = true;
          p.steps[channelId][stepIdx].velocity = velocity;
        }
      });
    } else {
      const key = `${channelId}:${midi}`;
      this.heldRecNotes.set(key, { channelId, midi, startBeat: localBeat, velocity });
    }
  }

  noteOffLive(channelId: string, midi: number): void {
    this.activePressedMidi.delete(midi);
    this.emitPressedNotes();

    const key = `${channelId}:${midi}`;
    const held = this.heldRecNotes.get(key);
    if (!held) return;
    this.heldRecNotes.delete(key);

    const state = projectStore.getState();
    const pat = state.patterns.find((p) => p.id === state.activePatternId);
    if (!pat) return;
    const patBeats = pat.lengthSteps / 4;
    const t = this.readTelemetry();
    const nowBeat = ((t.beatPosition % patBeats) + patBeats) % patBeats;
    let rawDur = nowBeat >= held.startBeat ? nowBeat - held.startBeat : patBeats - held.startBeat + nowBeat;
    if (rawDur < 0.125 || rawDur > patBeats) rawDur = 0.25;
    const finalDur = state.recordQuantize ? Math.max(0.25, Math.round(rawDur * 4) / 4) : Math.max(0.125, rawDur);

    projectStore.update((s) => {
      const p = s.patterns.find((x) => x.id === s.activePatternId);
      if (!p) return;
      if (!p.notes[channelId]) p.notes[channelId] = [];
      p.notes[channelId].push({
        id: uid('rec'),
        midi: held.midi,
        startBeat: held.startBeat,
        duration: Math.min(patBeats - held.startBeat, finalDur),
        velocity: held.velocity,
        pan: 0,
      });
    });
  }

  seekBeat(beat: number): void {
    this.telemetry.beatPosition = Math.max(0, beat);
    this.clockNode?.port.postMessage({ type: 'seek', beat });
  }

  /** Quantized live-code hot reload without dropping the beat */
  applyLiveCodeProgram(program: LiveCodeCompiledProgram, quantize: 'beat' | 'bar' | 'immediate' = 'bar'): void {
    this.liveCodeActive = true;
    if (program.bpm && Math.abs(program.bpm - projectStore.getState().bpm) > 0.1) {
      projectStore.update((s) => {
        s.bpm = Math.max(40, Math.min(260, Math.round(program.bpm!)));
        if (typeof program.swing === 'number') s.swing = Math.max(0, Math.min(0.45, program.swing));
      }, false);
    }

    if (!this.telemetry.playing || quantize === 'immediate') {
      this.activeLiveProgram = program;
      this.pendingLiveProgram = null;
      this.syncLiveCodeModRoutes(program);
      this.syncClockParams(projectStore.getState());
    } else {
      this.pendingLiveProgram = { program, quantize };
    }
  }

  setLiveCodeActive(active: boolean): void {
    this.liveCodeActive = active;
    if (!active) {
      this.pendingLiveProgram = null;
    }
    this.syncClockParams(projectStore.getState());
  }

  getActiveLiveProgram(): LiveCodeCompiledProgram | null {
    return this.activeLiveProgram;
  }

  isPendingHotReload(): boolean {
    return this.pendingLiveProgram !== null;
  }

  private syncLiveCodeModRoutes(program: LiveCodeCompiledProgram): void {
    if (program.modOverrides.length === 0) return;
    const state = projectStore.getState();
    projectStore.update((s) => {
      // Remove previous auto-bound livecode mod routes
      s.modRoutes = s.modRoutes.filter((r) => !r.id.startsWith('lc_mod_'));
      program.modOverrides.forEach((mo, idx) => {
        const ch = state.channels.find(
          (c) => c.liveCodeAlias === mo.channelName || c.name.toLowerCase().includes(mo.channelName)
        );
        if (!ch) return;
        s.modRoutes.push({
          id: `lc_mod_${idx}_${mo.channelName}`,
          enabled: true,
          source: mo.source,
          targetType: 'channel',
          targetId: ch.id,
          param: mo.param,
          depth: 0.85,
          min: mo.min,
          max: mo.max,
        });
      });
    }, false);
  }

  /** Bake active live code into an editable Pattern in the Channel Rack / Piano Roll */
  bakeLiveCodeToPattern(program: LiveCodeCompiledProgram, patternName?: string): Pattern {
    const state = projectStore.getState();
    const lengthSteps: 16 | 32 | 64 = program.loopBars >= 4 ? 64 : program.loopBars >= 2 ? 32 : 16;
    const newPat: Pattern = {
      id: uid('pat'),
      name: patternName || `Baked Code (${program.lang.toUpperCase()})`,
      lengthSteps,
      steps: {},
      notes: {},
    };

    for (const ch of state.channels) {
      newPat.steps[ch.id] = Array.from({ length: lengthSteps }, () => ({
        active: false,
        velocity: 0.82,
        pitchOffset: 0,
        pan: 0,
        ratchet: 1,
        probability: 1,
      }));
      newPat.notes[ch.id] = [];
    }

    for (const ev of program.events) {
      if (ev.drumVoice) {
        const ch =
          state.channels.find((c) => c.engine === 'DrumSynth' && c.drumSynth.voice === ev.drumVoice) ||
          state.channels.find((c) => c.engine === 'DrumSynth');
        if (ch) {
          const stepIdx = Math.round(ev.atBeat * 4);
          if (stepIdx >= 0 && stepIdx < lengthSteps) {
            newPat.steps[ch.id][stepIdx] = {
              active: true,
              velocity: ev.velocity,
              pitchOffset: 0,
              pan: ev.pan,
              ratchet: 1,
              probability: 1,
            };
          }
        }
      } else if (ev.midi !== undefined) {
        const ch =
          state.channels.find((c) => c.liveCodeAlias === ev.channelName) ||
          state.channels.find((c) => c.engine === ev.engine) ||
          state.channels[3] ||
          state.channels[0];
        if (ch) {
          newPat.notes[ch.id].push({
            id: uid('n'),
            midi: ev.midi,
            startBeat: ev.atBeat,
            duration: Math.max(0.125, ev.durationBeats),
            velocity: ev.velocity,
            pan: ev.pan,
          });
        }
      }
    }

    projectStore.update((s) => {
      s.patterns.push(newPat);
      s.activePatternId = newPat.id;
      s.playlistClips.push({
        id: uid('clip'),
        trackIndex: 1,
        kind: 'pattern',
        patternId: newPat.id,
        label: newPat.name,
        startBeat: 0,
        durationBeats: lengthSteps / 4,
        offsetBeats: 0,
        muted: false,
      });
    });

    return newPat;
  }

  /** Bake live code directly into a lossless rendered WAV clip on the Playlist */
  async bakeLiveCodeToAudioClip(program: LiveCodeCompiledProgram): Promise<string> {
    await this.ensureInitialized();
    const state = projectStore.getState();
    const config: ExportConfig = {
      format: 'wav32f',
      sampleRate: 48000,
      dither: 'none',
      truePeakCeilingDb: -0.5,
      range: 'selection',
      exportStems: false,
      preserveTailSec: 0.5,
      selectionStartBeat: 0,
      selectionEndBeat: program.loopBars * 4,
    };
    const { audioBuffer } = await renderProjectOffline({
      project: state,
      config,
      kitBuffers: this.kitBuffers,
      sf2Player: this.sf2Player,
      liveProgram: program,
    });
    const clipKey = `baked_${Date.now().toString(36)}`;
    this.customAudioClips.set(clipKey, audioBuffer);
    projectStore.update((s) => {
      s.playlistClips.push({
        id: uid('clip'),
        trackIndex: 2,
        kind: 'audio',
        audioBufferId: clipKey,
        label: `Baked WAV (${program.loopBars} bars)`,
        startBeat: 0,
        durationBeats: program.loopBars * 4,
        offsetBeats: 0,
        muted: false,
      });
    });
    return clipKey;
  }

  private handleClockMessage(msg: {
    beatPosition: number;
    beatPhase: number;
    barPhase: number;
    events: ClockTickEvent[];
  }): void {
    if (!this.sabView) {
      this.telemetry.beatPosition = msg.beatPosition;
      this.telemetry.beatPhase = msg.beatPhase;
      this.telemetry.barPhase = msg.barPhase;
    }

    if (!msg.events || msg.events.length === 0) return;
    const state = projectStore.getState();
    const secPerBeat = 60 / Math.max(30, state.bpm);
    const frame = this.readTelemetry();

    for (const ev of msg.events) {
      // Check quantized live code hot-reload boundary
      if (this.pendingLiveProgram) {
        const isBeatBoundary = Math.abs(ev.beat % 1) < 0.01;
        const isBarBoundary = Math.abs(ev.beat % 4) < 0.01;
        if (
          (this.pendingLiveProgram.quantize === 'beat' && isBeatBoundary) ||
          (this.pendingLiveProgram.quantize === 'bar' && isBarBoundary)
        ) {
          this.activeLiveProgram = this.pendingLiveProgram.program;
          this.syncLiveCodeModRoutes(this.activeLiveProgram);
          this.pendingLiveProgram = null;
          this.syncClockParams(state);
        }
      }

      // Metronome click on quarter notes
      if (state.metronome && ev.stepInBar % 4 === 0) {
        this.triggerMetronome(ev.audioTime, ev.beatInBar === 0);
      }

      const scope = this.playbackScope;
      const runPatternOrSong = scope !== 'live-code-only';
      const useSongMode =
        scope === 'song-only' || (scope === 'all' && state.playbackMode === 'song');

      // Live Automation Lane & Tempo Track evaluation + Kick Sidechain Ducking
      if (state.mixerTracks.some((m) => (m.sidechainDuck ?? 0) > 0.01)) {
        for (const m of state.mixerTracks) {
          if ((m.sidechainDuck ?? 0) > 0.01) {
            this.trackNodes.get(m.id)?.applySidechainDuck(frame.kickEnv, m.sidechainDuck!);
          }
        }
      }

      if (useSongMode && state.tempoTrackPoints && state.tempoTrackPoints.length >= 2) {
        const pts = state.tempoTrackPoints;
        const b = ev.beat;
        let segBpm = state.bpm;
        for (let i = 0; i < pts.length - 1; i++) {
          if (b >= pts[i].beat && b <= pts[i + 1].beat) {
            const span = Math.max(0.001, pts[i + 1].beat - pts[i].beat);
            const tFrac = (b - pts[i].beat) / span;
            segBpm = Math.round(pts[i].bpm + tFrac * (pts[i + 1].bpm - pts[i].bpm));
            break;
          }
        }
        if (Math.abs(segBpm - state.bpm) >= 1) {
          this.clockNode?.port.postMessage({ type: 'params', bpm: segBpm });
        }
      }

      // Apply live Automation Lanes to target channel cutoff/gain/pan
      if (state.automationLanes.length > 0) {
        for (const lane of state.automationLanes) {
          if (lane.points.length < 2) continue;
          const b = ev.beat;
          const pts = lane.points;
          let normVal = pts[0].value;
          if (b >= pts[pts.length - 1].beat) {
            normVal = pts[pts.length - 1].value;
          } else {
            for (let i = 0; i < pts.length - 1; i++) {
              if (b >= pts[i].beat && b <= pts[i + 1].beat) {
                const f = (b - pts[i].beat) / Math.max(0.001, pts[i + 1].beat - pts[i].beat);
                normVal = pts[i].value + f * (pts[i + 1].value - pts[i].value);
                break;
              }
            }
          }
          const val = lane.min + normVal * (lane.max - lane.min);
          if (lane.targetType === 'channel') {
            const ch = state.channels.find((c) => c.id === lane.targetId);
            if (ch && lane.param === 'cutoff') {
              ch.subSynth.cutoff = val;
              ch.fmSynth.cutoff = val;
            }
          }
        }
      }

      // Schedule active Pattern or Song Playlist clips
      if (runPatternOrSong) {
        if (!useSongMode) {
          const pat = state.patterns.find((p) => p.id === state.activePatternId);
          if (pat) {
            const patBeats = pat.lengthSteps / 4;
            const localBeat = ((ev.beat % patBeats) + patBeats) % patBeats;
            this.schedulePatternSlice(
              state,
              pat,
              localBeat,
              ev.audioTime,
              secPerBeat,
              frame,
              scope === 'solo-channel' ? this.activeSoloChannelId : null
            );
          }
        } else {
          for (const clip of state.playlistClips) {
            if (clip.muted) continue;
            if (ev.beat >= clip.startBeat - 0.001 && ev.beat < clip.startBeat + clip.durationBeats - 0.001) {
              if (clip.kind === 'pattern' && clip.patternId) {
                const pat = state.patterns.find((p) => p.id === clip.patternId);
                if (pat) {
                  const patBeats = pat.lengthSteps / 4;
                  const localBeat = ((ev.beat - clip.startBeat + clip.offsetBeats) % patBeats + patBeats) % patBeats;
                  this.schedulePatternSlice(state, pat, localBeat, ev.audioTime, secPerBeat, frame, null);
                }
              } else if (clip.kind === 'audio' && clip.audioBufferId && Math.abs(ev.beat - clip.startBeat) < 0.01) {
                const buf = this.customAudioClips.get(clip.audioBufferId);
                const master = this.trackNodes.get('mx_master');
                if (buf && master && this.ctx) {
                  triggerSampleBuffer(this.ctx, master.input, buf, { time: ev.audioTime, velocity: 0.9 });
                }
              }
            }
          }
        }
      }

      // Schedule Live Code events inside this 16th-note window [ev.beat, ev.beat + 0.25)
      const runLiveCode =
        (scope === 'all' || scope === 'live-code-only') &&
        this.liveCodeActive &&
        this.activeLiveProgram &&
        this.activeLiveProgram.ok;

      if (runLiveCode && this.activeLiveProgram) {
        const prog = this.activeLiveProgram;
        const loopBeats = Math.max(4, prog.loopBars * 4);
        const wStart = ((ev.beat % loopBeats) + loopBeats) % loopBeats;
        const wEnd = wStart + 0.25;
        for (const lev of prog.events) {
          if (lev.atBeat >= wStart - 0.0005 && lev.atBeat < wEnd - 0.0005) {
            const offsetSec = Math.max(0, (lev.atBeat - wStart) * secPerBeat);
            this.triggerLiveCodeEvent(state, lev, ev.audioTime + offsetSec, secPerBeat, frame);
          }
        }
      }
    }
  }

  private schedulePatternSlice(
    state: ProjectState,
    pat: Pattern,
    localBeat: number,
    audioTime: number,
    secPerBeat: number,
    telemetry: TelemetryFrame,
    onlyChannelId: string | null = null
  ): void {
    const stepIdx = Math.floor(localBeat * 4 + 0.001) % pat.lengthSteps;
    const anyChSolo = state.channels.some((c) => c.solo);

    for (const ch of state.channels) {
      if (onlyChannelId) {
        if (ch.id !== onlyChannelId) continue;
      } else if (ch.mute || (anyChSolo && !ch.solo)) {
        continue;
      }

      // 1. Step Sequencer cells
      const steps = pat.steps[ch.id];
      const cell = steps?.[stepIdx];
      if (cell?.active) {
        if (cell.probability >= 0.999 || Math.random() <= cell.probability) {
          const ratchets = cell.ratchet || 1;
          for (let r = 0; r < ratchets; r++) {
            const t = audioTime + (r * 0.25 * secPerBeat) / ratchets;
            this.triggerChannel(
              ch,
              state.modRoutes,
              telemetry,
              t,
              (0.24 / ratchets) * secPerBeat,
              cell.velocity,
              60 + cell.pitchOffset,
              cell.pan
            );
          }
        }
      }

      // 2. Piano Roll notes starting in [localBeat, localBeat + 0.25)
      const notes = pat.notes[ch.id] || [];
      for (const note of notes) {
        if (note.startBeat >= localBeat - 0.001 && note.startBeat < localBeat + 0.25 - 0.001) {
          const offSec = Math.max(0, (note.startBeat - localBeat) * secPerBeat);
          this.triggerChannel(
            ch,
            state.modRoutes,
            telemetry,
            audioTime + offSec,
            Math.max(0.04, note.duration * secPerBeat),
            note.velocity,
            note.midi,
            note.pan,
            undefined,
            note.slide ? note.midi - 2 : undefined
          );
        }
      }
    }
  }

  private triggerLiveCodeEvent(
    state: ProjectState,
    lev: LiveCodeCompiledProgram['events'][number],
    audioTime: number,
    secPerBeat: number,
    telemetry: TelemetryFrame
  ): void {
    if (!this.ctx) return;
    const mx = state.mixerTracks.find((m) => m.index === lev.mixerIndex) || state.mixerTracks[0];
    const dest = (mx ? this.trackNodes.get(mx.id) : this.trackNodes.get('mx_master'))?.input;
    if (!dest) return;

    const matchingCh = state.channels.find(
      (c) => c.liveCodeAlias === lev.channelName || c.name.toLowerCase().includes(lev.channelName)
    );

    if (lev.drumVoice) {
      if (lev.drumVoice === 'bd') {
        this.kickEnv = 1.0;
        this.lastKickTriggerMs = performance.now();
      }
      const key = `kits/${lev.kitId || '808_clean'}/${lev.drumVoice}.wav`;
      const buf = this.kitBuffers.get(key);
      if (buf) {
        triggerSampleBuffer(this.ctx, dest, buf, { time: audioTime, velocity: lev.velocity * lev.gain, pan: lev.pan });
      } else {
        const baseDrum = matchingCh?.drumSynth || {
          kitId: lev.kitId || '808_clean',
          voice: lev.drumVoice,
          useSample: false,
          tuneSemi: 0,
          decay: 0.35,
          tone: 0.5,
          drive: 0.2,
          snap: 0.7,
        };
        triggerSynthesizedDrum(this.ctx, dest, lev.drumVoice, baseDrum, {
          time: audioTime,
          velocity: lev.velocity * lev.gain,
          pan: lev.pan,
        });
      }
      return;
    }

    if (lev.midi === undefined) return;
    const durSec = Math.max(0.04, lev.durationBeats * secPerBeat);

    // Evaluate beat/audio reactive cutoff modulation directly
    let modCutoff = lev.cutoff;
    if (lev.cutoffMod) {
      const fakeRoute: ModRoute = {
        id: 'tmp',
        enabled: true,
        source: lev.cutoffMod.source as ModRoute['source'],
        targetType: 'channel',
        targetId: 'tmp',
        param: 'cutoff',
        depth: 1,
        min: lev.cutoffMod.min,
        max: lev.cutoffMod.max,
      };
      modCutoff = evaluateModulatedParam([fakeRoute], 'channel', 'tmp', 'cutoff', lev.cutoffMod.min, telemetry, this.ctx.currentTime);
    }

    if (lev.engine === 'FMSynth') {
      const fmParams =
        (lev.preset && FM_SYNTH_PRESETS[lev.preset]) ||
        matchingCh?.fmSynth ||
        FM_SYNTH_PRESETS['Modular FM Pluck'];
      triggerFmSynthNote(this.ctx, dest, fmParams, {
        midi: lev.midi,
        time: audioTime,
        duration: durSec,
        velocity: lev.velocity * lev.gain,
        pan: lev.pan,
        cutoffOverride: modCutoff,
      });
    } else if (lev.engine === 'SoundFont') {
      this.sf2Player.triggerNote(this.ctx, dest, {
        fontId: matchingCh?.soundFont.sf2Name || 'bebeat_starter.sf2',
        presetIndex: matchingCh?.soundFont.presetIndex || 0,
        midi: lev.midi,
        time: audioTime,
        duration: durSec,
        velocity: lev.velocity * lev.gain,
        cutoff: modCutoff ?? 9000,
        release: 0.3,
        pan: lev.pan,
      });
    } else {
      const subParams =
        (lev.preset && SUB_SYNTH_PRESETS[lev.preset]) ||
        matchingCh?.subSynth ||
        SUB_SYNTH_PRESETS['Acid 303 Bass'];
      triggerSubSynthNote(this.ctx, dest, subParams, {
        midi: lev.midi,
        time: audioTime,
        duration: durSec,
        velocity: lev.velocity * lev.gain,
        pan: lev.pan,
        cutoffOverride: modCutoff,
      });
    }
  }

  triggerChannel(
    ch: Channel,
    modRoutes: ModRoute[],
    telemetry: TelemetryFrame,
    time: number,
    durationSec: number,
    velocity: number,
    midi: number,
    pan: number,
    destOverride?: AudioNode,
    slideFromMidi?: number
  ): void {
    if (!this.ctx) return;
    const dest = destOverride || (this.trackNodes.get(ch.mixerTrackId) || this.trackNodes.get('mx_master'))?.input;
    if (!dest) return;

    const state = projectStore.getState();
    const globalPitch = state.masterPitchSemi || 0;
    const pitchedMidi = ch.engine === 'DrumSynth' ? midi : Math.max(0, Math.min(127, midi + globalPitch));

    // If channel is a Layer meta-generator, trigger its child channels simultaneously
    if (ch.pluginId === 'layer' && ch.layerChildIds && ch.layerChildIds.length > 0) {
      for (const childId of ch.layerChildIds) {
        const child = state.channels.find((c) => c.id === childId && c.id !== ch.id);
        if (child) {
          this.triggerChannel(child, modRoutes, telemetry, time, durationSec, velocity, midi, pan, destOverride, slideFromMidi);
        }
      }
      return;
    }

    const tNow = this.ctx.currentTime;
    const modGain = evaluateModulatedParam(modRoutes, 'channel', ch.id, 'gain', ch.volume, telemetry, tNow);
    const modPan = evaluateModulatedParam(modRoutes, 'channel', ch.id, 'pan', ch.pan + pan, telemetry, tNow);
    const vel = Math.max(0.01, velocity * modGain);
    const finalPan = Math.max(-1, Math.min(1, modPan));

    if (ch.engine === 'DrumSynth') {
      if (ch.drumSynth.voice === 'bd') {
        this.kickEnv = 1.0;
        this.lastKickTriggerMs = performance.now();
      }
      const key = `kits/${ch.drumSynth.kitId}/${ch.drumSynth.voice}.wav`;
      const buf = ch.drumSynth.useSample ? this.kitBuffers.get(key) : undefined;
      if (buf) {
        triggerSampleBuffer(this.ctx, dest, buf, {
          time,
          velocity: vel,
          pitchSemi: ch.drumSynth.tuneSemi + (pitchedMidi - 60),
          pan: finalPan,
        });
      } else {
        triggerSynthesizedDrum(this.ctx, dest, ch.drumSynth.voice, ch.drumSynth, {
          time,
          velocity: vel,
          pitchSemi: pitchedMidi - 60,
          pan: finalPan,
        });
      }
    } else if (ch.engine === 'SubSynth') {
      const cutoff = evaluateModulatedParam(modRoutes, 'channel', ch.id, 'cutoff', ch.subSynth.cutoff, telemetry, tNow);
      const detune = evaluateModulatedParam(modRoutes, 'channel', ch.id, 'detune', 0, telemetry, tNow);
      triggerSubSynthNote(this.ctx, dest, ch.subSynth, {
        midi: pitchedMidi,
        time,
        duration: durationSec,
        velocity: vel,
        pan: finalPan,
        cutoffOverride: cutoff,
        detuneOffset: detune,
        slideFromMidi: slideFromMidi !== undefined ? slideFromMidi + globalPitch : undefined,
      });
    } else if (ch.engine === 'FMSynth') {
      const cutoff = evaluateModulatedParam(modRoutes, 'channel', ch.id, 'cutoff', ch.fmSynth.cutoff, telemetry, tNow);
      const fmIndex = evaluateModulatedParam(modRoutes, 'channel', ch.id, 'fmIndex', ch.fmSynth.modIndex, telemetry, tNow);
      triggerFmSynthNote(this.ctx, dest, ch.fmSynth, {
        midi: pitchedMidi,
        time,
        duration: durationSec,
        velocity: vel,
        pan: finalPan,
        cutoffOverride: cutoff,
        modIndexOverride: fmIndex,
      });
    } else if (ch.engine === 'SoundFont') {
      const cutoff = evaluateModulatedParam(modRoutes, 'channel', ch.id, 'cutoff', ch.soundFont.cutoff, telemetry, tNow);
      this.sf2Player.triggerNote(this.ctx, dest, {
        fontId: ch.soundFont.sf2Name,
        presetIndex: ch.soundFont.presetIndex,
        midi: pitchedMidi,
        time,
        duration: durationSec,
        velocity: vel,
        cutoff,
        release: ch.soundFont.release,
        pan: finalPan,
      });
    } else if (ch.engine === 'Sampler') {
      const buf = this.kitBuffers.get(ch.sampler.assetPath);
      if (buf) {
        triggerSampleBuffer(this.ctx, dest, buf, {
          time,
          velocity: vel,
          pitchSemi: pitchedMidi - ch.sampler.rootMidi,
          pan: finalPan,
          cutoff: ch.sampler.cutoff,
          startNorm: ch.sampler.startNorm,
          endNorm: ch.sampler.endNorm,
          duration: durationSec,
          samplerParams: ch.sampler,
        });
      }
    }
  }

  async auditionChannelNote(channelId: string, midi = 60, velocity = 0.85, durationSec = 0.35): Promise<void> {
    await this.ensureInitialized();
    const state = projectStore.getState();
    const ch = state.channels.find((c) => c.id === channelId);
    if (!ch || !this.ctx) return;
    this.triggerChannel(ch, state.modRoutes, this.readTelemetry(), this.ctx.currentTime + 0.005, durationSec, velocity, midi, 0);
  }

  /** Isolated snippet audition on previewBus without disturbing the main mix */
  async auditionInlinePreview(preview: InlinePatternPreview): Promise<void> {
    await this.ensureInitialized();
    if (!this.ctx || !this.previewBus) return;
    const bpm = projectStore.getState().bpm;
    const secPerBeat = 60 / Math.max(40, bpm);
    const t0 = this.ctx.currentTime + 0.02;

    if (preview.drumRows) {
      for (const row of preview.drumRows) {
        row.steps.forEach((on, stepIdx) => {
          if (!on) return;
          const t = t0 + stepIdx * 0.25 * secPerBeat;
          const key = `kits/808_clean/${row.voice}.wav`;
          const buf = this.kitBuffers.get(key);
          if (buf) {
            triggerSampleBuffer(this.ctx!, this.previewBus!, buf, { time: t, velocity: 0.78 });
          } else {
            triggerSynthesizedDrum(this.ctx!, this.previewBus!, row.voice, {
              kitId: '808_clean', voice: row.voice, useSample: false, tuneSemi: 0, decay: 0.3, tone: 0.5, drive: 0.2, snap: 0.6,
            }, { time: t, velocity: 0.78 });
          }
        });
      }
    } else if (preview.notes) {
      const synthPreset = preview.kind === 'chord-strip' ? FM_SYNTH_PRESETS['Electric Tine Keys'] : FM_SYNTH_PRESETS['Modular FM Pluck'];
      for (const n of preview.notes) {
        triggerFmSynthNote(this.ctx, this.previewBus, synthPreset, {
          midi: n.midi,
          time: t0 + n.startBeat * secPerBeat,
          duration: Math.max(0.08, n.duration * secPerBeat),
          velocity: 0.72,
        });
      }
    }
  }

  private triggerMetronome(time: number, accent: boolean): void {
    if (!this.ctx || !this.previewBus) return;
    const osc = this.ctx.createOscillator();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(accent ? 1320 : 880, time);
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(accent ? 0.22 : 0.13, time);
    g.gain.exponentialRampToValueAtTime(0.0001, time + 0.045);
    osc.connect(g).connect(this.previewBus);
    osc.start(time);
    osc.stop(time + 0.05);
  }

  readTelemetry(): TelemetryFrame {
    // Update kick envelope decay
    const elapsedKickSec = (performance.now() - this.lastKickTriggerMs) / 1000;
    this.kickEnv = Math.exp(-elapsedKickSec * 6.5);
    this.telemetry.kickEnv = this.kickEnv < 0.005 ? 0 : this.kickEnv;

    if (this.sabView) {
      this.telemetry.playing = this.sabView[0] > 0.5;
      this.telemetry.beatPosition = this.sabView[1];
      this.telemetry.beatPhase = this.sabView[2];
      this.telemetry.barPhase = this.sabView[3];
      this.telemetry.peakL = this.sabView[4];
      this.telemetry.peakR = this.sabView[5];
      this.telemetry.rmsL = this.sabView[6];
      this.telemetry.rmsR = this.sabView[7];
      this.telemetry.truePeakDb = this.sabView[8];
      this.telemetry.lufsMomentary = this.sabView[9];
      this.telemetry.lufsShortTerm = this.sabView[10];
      this.telemetry.bands.sub = this.sabView[11];
      this.telemetry.bands.lowMid = this.sabView[12];
      this.telemetry.bands.highMid = this.sabView[13];
      this.telemetry.bands.air = this.sabView[14];
      this.telemetry.env = this.sabView[15];
      this.telemetry.onset = this.sabView[16];
      for (let i = 0; i < 64; i++) this.telemetry.fft[i] = this.sabView[32 + i];
      for (let i = 0; i < 256; i++) this.telemetry.wave[i] = this.sabView[128 + i];
    }

    return this.telemetry;
  }

  readMixerTrackPeak(trackId: string): number {
    return this.trackNodes.get(trackId)?.readPeak() ?? 0;
  }

  resetTruePeak(): void {
    this.telemetryNode?.port.postMessage({ type: 'reset-peaks' });
  }

  setEnvelopeConfig(attackSec: number, releaseSec: number): void {
    this.telemetryNode?.port.postMessage({ type: 'env-config', attack: attackSec, release: releaseSec });
  }

  async setOutputDevice(deviceId: string, mode: 'shared' | 'exclusive'): Promise<void> {
    this.outputDeviceId = deviceId;
    this.wasapiMode = mode;
    if (this.ctx && 'setSinkId' in this.ctx) {
      try {
        await (this.ctx as AudioContext & { setSinkId: (id: string) => Promise<void> }).setSinkId(deviceId === 'default' ? '' : deviceId);
      } catch {
        // Ignore if browser rejects sinkId
      }
    }
  }

  getAudioOutputSettings() {
    return {
      outputDeviceId: this.outputDeviceId,
      wasapiMode: this.wasapiMode,
      sampleRate: this.ctx?.sampleRate ?? 48000,
      baseLatencyMs: this.ctx ? Math.round((this.ctx.baseLatency || 0.01) * 1000 * 10) / 10 : 10,
      sabActive: this.telemetry.sabActive,
    };
  }

  // Web MIDI handling & MIDI Learn
  getMidiDevices(): MidiDeviceSummary[] {
    return this.midiDevices;
  }

  onMidiDevicesChange(fn: (devices: MidiDeviceSummary[]) => void): () => void {
    this.midiListeners.add(fn);
    return () => this.midiListeners.delete(fn);
  }

  armMidiLearn(target: { targetType: 'channel' | 'mixer' | 'transport'; targetId: string; param: string; min: number; max: number } | null): void {
    this.midiLearnTarget = target;
  }

  getMidiLearnTarget() {
    return this.midiLearnTarget;
  }

  private handleMidiNoteOn(midi: number, velocity: number): void {
    const state = projectStore.getState();
    void this.noteOnLive(state.selectedChannelId, midi, velocity);
  }

  private handleMidiNoteOff(midi: number): void {
    const state = projectStore.getState();
    this.noteOffLive(state.selectedChannelId, midi);
  }

  private handleMidiCc(cc: number, valueNorm: number, channel: number): void {
    if (this.midiLearnTarget) {
      projectStore.addMidiMapping({
        cc,
        channel,
        ...this.midiLearnTarget,
      });
      this.midiLearnTarget = null;
      return;
    }

    const state = projectStore.getState();
    const mapping = state.midiMappings.find((m) => m.cc === cc && m.channel === channel);
    if (!mapping) return;
    const val = mapping.min + valueNorm * (mapping.max - mapping.min);

    projectStore.update((s) => {
      if (mapping.targetType === 'channel') {
        const ch = s.channels.find((c) => c.id === mapping.targetId);
        if (!ch) return;
        if (mapping.param === 'cutoff') {
          ch.subSynth.cutoff = val;
          ch.fmSynth.cutoff = val;
        } else if (mapping.param === 'resonance') {
          ch.subSynth.resonance = val;
        } else if (mapping.param === 'volume') {
          ch.volume = val;
        }
      } else if (mapping.targetType === 'mixer') {
        const mx = s.mixerTracks.find((m) => m.id === mapping.targetId);
        if (mx && mapping.param === 'volume') mx.volume = val;
      } else if (mapping.targetType === 'transport' && mapping.param === 'bpm') {
        s.bpm = Math.round(val);
      }
    }, false);
  }

  async renderMasterOffline(config: ExportConfig): Promise<{ wavBytes: Uint8Array; stats: OfflineRenderStats }> {
    await this.ensureInitialized();
    const { wavBytes, stats } = await renderProjectOffline({
      project: projectStore.getState(),
      config,
      kitBuffers: this.kitBuffers,
      sf2Player: this.sf2Player,
      liveProgram: this.liveCodeActive ? this.activeLiveProgram : null,
    });
    return { wavBytes, stats };
  }

  async renderStemOffline(config: ExportConfig, mixerTrackId: string): Promise<{ wavBytes: Uint8Array; stats: OfflineRenderStats }> {
    await this.ensureInitialized();
    const { wavBytes, stats } = await renderProjectOffline({
      project: projectStore.getState(),
      config,
      kitBuffers: this.kitBuffers,
      sf2Player: this.sf2Player,
      liveProgram: this.liveCodeActive ? this.activeLiveProgram : null,
      onlyMixerTrackId: mixerTrackId,
    });
    return { wavBytes, stats };
  }
}

export const audioEngine = new BebeatAudioEngine();
