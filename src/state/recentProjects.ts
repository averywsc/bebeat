import type { ProjectState } from '../types/daw';
import { createEmptySteps, createInitialProject, uid } from './projectStore';
import { LOOP_STARTER_LIBRARY } from '../audio/catalog/plugins';
import { Chord } from '../livecode/musicTheory';

const STORAGE_KEY = 'bebeat_recent_projects_v1';

export interface RecentProjectRecord {
  id: string;
  name: string;
  bpm: number;
  channelsCount: number;
  patternsCount: number;
  updatedAt: string;
  filePath?: string;
  state: ProjectState;
}

export function listRecentProjects(): RecentProjectRecord[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed as RecentProjectRecord[];
  } catch {
    return [];
  }
}

export function saveProjectToRecents(state: ProjectState, existingId?: string, filePath?: string): RecentProjectRecord {
  const list = listRecentProjects();
  const id = existingId || `proj_${state.name.toLowerCase().replace(/[^a-z0-9]+/g, '_').slice(0, 24)}_${Date.now().toString(36).slice(-4)}`;

  const entry: RecentProjectRecord = {
    id,
    name: state.name || 'Untitled Project',
    bpm: state.bpm,
    channelsCount: state.channels.length,
    patternsCount: state.patterns.length,
    updatedAt: new Date().toLocaleString(),
    filePath,
    state: JSON.parse(JSON.stringify(state)),
  };

  const filtered = list.filter((item) => item.id !== id && item.name !== entry.name);
  const next = [entry, ...filtered].slice(0, 20);
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
  } catch {
    // If localStorage quota is full, keep the 6 most recent
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(next.slice(0, 6)));
    } catch {}
  }
  return entry;
}

export function deleteRecentProject(id: string): RecentProjectRecord[] {
  const next = listRecentProjects().filter((item) => item.id !== id);
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
  } catch {}
  return next;
}

export function createBlankProject(name = 'New Studio Session', bpm = 128): ProjectState {
  const base = createInitialProject();
  base.name = name;
  base.bpm = bpm;
  base.patterns = [
    {
      id: 'pat_1',
      name: 'Pattern 1',
      lengthSteps: 16,
      steps: Object.fromEntries(base.channels.map((c) => [c.id, createEmptySteps(16)])),
      notes: Object.fromEntries(base.channels.map((c) => [c.id, []])),
    },
  ];
  base.activePatternId = 'pat_1';
  base.playlistClips = [];
  return base;
}

export function createTemplateProject(templateId: string, customName?: string): ProjectState {
  if (templateId === 'blank') {
    return createBlankProject(customName || 'Untitled Project', 128);
  }
  if (templateId === 'studio-groove') {
    const p = createInitialProject();
    if (customName) p.name = customName;
    return p;
  }

  const loop = LOOP_STARTER_LIBRARY.find((l) => l.id === templateId);
  const p = createInitialProject();
  p.name = customName || (loop ? `${loop.name} Session` : 'New Session');
  if (!loop) return p;

  p.bpm = loop.bpm;
  p.swing = loop.swing;
  const pat = p.patterns[0];
  pat.name = `${loop.name} Main`;
  pat.lengthSteps = 16;

  const kickCh = p.channels.find((c) => c.engine === 'DrumSynth' && c.drumSynth.voice === 'bd');
  const snCh = p.channels.find((c) => c.engine === 'DrumSynth' && (c.drumSynth.voice === 'cp' || c.drumSynth.voice === 'sn'));
  const hhCh = p.channels.find((c) => c.engine === 'DrumSynth' && c.drumSynth.voice === 'hh');
  const bassCh = p.channels.find((c) => c.engine === 'SubSynth');
  const keysCh = p.channels.find((c) => c.engine === 'SoundFont' || c.engine === 'FMSynth');

  if (kickCh) {
    kickCh.drumSynth.kitId = loop.kitId;
    const arr = createEmptySteps(16);
    loop.kickSteps.forEach((i) => { if (arr[i]) arr[i].active = true; });
    pat.steps[kickCh.id] = arr;
  }
  if (snCh) {
    snCh.drumSynth.kitId = loop.kitId;
    const arr = createEmptySteps(16);
    loop.snareSteps.forEach((i) => { if (arr[i]) arr[i].active = true; });
    pat.steps[snCh.id] = arr;
  }
  if (hhCh) {
    hhCh.drumSynth.kitId = loop.kitId;
    const arr = createEmptySteps(16);
    loop.hatSteps.forEach((i) => { if (arr[i]) arr[i].active = true; });
    pat.steps[hhCh.id] = arr;
  }
  if (bassCh) {
    pat.notes[bassCh.id] = loop.bassNotes.map((n) => ({
      id: uid('tn'),
      midi: n.midi,
      startBeat: n.startBeat,
      duration: n.duration,
      velocity: 0.88,
      pan: 0,
    }));
  }
  if (keysCh) {
    const chord = Chord.build(loop.chordRoot, loop.chordQuality);
    pat.notes[keysCh.id] = chord.map((m, idx) => ({
      id: uid('tc'),
      midi: m,
      startBeat: 0,
      duration: 3.5,
      velocity: 0.65 - idx * 0.04,
      pan: (idx - 1.5) * 0.08,
    }));
  }

  return p;
}
