import type { PianoNote } from '../types/daw';
import { midiToNoteName } from '../livecode/musicTheory';

export type ClefMode = 'grand' | 'treble' | 'bass';

export interface SheetMusicOptions {
  title: string;
  subtitle?: string;
  composer?: string;
  bpm: number;
  timeSig: [number, number];
  keySignature: string; // 'C', 'G', 'D', 'A', 'E', 'F', 'Bb', 'Eb', 'Ab'
  clefMode: ClefMode;
  paperTheme: 'paper' | 'dark';
  measuresPerSystem?: number;
  pageWidth?: number;
  showChords?: boolean;
  showDynamics?: boolean;
}

interface KeySigDef {
  type: 'sharp' | 'flat';
  count: number;
  /** Pitch classes altered by key signature */
  alteredPcs: Set<number>;
  /** Treble diatonic staff offsets relative to E4 (30) for each accidental glyph */
  trebleOffsets: number[];
  /** Bass diatonic staff offsets relative to G2 (18) for each accidental glyph */
  bassOffsets: number[];
}

const KEY_SIGNATURES: Record<string, KeySigDef> = {
  C: { type: 'sharp', count: 0, alteredPcs: new Set(), trebleOffsets: [], bassOffsets: [] },
  G: { type: 'sharp', count: 1, alteredPcs: new Set([6]), trebleOffsets: [8], bassOffsets: [6] },
  D: { type: 'sharp', count: 2, alteredPcs: new Set([6, 1]), trebleOffsets: [8, 5], bassOffsets: [6, 3] },
  A: { type: 'sharp', count: 3, alteredPcs: new Set([6, 1, 8]), trebleOffsets: [8, 5, 9], bassOffsets: [6, 3, 7] },
  E: { type: 'sharp', count: 4, alteredPcs: new Set([6, 1, 8, 3]), trebleOffsets: [8, 5, 9, 6], bassOffsets: [6, 3, 7, 4] },
  F: { type: 'flat', count: 1, alteredPcs: new Set([10]), trebleOffsets: [4], bassOffsets: [2] },
  Bb: { type: 'flat', count: 2, alteredPcs: new Set([10, 3]), trebleOffsets: [4, 7], bassOffsets: [2, 5] },
  Eb: { type: 'flat', count: 3, alteredPcs: new Set([10, 3, 8]), trebleOffsets: [4, 7, 3], bassOffsets: [2, 5, 1] },
  Ab: { type: 'flat', count: 4, alteredPcs: new Set([10, 3, 8, 1]), trebleOffsets: [4, 7, 3, 6], bassOffsets: [2, 5, 1, 4] },
};

export const AVAILABLE_KEY_SIGNATURES = Object.keys(KEY_SIGNATURES);

const PC_TO_DIATONIC_SHARP = [0, 0, 1, 1, 2, 3, 3, 4, 4, 5, 5, 6];
const PC_TO_DIATONIC_FLAT = [0, 1, 1, 2, 2, 3, 4, 4, 5, 5, 6, 6];
const PC_IS_BLACK = [false, true, false, true, false, false, true, false, true, false, true, false];

function escapeXml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function quantizeNoteDuration(dur: number): {
  kind: 'whole' | 'half' | 'quarter' | 'eighth' | 'sixteenth';
  dotted: boolean;
  beats: number;
} {
  if (dur >= 3.5) return { kind: 'whole', dotted: false, beats: 4 };
  if (dur >= 2.6) return { kind: 'half', dotted: true, beats: 3 };
  if (dur >= 1.7) return { kind: 'half', dotted: false, beats: 2 };
  if (dur >= 1.25) return { kind: 'quarter', dotted: true, beats: 1.5 };
  if (dur >= 0.72) return { kind: 'quarter', dotted: false, beats: 1 };
  if (dur >= 0.36) return { kind: 'eighth', dotted: false, beats: 0.5 };
  return { kind: 'sixteenth', dotted: false, beats: 0.25 };
}

function midiToDiatonic(midi: number, useFlats: boolean): { diatonic: number; accidental: '' | '#' | 'b' } {
  const oct = Math.floor(midi / 12) - 1;
  const pc = midi % 12;
  const deg = useFlats ? PC_TO_DIATONIC_FLAT[pc] : PC_TO_DIATONIC_SHARP[pc];
  const acc = PC_IS_BLACK[pc] ? (useFlats ? 'b' : '#') : '';
  return { diatonic: oct * 7 + deg, accidental: acc };
}

/** Smooth vector Treble Clef (G-Clef) path scaled to fit a 40px-tall 5-line staff */
function renderTrebleClefSvg(x: number, staffTopY: number, color: string): string {
  // Staff height = 40px (line spacing = 10px), G4 line is at staffTopY + 30
  return `<g transform="translate(${x}, ${staffTopY - 12}) scale(0.95)" fill="none" stroke="${color}" stroke-linecap="round" stroke-linejoin="round">
    <path d="M13 55 C13 62 5 64 5 57 C5 52 10 51 11 54 M13 55 L13 7 C13 2 18 2 18 9 C18 17 7 24 6 35 C5 44 12 49 18 47 C24 45 25 36 19 33 C14 31 10 35 12 40" stroke-width="2.1"/>
    <circle cx="8" cy="57" r="2.2" fill="${color}" stroke="none"/>
  </g>`;
}

/** Smooth vector Bass Clef (F-Clef) path scaled to fit a 40px-tall 5-line staff */
function renderBassClefSvg(x: number, staffTopY: number, color: string): string {
  // F3 line is at staffTopY + 10
  return `<g transform="translate(${x}, ${staffTopY})" fill="none" stroke="${color}" stroke-linecap="round">
    <circle cx="7" cy="11" r="3.4" fill="${color}" stroke="none"/>
    <path d="M7 11 C7 2 21 2 21 13 C21 23 14 31 5 37" stroke-width="2.6"/>
    <circle cx="27" cy="6" r="1.9" fill="${color}" stroke="none"/>
    <circle cx="27" cy="15" r="1.9" fill="${color}" stroke="none"/>
  </g>`;
}

/** Grand staff curly brace connecting Treble & Bass staves */
function renderGrandBraceSvg(x: number, topY: number, bottomY: number, color: string): string {
  const midY = (topY + bottomY) / 2;
  return `<path d="M ${x + 8} ${topY} C ${x - 2} ${topY + 10}, ${x + 4} ${midY - 10}, ${x - 5} ${midY} C ${x + 4} ${midY + 10}, ${x - 2} ${bottomY - 10}, ${x + 8} ${bottomY}" fill="none" stroke="${color}" stroke-width="2.2" stroke-linecap="round"/>`;
}

/** Accidental SVG glyph (# or b) */
function renderAccidentalSvg(x: number, y: number, kind: '#' | 'b', color: string): string {
  if (kind === '#') {
    return `<g transform="translate(${x}, ${y})" stroke="${color}" stroke-linecap="round">
      <line x1="-2.2" y1="-7" x2="-2.2" y2="7" stroke-width="1.2"/>
      <line x1="2.2" y1="-8" x2="2.2" y2="6" stroke-width="1.2"/>
      <line x1="-5" y1="-2" x2="5" y2="-4" stroke-width="1.8"/>
      <line x1="-5" y1="3.5" x2="5" y2="1.5" stroke-width="1.8"/>
    </g>`;
  }
  return `<g transform="translate(${x}, ${y})" fill="none" stroke="${color}" stroke-width="1.35" stroke-linecap="round">
    <line x1="-2.5" y1="-10" x2="-2.5" y2="4"/>
    <path d="M -2.5 -1 C 3.5 -4.5 4.2 1.8 -2.5 4.2"/>
  </g>`;
}

/** Quarter rest glyph */
function renderQuarterRestSvg(x: number, centerY: number, color: string): string {
  return `<path d="M ${x - 2} ${centerY - 12} L ${x + 3} ${centerY - 4} L ${x - 3} ${centerY + 3} L ${x + 2} ${centerY + 10} C ${x - 3} ${centerY + 10}, ${x - 4} ${centerY + 14}, ${x + 1} ${centerY + 16}" fill="none" stroke="${color}" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/>`;
}

export interface EngravedSheetLayout {
  svg: string;
  width: number;
  height: number;
  totalMeasures: number;
  measuresPerSystem: number;
  systemGeometry: Array<{
    startMeasure: number;
    endMeasure: number;
    xStart: number;
    measureWidth: number;
    trebleTopY: number;
    bassTopY: number;
  }>;
}

/**
 * Classical print-grade Sheet Music Engraver.
 * Produces a complete standalone SVG document (with multi-system wrapping, Treble/Bass clefs,
 * grand brace, key & time signatures, stems, beaming, flags, dots, accidentals, ledger lines,
 * rests, and double final barline) suitable for both interactive display and 300-DPI PNG / SVG / PDF download.
 */
export function engraveSheetMusicSvg(
  notes: PianoNote[],
  opts: SheetMusicOptions
): EngravedSheetLayout {
  const width = opts.pageWidth ?? 1020;
  const marginX = 56;
  const headerH = 112;
  const beatsPerMeasure = Math.max(2, opts.timeSig[0] || 4);
  const measuresPerSystem = opts.measuresPerSystem ?? 4;

  const maxNoteEnd = notes.reduce((m, n) => Math.max(m, n.startBeat + n.duration), beatsPerMeasure * 4);
  const totalMeasures = Math.max(4, Math.ceil(maxNoteEnd / beatsPerMeasure));
  const systemCount = Math.ceil(totalMeasures / measuresPerSystem);

  const lineGap = 10; // 40px staff height
  const staffH = lineGap * 4;
  const grandGap = 52; // gap between treble bottom & bass top
  const systemHeight = opts.clefMode === 'grand' ? staffH * 2 + grandGap + 68 : staffH + 92;
  const height = headerH + systemCount * systemHeight + 60;

  const isPaper = opts.paperTheme === 'paper';
  const bgCol = isPaper ? '#FFFFFF' : '#18181B';
  const inkCol = isPaper ? '#111114' : '#ECECEF';
  const staffCol = isPaper ? '#3F3F46' : '#4A4A55';
  const subCol = isPaper ? '#52525B' : '#9494A3';
  const accCol = isPaper ? '#111114' : '#60A5FA';

  const keyDef = KEY_SIGNATURES[opts.keySignature] || KEY_SIGNATURES.C;
  const useFlats = keyDef.type === 'flat';

  const parts: string[] = [];
  parts.push(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">`
  );
  parts.push(`<rect width="${width}" height="${height}" fill="${bgCol}"/>`);

  // Title, Subtitle, Composer, and Tempo Marking
  parts.push(
    `<text x="${width / 2}" y="44" text-anchor="middle" fill="${inkCol}" font-family="Georgia, 'Times New Roman', serif" font-size="26" font-weight="700">${escapeXml(opts.title || 'Untitled Score')}</text>`
  );
  if (opts.subtitle) {
    parts.push(
      `<text x="${width / 2}" y="66" text-anchor="middle" fill="${subCol}" font-family="Georgia, 'Times New Roman', serif" font-size="13" font-style="italic">${escapeXml(opts.subtitle)}</text>`
    );
  }
  if (opts.composer) {
    parts.push(
      `<text x="${width - marginX}" y="86" text-anchor="end" fill="${subCol}" font-family="Georgia, 'Times New Roman', serif" font-size="12">${escapeXml(opts.composer)}</text>`
    );
  }
  // Tempo marking (quarter note = BPM)
  parts.push(
    `<g transform="translate(${marginX}, 84)">
      <ellipse cx="5" cy="-3" rx="4.5" ry="3.2" fill="${inkCol}" transform="rotate(-20 5 -3)"/>
      <line x1="9" y1="-3" x2="9" y2="-18" stroke="${inkCol}" stroke-width="1.3"/>
      <text x="16" y="0" fill="${inkCol}" font-family="Georgia, 'Times New Roman', serif" font-size="13" font-weight="700">= ${Math.round(opts.bpm)}</text>
    </g>`
  );

  const systemGeometry: EngravedSheetLayout['systemGeometry'] = [];

  for (let sys = 0; sys < systemCount; sys++) {
    const startMeasure = sys * measuresPerSystem;
    const endMeasure = Math.min(totalMeasures, startMeasure + measuresPerSystem);
    const measuresInThisSys = endMeasure - startMeasure;

    const topY = headerH + sys * systemHeight;
    const trebleTopY = topY + 24;
    const bassTopY = opts.clefMode === 'grand' ? trebleTopY + staffH + grandGap : trebleTopY;

    const keySigWidth = keyDef.count * 10;
    const timeSigWidth = sys === 0 ? 28 : 6;
    const clefAreaW = 40 + keySigWidth + timeSigWidth;
    const xStaffLeft = marginX;
    const xStaffRight = width - marginX;
    const xNotesStart = xStaffLeft + clefAreaW + 10;
    const usableW = Math.max(120, xStaffRight - xNotesStart);
    const measureWidth = usableW / measuresPerSystem;

    systemGeometry.push({
      startMeasure,
      endMeasure,
      xStart: xNotesStart,
      measureWidth,
      trebleTopY,
      bassTopY,
    });

    const drawStaffLines = (sy: number) => {
      for (let l = 0; l < 5; l++) {
        const y = sy + l * lineGap;
        parts.push(
          `<line x1="${xStaffLeft}" y1="${y}" x2="${xStaffRight}" y2="${y}" stroke="${staffCol}" stroke-width="1"/>`
        );
      }
    };

    if (opts.clefMode === 'grand' || opts.clefMode === 'treble') {
      drawStaffLines(trebleTopY);
      parts.push(renderTrebleClefSvg(xStaffLeft + 4, trebleTopY, inkCol));
      // Key signature on treble (E4 bottom line = trebleTopY + 40)
      keyDef.trebleOffsets.forEach((off, idx) => {
        const ay = trebleTopY + 40 - off * 5;
        parts.push(renderAccidentalSvg(xStaffLeft + 36 + idx * 10, ay, keyDef.type === 'flat' ? 'b' : '#', inkCol));
      });
    }

    if (opts.clefMode === 'grand' || opts.clefMode === 'bass') {
      drawStaffLines(bassTopY);
      parts.push(renderBassClefSvg(xStaffLeft + 5, bassTopY, inkCol));
      keyDef.bassOffsets.forEach((off, idx) => {
        const ay = bassTopY + 40 - off * 5;
        parts.push(renderAccidentalSvg(xStaffLeft + 36 + idx * 10, ay, keyDef.type === 'flat' ? 'b' : '#', inkCol));
      });
    }

    // Left vertical barline & Grand Brace
    const sysTopLine = opts.clefMode === 'bass' ? bassTopY : trebleTopY;
    const sysBotLine = opts.clefMode === 'treble' ? trebleTopY + staffH : bassTopY + staffH;
    parts.push(`<line x1="${xStaffLeft}" y1="${sysTopLine}" x2="${xStaffLeft}" y2="${sysBotLine}" stroke="${inkCol}" stroke-width="1.5"/>`);
    if (opts.clefMode === 'grand') {
      parts.push(renderGrandBraceSvg(xStaffLeft - 10, trebleTopY, bassTopY + staffH, inkCol));
    }

    // Time Signature on first system
    if (sys === 0) {
      const tx = xStaffLeft + 40 + keySigWidth + 6;
      const drawTimeSig = (sy: number) => {
        parts.push(
          `<text x="${tx}" y="${sy + 18}" text-anchor="middle" fill="${inkCol}" font-family="Georgia, 'Times New Roman', serif" font-size="22" font-weight="700">${opts.timeSig[0]}</text>`
        );
        parts.push(
          `<text x="${tx}" y="${sy + 38}" text-anchor="middle" fill="${inkCol}" font-family="Georgia, 'Times New Roman', serif" font-size="22" font-weight="700">${opts.timeSig[1]}</text>`
        );
      };
      if (opts.clefMode === 'grand' || opts.clefMode === 'treble') drawTimeSig(trebleTopY);
      if (opts.clefMode === 'grand' || opts.clefMode === 'bass') drawTimeSig(bassTopY);
    }

    // Measure Number label at start of system
    parts.push(
      `<text x="${xStaffLeft + 2}" y="${sysTopLine - 8}" fill="${subCol}" font-family="Georgia, serif" font-size="10.5" font-style="italic">${startMeasure + 1}</text>`
    );

    // Measure Barlines & Notes
    for (let mOff = 0; mOff < measuresInThisSys; mOff++) {
      const mIdx = startMeasure + mOff;
      const mX = xNotesStart + mOff * measureWidth;
      const mEndX = mX + measureWidth;
      const mStartBeat = mIdx * beatsPerMeasure;
      const mEndBeat = mStartBeat + beatsPerMeasure;
      const isFinalBar = mIdx === totalMeasures - 1;

      if (isFinalBar) {
        parts.push(`<line x1="${mEndX - 5}" y1="${sysTopLine}" x2="${mEndX - 5}" y2="${sysBotLine}" stroke="${inkCol}" stroke-width="1.2"/>`);
        parts.push(`<line x1="${mEndX}" y1="${sysTopLine}" x2="${mEndX}" y2="${sysBotLine}" stroke="${inkCol}" stroke-width="3.2"/>`);
      } else {
        parts.push(`<line x1="${mEndX}" y1="${sysTopLine}" x2="${mEndX}" y2="${sysBotLine}" stroke="${staffCol}" stroke-width="1.1"/>`);
      }

      const mNotes = notes
        .filter((n) => n.startBeat >= mStartBeat - 0.001 && n.startBeat < mEndBeat - 0.001)
        .sort((a, b) => a.startBeat - b.startBeat || a.midi - b.midi);

      // Optional Chord Symbols engraved cleanly above the staff (Lead Sheet / Piano Score style)
      if (opts.showChords && mNotes.length >= 2) {
        const halfBeat = mStartBeat + beatsPerMeasure / 2;
        const halves = [
          { beatOffset: 0, list: mNotes.filter((n) => n.startBeat < halfBeat - 0.01) },
          { beatOffset: beatsPerMeasure / 2, list: mNotes.filter((n) => n.startBeat >= halfBeat - 0.01) },
        ];
        let prevChordLabel = '';
        for (const h of halves) {
          if (h.list.length < 2) continue;
          const label = detectChordName(h.list.map((n) => n.midi));
          if (label && label !== prevChordLabel && label.length <= 8) {
            prevChordLabel = label;
            const cx = mX + 16 + (h.beatOffset / beatsPerMeasure) * (measureWidth - 28);
            parts.push(
              `<text x="${cx}" y="${sysTopLine - 16}" fill="${inkCol}" font-family="Georgia, serif" font-size="11.5" font-weight="700" font-style="italic">${escapeXml(label)}</text>`
            );
          }
        }
      }

      // Optional Dynamic Markings (p, mp, mf, f, ff) from average measure velocity
      if (opts.showDynamics && mNotes.length > 0 && (mOff === 0 || mIdx % 2 === 0)) {
        const avgVel = mNotes.reduce((s, n) => s + n.velocity, 0) / mNotes.length;
        const dyn = avgVel < 0.35 ? 'pp' : avgVel < 0.52 ? 'p' : avgVel < 0.68 ? 'mp' : avgVel < 0.8 ? 'mf' : avgVel < 0.9 ? 'f' : 'ff';
        const dynY = opts.clefMode === 'grand' ? trebleTopY + staffH + grandGap * 0.56 : sysBotLine + 24;
        parts.push(
          `<text x="${mX + 14}" y="${dynY}" fill="${inkCol}" font-family="Georgia, 'Times New Roman', serif" font-size="13" font-weight="700" font-style="italic">${dyn}</text>`
        );
      }

      const renderStaffMeasure = (staffNotes: PianoNote[], isBassStaff: boolean) => {
        const sy = isBassStaff ? bassTopY : trebleTopY;
        const bottomDiatonic = isBassStaff ? 18 : 30; // G2 = 18, E4 = 30
        const midLineDiatonic = bottomDiatonic + 4; // D3 = 22, B4 = 34

        if (staffNotes.length === 0) {
          // Draw clean centered whole-bar rest bar hanging from 2nd line from top
          const rx = mX + measureWidth / 2;
          parts.push(`<rect x="${rx - 6}" y="${sy + lineGap}" width="12" height="5" fill="${inkCol}"/>`);
          return;
        }

        // Group notes by quantized beat onset so chords share a stem cleanly
        const groups = new Map<number, PianoNote[]>();
        for (const n of staffNotes) {
          const bKey = Math.round((n.startBeat - mStartBeat) * 8) / 8;
          const arr = groups.get(bKey) || [];
          arr.push(n);
          groups.set(bKey, arr);
        }

        const sortedGroups = Array.from(groups.entries()).sort((a, b) => a[0] - b[0]);

        // Pre-compute visual info per group for beaming consecutive eighth/sixteenth notes
        const renderedGroups = sortedGroups.map(([localBeat, chord]) => {
          const x = mX + 18 + (localBeat / beatsPerMeasure) * (measureWidth - 28);
          const avgDur = chord.reduce((a, b) => a + b.duration, 0) / chord.length;
          const qDur = quantizeNoteDuration(avgDur);
          const pitches = chord.map((n) => {
            const { diatonic, accidental } = midiToDiatonic(n.midi, useFlats);
            const y = sy + 40 - (diatonic - bottomDiatonic) * 5;
            const pc = n.midi % 12;
            const showAcc = accidental !== '' && !keyDef.alteredPcs.has(pc);
            return { note: n, diatonic, y, accidental: showAcc ? accidental : '' };
          });
          pitches.sort((a, b) => a.diatonic - b.diatonic);
          const avgDia = pitches.reduce((s, p) => s + p.diatonic, 0) / pitches.length;
          const stemUp = avgDia < midLineDiatonic;
          const stemX = stemUp ? x + 5.2 : x - 5.2;
          const minY = Math.min(...pitches.map((p) => p.y));
          const maxY = Math.max(...pitches.map((p) => p.y));
          const stemTipY = stemUp ? minY - 30 : maxY + 30;
          return { localBeat, x, qDur, pitches, stemUp, stemX, minY, maxY, stemTipY };
        });

        // Draw quarter rests for leading empty beats if first note starts >= 1 beat in
        if (renderedGroups.length > 0 && renderedGroups[0].localBeat >= 1) {
          const leadingBeats = Math.floor(renderedGroups[0].localBeat);
          for (let b = 0; b < leadingBeats; b++) {
            const rx = mX + 18 + (b / beatsPerMeasure) * (measureWidth - 28);
            parts.push(renderQuarterRestSvg(rx, sy + 20, inkCol));
          }
        }

        // Identify simple beam pairs (consecutive 8th/16th notes in same beat)
        const beamedIndices = new Set<number>();
        for (let gi = 0; gi < renderedGroups.length - 1; gi++) {
          const a = renderedGroups[gi];
          const b = renderedGroups[gi + 1];
          const aBeamable = a.qDur.kind === 'eighth' || a.qDur.kind === 'sixteenth';
          const bBeamable = b.qDur.kind === 'eighth' || b.qDur.kind === 'sixteenth';
          if (
            aBeamable &&
            bBeamable &&
            Math.floor(a.localBeat) === Math.floor(b.localBeat) &&
            b.localBeat - a.localBeat <= 0.51 &&
            !beamedIndices.has(gi)
          ) {
            beamedIndices.add(gi);
            beamedIndices.add(gi + 1);
            const commonUp = a.stemUp;
            const bTipY = commonUp ? Math.min(a.stemTipY, b.stemTipY) : Math.max(a.stemTipY, b.stemTipY);
            const ax = commonUp ? a.x + 5.2 : a.x - 5.2;
            const bx = commonUp ? b.x + 5.2 : b.x - 5.2;
            // Stems connected to beam
            parts.push(`<line x1="${ax}" y1="${commonUp ? a.maxY : a.minY}" x2="${ax}" y2="${bTipY}" stroke="${inkCol}" stroke-width="1.3"/>`);
            parts.push(`<line x1="${bx}" y1="${commonUp ? b.maxY : b.minY}" x2="${bx}" y2="${bTipY}" stroke="${inkCol}" stroke-width="1.3"/>`);
            // Primary beam
            parts.push(`<line x1="${ax}" y1="${bTipY}" x2="${bx}" y2="${bTipY}" stroke="${inkCol}" stroke-width="4.2"/>`);
            // Secondary beam for 16ths
            if (a.qDur.kind === 'sixteenth' && b.qDur.kind === 'sixteenth') {
              const offset = commonUp ? 6 : -6;
              parts.push(`<line x1="${ax}" y1="${bTipY + offset}" x2="${bx}" y2="${bTipY + offset}" stroke="${inkCol}" stroke-width="3.2"/>`);
            }
          }
        }

        // Draw noteheads, ledger lines, accidentals, dots, and un-beamed stems/flags
        renderedGroups.forEach((g, gi) => {
          const isHollow = g.qDur.kind === 'whole' || g.qDur.kind === 'half';

          // Un-beamed stem & flags
          if (g.qDur.kind !== 'whole' && !beamedIndices.has(gi)) {
            parts.push(
              `<line x1="${g.stemX}" y1="${g.stemUp ? g.maxY : g.minY}" x2="${g.stemX}" y2="${g.stemTipY}" stroke="${inkCol}" stroke-width="1.3"/>`
            );
            if (g.qDur.kind === 'eighth' || g.qDur.kind === 'sixteenth') {
              const dir = g.stemUp ? 1 : -1;
              parts.push(
                `<path d="M ${g.stemX} ${g.stemTipY} C ${g.stemX + 8} ${g.stemTipY + 5 * dir}, ${g.stemX + 10} ${g.stemTipY + 13 * dir}, ${g.stemX + 5} ${g.stemTipY + 18 * dir}" fill="none" stroke="${inkCol}" stroke-width="1.8" stroke-linecap="round"/>`
              );
              if (g.qDur.kind === 'sixteenth') {
                parts.push(
                  `<path d="M ${g.stemX} ${g.stemTipY + 6 * dir} C ${g.stemX + 8} ${g.stemTipY + 11 * dir}, ${g.stemX + 10} ${g.stemTipY + 19 * dir}, ${g.stemX + 5} ${g.stemTipY + 24 * dir}" fill="none" stroke="${inkCol}" stroke-width="1.6" stroke-linecap="round"/>`
                );
              }
            }
          }

          let prevDia = -999;
          g.pitches.forEach((p, pi) => {
            // Avoid overlapping noteheads on adjacent 2nds in a chord
            const shiftedX = p.diatonic - prevDia === 1 ? g.x + (g.stemUp ? 9 : -9) : g.x;
            prevDia = p.diatonic;

            // Automatic ledger lines below bottom line (offset <= -2) or above top line (offset >= 10)
            const relOff = p.diatonic - bottomDiatonic;
            if (relOff <= -2) {
              for (let lo = -2; lo >= relOff; lo -= 2) {
                const ly = sy + 40 - lo * 5;
                parts.push(`<line x1="${shiftedX - 9}" y1="${ly}" x2="${shiftedX + 9}" y2="${ly}" stroke="${staffCol}" stroke-width="1.15"/>`);
              }
            } else if (relOff >= 10) {
              for (let lo = 10; lo <= relOff; lo += 2) {
                const ly = sy + 40 - lo * 5;
                parts.push(`<line x1="${shiftedX - 9}" y1="${ly}" x2="${shiftedX + 9}" y2="${ly}" stroke="${staffCol}" stroke-width="1.15"/>`);
              }
            }

            if (p.accidental === '#' || p.accidental === 'b') {
              parts.push(renderAccidentalSvg(shiftedX - 13 - (pi % 2) * 7, p.y, p.accidental, accCol));
            }

            parts.push(
              `<ellipse cx="${shiftedX}" cy="${p.y}" rx="${g.qDur.kind === 'whole' ? 6.8 : 5.7}" ry="4.1" fill="${isHollow ? bgCol : inkCol}" stroke="${inkCol}" stroke-width="1.6" transform="rotate(-18 ${shiftedX} ${p.y})"/>`
            );

            if (g.qDur.dotted) {
              parts.push(`<circle cx="${shiftedX + 10.5}" cy="${p.y - 1}" r="1.8" fill="${inkCol}"/>`);
            }
          });
        });
      };

      if (opts.clefMode === 'grand') {
        const trebleNotes = mNotes.filter((n) => n.midi >= 60);
        const bassNotes = mNotes.filter((n) => n.midi < 60);
        renderStaffMeasure(trebleNotes, false);
        renderStaffMeasure(bassNotes, true);
      } else if (opts.clefMode === 'treble') {
        renderStaffMeasure(mNotes, false);
      } else {
        renderStaffMeasure(mNotes, true);
      }
    }
  }

  parts.push('</svg>');

  return {
    svg: parts.join('\n'),
    width,
    height,
    totalMeasures,
    measuresPerSystem,
    systemGeometry,
  };
}

/**
 * Generates standard MusicXML 3.1 (.musicxml) so users can open their Bebeat score
 * directly in MuseScore, Sibelius, Finale, Dorico, or GarageBand.
 */
export function exportNotesToMusicXml(notes: PianoNote[], opts: SheetMusicOptions): string {
  const divisions = 4; // 16th note precision
  const beatsPerMeasure = Math.max(2, opts.timeSig[0] || 4);
  const maxEnd = notes.reduce((m, n) => Math.max(m, n.startBeat + n.duration), beatsPerMeasure * 4);
  const totalMeasures = Math.max(4, Math.ceil(maxEnd / beatsPerMeasure));

  const fifthsMap: Record<string, number> = {
    C: 0, G: 1, D: 2, A: 3, E: 4, F: -1, Bb: -2, Eb: -3, Ab: -4,
  };
  const fifths = fifthsMap[opts.keySignature] ?? 0;
  const stepNames = ['C', 'C', 'D', 'D', 'E', 'F', 'F', 'G', 'G', 'A', 'A', 'B'];
  const alters = [0, 1, 0, 1, 0, 0, 1, 0, 1, 0, 1, 0];

  const lines: string[] = [
    `<?xml version="1.0" encoding="UTF-8"?>`,
    `<!DOCTYPE score-partwise PUBLIC "-//Recordare//DTD MusicXML 3.1 Partwise//EN" "http://www.musicxml.org/dtds/partwise.dtd">`,
    `<score-partwise version="3.1">`,
    `  <work><work-title>${escapeXml(opts.title || 'Bebeat Score')}</work-title></work>`,
    `  <identification><creator type="composer">${escapeXml(opts.composer || 'Bebeat Studio')}</creator></identification>`,
    `  <part-list><score-part id="P1"><part-name>${escapeXml(opts.subtitle || 'Piano')}</part-name></score-part></part-list>`,
    `  <part id="P1">`,
  ];

  for (let m = 0; m < totalMeasures; m++) {
    lines.push(`    <measure number="${m + 1}">`);
    if (m === 0) {
      lines.push(`      <attributes>`);
      lines.push(`        <divisions>${divisions}</divisions>`);
      lines.push(`        <key><fifths>${fifths}</fifths></key>`);
      lines.push(`        <time><beats>${opts.timeSig[0]}</beats><beat-type>${opts.timeSig[1]}</beat-type></time>`);
      lines.push(`        <clef><sign>${opts.clefMode === 'bass' ? 'F' : 'G'}</sign><line>${opts.clefMode === 'bass' ? 4 : 2}</line></clef>`);
      lines.push(`      </attributes>`);
      lines.push(`      <direction placement="above"><sound tempo="${Math.round(opts.bpm)}"/></direction>`);
    }

    const mStart = m * beatsPerMeasure;
    const mEnd = mStart + beatsPerMeasure;
    const mNotes = notes
      .filter((n) => n.startBeat >= mStart - 0.001 && n.startBeat < mEnd - 0.001)
      .sort((a, b) => a.startBeat - b.startBeat || a.midi - b.midi);

    if (mNotes.length === 0) {
      lines.push(`      <note><rest/><duration>${beatsPerMeasure * divisions}</duration><type>whole</type></note>`);
    } else {
      let cursor = mStart;
      mNotes.forEach((n, idx) => {
        const isChord = idx > 0 && Math.abs(n.startBeat - mNotes[idx - 1].startBeat) < 0.05;
        if (!isChord && n.startBeat > cursor + 0.06) {
          const restDivs = Math.max(1, Math.round((n.startBeat - cursor) * divisions));
          lines.push(`      <note><rest/><duration>${restDivs}</duration><type>${restDivs >= 4 ? 'quarter' : 'eighth'}</type></note>`);
        }
        const durDivs = Math.max(1, Math.round(n.duration * divisions));
        const q = quantizeNoteDuration(n.duration);
        const pc = n.midi % 12;
        const oct = Math.floor(n.midi / 12) - 1;
        lines.push(`      <note>`);
        if (isChord) lines.push(`        <chord/>`);
        lines.push(`        <pitch><step>${stepNames[pc]}</step>${alters[pc] ? `<alter>${alters[pc]}</alter>` : ''}<octave>${oct}</octave></pitch>`);
        lines.push(`        <duration>${durDivs}</duration>`);
        lines.push(`        <type>${q.kind === 'sixteenth' ? '16th' : q.kind}</type>`);
        if (q.dotted) lines.push(`        <dot/>`);
        lines.push(`      </note>`);
        if (!isChord) cursor = Math.max(cursor, n.startBeat + n.duration);
      });
    }
    lines.push(`    </measure>`);
  }

  lines.push(`  </part>`, `</score-partwise>`);
  return lines.join('\n');
}

/** Detect simple chord name from a set of MIDI pitches for live Chord HUD */
export function detectChordName(midis: number[]): string {
  if (midis.length === 0) return '';
  const uniquePcs = Array.from(new Set(midis.map((m) => m % 12))).sort((a, b) => a - b);
  if (uniquePcs.length === 1) return midiToNoteName(midis[0]);

  const NAMES = ['C', 'C#', 'D', 'Eb', 'E', 'F', 'F#', 'G', 'Ab', 'A', 'Bb', 'B'];
  const PATTERNS: Array<[string, number[]]> = [
    ['maj9', [0, 2, 4, 7, 11]],
    ['min9', [0, 2, 3, 7, 10]],
    ['maj7', [0, 4, 7, 11]],
    ['min7', [0, 3, 7, 10]],
    ['7', [0, 4, 7, 10]],
    ['dim7', [0, 3, 6, 9]],
    ['add9', [0, 2, 4, 7]],
    ['maj', [0, 4, 7]],
    ['min', [0, 3, 7]],
    ['sus2', [0, 2, 7]],
    ['sus4', [0, 5, 7]],
    ['dim', [0, 3, 6]],
    ['aug', [0, 4, 8]],
    ['5', [0, 7]],
  ];

  for (const root of uniquePcs) {
    const rel = uniquePcs.map((pc) => (pc - root + 12) % 12).sort((a, b) => a - b);
    for (const [label, ivs] of PATTERNS) {
      if (ivs.length === rel.length && ivs.every((v, i) => v === rel[i])) {
        return `${NAMES[root]}${label === 'maj' ? '' : label}`;
      }
    }
  }
  return midis
    .slice(0, 4)
    .map((m) => midiToNoteName(m))
    .join(' ');
}

/** Auto-detect best matching key signature from a list of MIDI notes using pitch-class correlation */
export function detectBestKeySignature(notes: PianoNote[]): string {
  if (notes.length === 0) return 'C';
  const hist = new Array(12).fill(0);
  for (const n of notes) hist[n.midi % 12] += Math.max(0.25, n.duration);

  const MAJOR_PROFILE = [6.35, 2.23, 3.48, 2.33, 4.38, 4.09, 2.52, 5.19, 2.39, 3.66, 2.29, 2.88];
  const KEY_TO_ROOT: Array<[string, number]> = [
    ['C', 0], ['G', 7], ['D', 2], ['A', 9], ['E', 4],
    ['F', 5], ['Bb', 10], ['Eb', 3], ['Ab', 8],
  ];

  let bestKey = 'C';
  let bestScore = -Infinity;
  for (const [keyName, root] of KEY_TO_ROOT) {
    let score = 0;
    for (let i = 0; i < 12; i++) {
      score += hist[(root + i) % 12] * MAJOR_PROFILE[i];
    }
    if (score > bestScore) {
      bestScore = score;
      bestKey = keyName;
    }
  }
  return bestKey;
}
