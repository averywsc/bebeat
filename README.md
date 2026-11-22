# Bebeat

Flagship desktop music production DAW, JavaScript & Python live coding studio, beat-reactive modulation workbench, and lossless mastering companion to **Totone** and **Fifilm**.

## Core Architecture
- **Sample-Accurate Audio Engine (`AudioWorklet`)**: Dedicated `bebeat-clock-processor` (25ms lookahead, 5ms tick locked to `AudioContext` sample frames — never `setTimeout`/`setInterval`) and `bebeat-telemetry-processor` using lock-free `SharedArrayBuffer` ring buffers (with automatic `MessagePort` fallback).
- **Beat-Reactive & Audio-Driven Modulation**: Real-time beat/bar phase, onset/transient detector, kick & master envelope followers, and 4-band crossover energy (`Sub 20-90Hz`, `Low-Mid 90-350Hz`, `High-Mid 350-4kHz`, `Air 4k-20kHz`) routable to synth parameters, mixer FX, and live code variables.
- **Built-in Instruments & Bundled 24-bit Library**: `SubSynth` (dual morphable wavetable oscillators, unison, stereo spread, resonant SVF filter, dual ADSR, syncable LFO), 4-op `FMSynth` (6 algorithms), `DrumSynth` + 4 procedurally generated 24-bit WAV kits (`808_clean`, `909_punch`, `ukg_break`, `fm_perc`), Sampler, and RIFF/SF2 SoundFont player (`bebeat_starter.sf2`).
- **JS & Python Live Coding Studio**: Strudel/Gibber-inspired JS engine + dual-mode Python runtime (local Python 3 subprocess bridge + embedded fallback), categorized Code Presets & Snippets drawer, inline AST mini step-grid / piano-roll previews with isolated audition, quantized hot-reload (`Ctrl+Enter`), and one-click Bake to Pattern or Lossless WAV Clip.
- **Lossless Mastering & Stems**: Non-realtime `OfflineAudioContext` rendering to 32-bit float WAV, 24-bit / 16-bit PCM WAV (with TPDF or noise-shaped dither and True Peak ceiling limiter), plus FFmpeg-backed FLAC, AIFF, 320kbps MP3, OGG, batch stem export per mixer track, and `.mid` SMF import/export.

## Commands
- `npm run kits:generate` — Regenerate 24-bit WAV kits, wavetables, and starter `.sf2` SoundFont
- `npm test` — Run DSP, Music Theory, SF2, MIDI, WAV, and Python bridge tests
- `npm run electron:dev` — Run desktop DAW in development mode
- `npm run dist:win` — Build standalone Windows installer (`Bebeat-Setup-1.0.0.exe`) and portable executable (`Bebeat-1.0.0-Portable.exe`) in `release/`
