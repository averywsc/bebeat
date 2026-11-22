import test from 'node:test';
import assert from 'node:assert/strict';
import {
  Chord,
  Scale,
  euclid,
  markov,
  midiToNoteName,
  noteToMidi,
  parseMiniNotation,
  polyrhythm,
} from '../src/livecode/musicTheory';
import { compileJsLiveCode } from '../src/livecode/jsRuntime';
import { compilePythonEmbedded } from '../src/livecode/pythonRuntime';
import { extractInlineCodePreviews } from '../src/livecode/astPreview';
import { BUILTIN_CODE_PRESETS } from '../src/state/presets';

test('noteToMidi & midiToNoteName roundtrip', () => {
  assert.equal(noteToMidi('C4'), 60);
  assert.equal(noteToMidi('A4'), 69);
  assert.equal(noteToMidi('Eb2'), 39);
  assert.equal(midiToNoteName(60), 'C4');
  assert.equal(midiToNoteName(69), 'A4');
});

test('Scale, Chord, Euclid, Polyrhythm, Markov helpers', () => {
  const cMin = Scale.minor('C3', 1);
  assert.deepEqual(cMin, [48, 50, 51, 53, 55, 56, 58]);
  assert.deepEqual(Chord.min7('C4'), [60, 63, 67, 70]);

  const e58 = euclid(5, 8);
  assert.equal(e58.length, 8);
  assert.equal(e58.reduce((a, b) => a + b, 0), 5);

  const pr = polyrhythm(3, 4, 4);
  assert.equal(pr.layerA.length, 3);
  assert.equal(pr.layerB.length, 4);

  const seq = markov(['a', 'b'], [[0, 1], [1, 0]], 6, 1);
  assert.deepEqual(seq, ['a', 'b', 'a', 'b', 'a', 'b']);
});

test('Mini-notation parses layered drums, subdivisions, multipliers, and euclidean syntax', () => {
  const events = parseMiniNotation('bd ~ [sn cp] bd*2, hh*8', 4);
  const bds = events.filter((e) => e.token === 'bd');
  const hhs = events.filter((e) => e.token === 'hh');
  assert.equal(bds.length, 3);
  assert.equal(hhs.length, 8);
  assert.ok(events.some((e) => e.token === 'sn'));
  assert.ok(events.some((e) => e.token === 'cp'));

  const eucEvs = parseMiniNotation('bd(5,8)', 4);
  assert.equal(eucEvs.length, 5);
});

test('All built-in JS and Python code presets compile cleanly with events & AST previews', () => {
  for (const preset of BUILTIN_CODE_PRESETS) {
    const res =
      preset.lang === 'javascript'
        ? compileJsLiveCode(preset.code, preset.bpm)
        : compilePythonEmbedded(preset.code, preset.bpm);

    assert.equal(res.ok, true, `Preset "${preset.name}" failed: ${res.error}`);
    assert.ok(res.events.length > 0, `Preset "${preset.name}" produced zero events`);
    assert.equal(res.bpm, preset.bpm);

    const previews = extractInlineCodePreviews(preset.code);
    assert.ok(previews.length >= 1, `Preset "${preset.name}" should produce at least one inline preview`);
  }
});
