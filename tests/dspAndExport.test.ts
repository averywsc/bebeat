import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { applyTruePeakCeiling, encodeWavBuffer } from '../src/audio/offlineRenderer';
import { parseSoundFont2 } from '../src/audio/dsp/sf2Player';
import { exportNotesToSmf, importSmfToNotes, parseSmfMultiTrack } from '../src/audio/midiCodec';
import { RETRO_VOICE_PRESETS, synthesizeRetroSpeechPcm } from '../src/audio/dsp/retroSpeech';
import {
  detectBestKeySignature,
  detectChordName,
  engraveSheetMusicSvg,
  exportNotesToMusicXml,
} from '../src/audio/sheetMusicEngraver';
import { EFFECT_CATALOG, INSTRUMENT_CATALOG } from '../src/audio/catalog/plugins';

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

test('Retro Text-to-Speech formant synthesizer generates normalized non-silent PCM across voices', () => {
  assert.ok(RETRO_VOICE_PRESETS.length >= 8);
  for (const voiceId of ['sam_82', 'fl_robot', 'cyber_vocoder', 'whisper_ghost', 'giant_bot'] as const) {
    const { samples, sampleRate } = synthesizeRetroSpeechPcm({
      text: 'Bebeat drop the bass 1 2 3',
      voiceId,
      sampleRate: 48000,
    });
    assert.equal(sampleRate, 48000);
    assert.ok(samples.length > 24000, `Expected >0.5s audio for ${voiceId}`);
    let maxAbs = 0;
    for (let i = 0; i < samples.length; i++) {
      assert.ok(Number.isFinite(samples[i]));
      const a = Math.abs(samples[i]);
      if (a > maxAbs) maxAbs = a;
    }
    assert.ok(maxAbs > 0.5 && maxAbs <= 0.96, `Expected normalized peak for ${voiceId}, got ${maxAbs}`);
  }
});

test('Multi-track MIDI parser, classical SVG sheet music engraver, MusicXML export & chord detector work cleanly', () => {
  const sampleNotes = [
    { id: 'n1', midi: 60, startBeat: 0, duration: 1, velocity: 0.85, pan: 0 },
    { id: 'n2', midi: 64, startBeat: 0, duration: 1, velocity: 0.8, pan: 0 },
    { id: 'n3', midi: 67, startBeat: 0, duration: 1, velocity: 0.8, pan: 0 },
    { id: 'n4', midi: 71, startBeat: 1, duration: 0.5, velocity: 0.82, pan: 0 },
    { id: 'n5', midi: 72, startBeat: 1.5, duration: 0.5, velocity: 0.85, pan: 0 },
    { id: 'n6', midi: 48, startBeat: 0, duration: 2, velocity: 0.8, pan: 0 },
  ];

  const smfBytes = exportNotesToSmf(sampleNotes, 120, 'Piano Piece');
  const parsed = parseSmfMultiTrack(smfBytes, 'Sonata.mid', 128);
  assert.equal(parsed.name, 'Sonata');
  assert.equal(parsed.bpm, 120);
  assert.equal(parsed.tracks.length, 1);
  assert.equal(parsed.tracks[0].noteCount, 6);

  const engraved = engraveSheetMusicSvg(sampleNotes, {
    title: 'Sonata in C',
    subtitle: 'Piano',
    composer: 'Bebeat',
    bpm: 120,
    timeSig: [4, 4],
    keySignature: 'C',
    clefMode: 'grand',
    paperTheme: 'paper',
  });
  assert.ok(engraved.svg.startsWith('<svg'));
  assert.ok(engraved.svg.includes('Sonata in C'));
  assert.ok(engraved.totalMeasures >= 4);

  const xml = exportNotesToMusicXml(sampleNotes, {
    title: 'Sonata in C',
    bpm: 120,
    timeSig: [4, 4],
    keySignature: 'G',
    clefMode: 'grand',
    paperTheme: 'paper',
  });
  assert.ok(xml.includes('<score-partwise version="3.1">'));
  assert.ok(xml.includes('<fifths>1</fifths>'));

  assert.equal(detectChordName([60, 64, 67]), 'C');
  assert.equal(detectChordName([60, 63, 67, 70]), 'Cmin7');
});

test('Auto key signature detection, chord & dynamics sheet engraving, and full plugin catalog integrity', () => {
  // G Major melody (includes F# = 66)
  const gMajNotes = [
    { id: 'g1', midi: 67, startBeat: 0, duration: 1, velocity: 0.92, pan: 0 },
    { id: 'g2', midi: 71, startBeat: 0, duration: 1, velocity: 0.9, pan: 0 },
    { id: 'g3', midi: 74, startBeat: 0, duration: 1, velocity: 0.88, pan: 0 },
    { id: 'g4', midi: 66, startBeat: 1, duration: 1, velocity: 0.35, pan: 0 },
    { id: 'g5', midi: 67, startBeat: 2, duration: 2, velocity: 0.75, pan: 0 },
  ];
  assert.equal(detectBestKeySignature(gMajNotes), 'G');

  const engraved = engraveSheetMusicSvg(gMajNotes, {
    title: 'G Major Etude',
    bpm: 112,
    timeSig: [4, 4],
    keySignature: 'G',
    clefMode: 'treble',
    paperTheme: 'paper',
    showChords: true,
    showDynamics: true,
  });
  assert.ok(engraved.svg.includes('>Gmaj7<') || engraved.svg.includes('>G<'), 'Expected detected chord symbol G/Gmaj7 above measure');
  assert.ok(engraved.svg.includes('>mf<') || engraved.svg.includes('>f<') || engraved.svg.includes('>ff<'), 'Expected velocity dynamics engraved');

  assert.ok(INSTRUMENT_CATALOG.length >= 30, 'Expected at least 30 built-in generators');
  assert.ok(EFFECT_CATALOG.length >= 80, 'Expected at least 80 built-in effects');
  const uniqueFxIds = new Set(EFFECT_CATALOG.map((e) => e.id));
  assert.equal(uniqueFxIds.size, EFFECT_CATALOG.length, 'Expected unique effect plugin IDs');
});
