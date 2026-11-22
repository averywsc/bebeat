import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { applyTruePeakCeiling, encodeWavBuffer } from '../src/audio/offlineRenderer';
import { parseSoundFont2 } from '../src/audio/dsp/sf2Player';
import { exportNotesToSmf, importSmfToNotes } from '../src/audio/midiCodec';

test('Lossless WAV encoder outputs valid 32f, 24-bit, and 16-bit headers with TPDF/shaped dither & True Peak ceiling', () => {
  const sr = 48000;
  const n = 2400;
  const left = new Float32Array(n);
  const right = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    left[i] = 1.4 * Math.sin((2 * Math.PI * 440 * i) / sr);
    right[i] = 1.4 * Math.cos((2 * Math.PI * 440 * i) / sr);
  }

  const lim = applyTruePeakCeiling(left, right, -1.0);
  assert.ok(lim.peakDb <= -0.95, `Expected limited peak <= -0.95 dB, got ${lim.peakDb}`);

  const wav32 = encodeWavBuffer(left, right, sr, 32, 'none');
  const v32 = new DataView(wav32.buffer);
  assert.equal(v32.getUint16(20, true), 3); // IEEE float
  assert.equal(v32.getUint16(34, true), 32);
  assert.equal(wav32.byteLength, 44 + n * 2 * 4);

  const wav24 = encodeWavBuffer(left, right, sr, 24, 'tpdf');
  const v24 = new DataView(wav24.buffer);
  assert.equal(v24.getUint16(20, true), 1); // PCM
  assert.equal(v24.getUint16(34, true), 24);
  assert.equal(wav24.byteLength, 44 + n * 2 * 3);

  const wav16 = encodeWavBuffer(left, right, sr, 16, 'shaped');
  const v16 = new DataView(wav16.buffer);
  assert.equal(v16.getUint16(34, true), 16);
  assert.equal(wav16.byteLength, 44 + n * 2 * 2);
});

test('Generated starter SoundFont (.sf2) parses cleanly with 3 presets and valid PCM data', () => {
  const sf2Path = path.resolve(process.cwd(), 'assets/soundfonts/bebeat_starter.sf2');
  assert.ok(fs.existsSync(sf2Path), 'Expected assets/soundfonts/bebeat_starter.sf2 to exist');
  const buf = fs.readFileSync(sf2Path);
  const ab = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
  const parsed = parseSoundFont2(ab);
  assert.equal(parsed.presets.length, 3);
  assert.equal(parsed.samples.length, 3);
  assert.ok(parsed.pcmInt16.length > 100000);
});

test('MIDI SMF Type 1 export & import roundtrip preserves notes and tempo', () => {
  const notes = [
    { id: '1', midi: 60, startBeat: 0, duration: 0.5, velocity: 0.85, pan: 0 },
    { id: '2', midi: 64, startBeat: 1, duration: 0.5, velocity: 0.75, pan: 0 },
    { id: '3', midi: 67, startBeat: 2, duration: 1.0, velocity: 0.9, pan: 0 },
  ];
  const bytes = exportNotesToSmf(notes, 132, 'Test Track');
  assert.ok(bytes.byteLength > 30);
  const imported = importSmfToNotes(bytes, 128);
  assert.equal(imported.bpm, 132);
  assert.equal(imported.notes.length, 3);
  assert.deepEqual(
    imported.notes.map((n) => n.midi),
    [60, 64, 67]
  );
});

test('Local Python 3 live coding bridge compiles @loop + Scale + drums cleanly', () => {
  const bridge = path.resolve(process.cwd(), 'scripts/python_bridge.py');
  const script = `
clock.bpm = 128
drums.kit("808_clean").mixer(1).pattern("bd ~ sn ~, hh*8")

@loop(bars=2)
def arp(bar):
    scale = Scale.minor("C3")
    for step, deg in enumerate([0, 2, 4, 6]):
        lead.play(scale[deg], dur="16n", at=step * 0.25, vel=0.8)
`;
  const out = execFileSync('python', [bridge], { input: script, encoding: 'utf-8' });
  const parsed = JSON.parse(out);
  assert.equal(parsed.ok, true);
  assert.equal(parsed.bpm, 128);
  assert.equal(parsed.bars, 2);
  const leadCh = parsed.channels.find((c: { name: string }) => c.name === 'lead');
  assert.ok(leadCh && leadCh.events.length === 8);
});
