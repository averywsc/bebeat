import type { DrumVoiceName } from '../types/daw';
import { Chord, Scale, euclid, normalizeDrumToken, noteToMidi, parseMiniNotation } from './musicTheory';

export interface InlinePatternPreview {
  id: string;
  line: number;
  kind: 'drum-grid' | 'piano-roll' | 'chord-strip';
  label: string;
  sourceExpr: string;
  /** For drum-grid: rows of { voice, steps: boolean[16] } */
  drumRows?: Array<{ voice: DrumVoiceName; steps: boolean[] }>;
  /** For piano-roll / chord-strip: list of notes normalized in 0..4 beats */
  notes?: Array<{ midi: number; startBeat: number; duration: number; token: string }>;
}

/**
 * Lightweight AST / Regex analyzer that inspects JS and Python live code lines
 * to produce live inline mini step grids, mini piano rolls, and one-click audition previews.
 */
export function extractInlineCodePreviews(code: string): InlinePatternPreview[] {
  const previews: InlinePatternPreview[] = [];
  const lines = code.split(/\r?\n/);

  lines.forEach((lineText, idx) => {
    const lineNum = idx + 1;
    const trimmed = lineText.trim();
    if (!trimmed || trimmed.startsWith('//') || trimmed.startsWith('#')) return;

    // 1. Mini-notation `.pattern("...")`
    const patMatch = lineText.match(/\.pattern\(\s*["']([^"']+)["']/);
    if (patMatch) {
      const mini = patMatch[1];
      const events = parseMiniNotation(mini, 4);
      const voiceMap = new Map<DrumVoiceName, boolean[]>();
      const melodic: Array<{ midi: number; startBeat: number; duration: number; token: string }> = [];

      for (const ev of events) {
        const dv = normalizeDrumToken(ev.token);
        if (dv) {
          if (!voiceMap.has(dv)) voiceMap.set(dv, Array(16).fill(false));
          const step = Math.floor(((ev.atBeat % 4) + 4) % 4 * 4) % 16;
          voiceMap.get(dv)![step] = true;
        } else {
          melodic.push({
            midi: noteToMidi(ev.token),
            startBeat: ev.atBeat % 4,
            duration: ev.durationBeats,
            token: ev.token,
          });
        }
      }

      if (voiceMap.size > 0) {
        previews.push({
          id: `prev_pat_${lineNum}`,
          line: lineNum,
          kind: 'drum-grid',
          label: `Pattern "${mini.slice(0, 36)}${mini.length > 36 ? '...' : ''}"`,
          sourceExpr: mini,
          drumRows: Array.from(voiceMap.entries()).map(([voice, steps]) => ({ voice, steps })),
        });
      } else if (melodic.length > 0) {
        previews.push({
          id: `prev_patm_${lineNum}`,
          line: lineNum,
          kind: 'piano-roll',
          label: `Melodic Pattern`,
          sourceExpr: mini,
          notes: melodic,
        });
      }
    }

    // 2. `.notes("c2 ~ c2 eb2 | ...")`
    const notesStrMatch = lineText.match(/\.notes\(\s*["']([^"']+)["']/);
    if (notesStrMatch) {
      const raw = notesStrMatch[1];
      const firstBar = raw.split('|')[0].trim();
      const toks = firstBar.split(/\s+/).filter(Boolean);
      const slot = 4 / Math.max(1, toks.length);
      const notes: Array<{ midi: number; startBeat: number; duration: number; token: string }> = [];
      toks.forEach((tok, i) => {
        if (tok === '~' || tok === '-') return;
        notes.push({ midi: noteToMidi(tok), startBeat: i * slot, duration: slot * 0.85, token: tok });
      });
      if (notes.length > 0) {
        previews.push({
          id: `prev_notes_${lineNum}`,
          line: lineNum,
          kind: 'piano-roll',
          label: `Notes "${raw.slice(0, 32)}"`,
          sourceExpr: raw,
          notes,
        });
      }
    }

    // 3. `.euclid(k, n, [...])`
    const eucMatch = lineText.match(/\.euclid\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\[[^\]]+\]|Scale\.\w+\(["'][^"']+["']\))/);
    if (eucMatch) {
      const pulses = parseInt(eucMatch[1], 10);
      const steps = parseInt(eucMatch[2], 10);
      const arg = eucMatch[3];
      let noteList: number[] = [];
      const scMatch = arg.match(/Scale\.(\w+)\(["']([^"']+)["']\)/);
      if (scMatch) {
        noteList = Scale.build(scMatch[2], scMatch[1], 1);
      } else {
        const items = arg.slice(1, -1).split(',').map((s) => s.trim().replace(/^["']|["']$/g, '')).filter(Boolean);
        noteList = items.map((it) => noteToMidi(it));
      }
      const pat = euclid(pulses, steps);
      const stepDur = 4 / Math.max(1, steps);
      const notes: Array<{ midi: number; startBeat: number; duration: number; token: string }> = [];
      let nc = 0;
      pat.forEach((hit, i) => {
        if (!hit) return;
        const m = noteList[nc % Math.max(1, noteList.length)] ?? 60;
        nc++;
        notes.push({ midi: m, startBeat: i * stepDur, duration: stepDur * 0.85, token: String(m) });
      });
      previews.push({
        id: `prev_euc_${lineNum}`,
        line: lineNum,
        kind: 'piano-roll',
        label: `Euclid(${pulses}, ${steps})`,
        sourceExpr: eucMatch[0],
        notes,
      });
    }

    // 4. `Chord.<quality>("Root")`
    const chordMatches = Array.from(lineText.matchAll(/Chord\.(maj7|min9|min7|dom7|sus2|sus4|maj|min)\(["']([^"']+)["']\)/g));
    if (chordMatches.length > 0) {
      const notes: Array<{ midi: number; startBeat: number; duration: number; token: string }> = [];
      const slot = 4 / chordMatches.length;
      chordMatches.forEach((m, ci) => {
        const quality = m[1];
        const root = m[2];
        const mids = Chord.build(root, quality);
        mids.forEach((midi) => {
          notes.push({ midi, startBeat: ci * slot, duration: slot * 0.9, token: `${root}${quality}` });
        });
      });
      previews.push({
        id: `prev_chord_${lineNum}`,
        line: lineNum,
        kind: 'chord-strip',
        label: chordMatches.map((m) => `${m[2]} ${m[1]}`).join(' - '),
        sourceExpr: trimmed,
        notes,
      });
    }
  });

  return previews;
}
