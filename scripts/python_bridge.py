#!/usr/bin/env python3
"""
Bebeat Local Python Live Coding Compiler Bridge.
Executes user Python live-coding scripts in a clean namespace with Bebeat's
Scale, Chord, euclid, markov, clock, drums, bass, lead, pad, beat, bands, env, and @loop helpers,
and emits a JSON schedule of timed musical events and parameter curves to stdout.
Supports local NumPy/SciPy if installed in the user's Python environment.
"""

from __future__ import annotations

import json
import math
import random
import sys
from typing import Any, Callable

NOTE_OFFSETS = {
    "C": 0, "C#": 1, "DB": 1, "D": 2, "D#": 3, "EB": 3,
    "E": 4, "F": 5, "F#": 6, "GB": 6, "G": 7, "G#": 8,
    "AB": 8, "A": 9, "A#": 10, "BB": 10, "B": 11,
}

SCALE_INTERVALS = {
    "major": [0, 2, 4, 5, 7, 9, 11],
    "minor": [0, 2, 3, 5, 7, 8, 10],
    "dorian": [0, 2, 3, 5, 7, 9, 10],
    "phrygian": [0, 1, 3, 5, 7, 8, 10],
    "lydian": [0, 2, 4, 6, 7, 9, 11],
    "mixolydian": [0, 2, 4, 5, 7, 9, 10],
    "pentatonic": [0, 3, 5, 7, 10],
    "harmonic_minor": [0, 2, 3, 5, 7, 8, 11],
}

CHORD_INTERVALS = {
    "maj": [0, 4, 7],
    "min": [0, 3, 7],
    "maj7": [0, 4, 7, 11],
    "min7": [0, 3, 7, 10],
    "dom7": [0, 4, 7, 10],
    "sus2": [0, 2, 7],
    "sus4": [0, 5, 7],
    "min9": [0, 3, 7, 10, 14],
    "add9": [0, 4, 7, 14],
}


def note_to_midi(note: Any) -> int:
    if isinstance(note, (int, float)):
        return int(round(note))
    s = str(note).strip().upper()
    if len(s) >= 2 and s[1] in ("#", "B"):
        name = s[:2]
        octv = int(s[2:]) if len(s) > 2 else 4
    else:
        name = s[:1]
        octv = int(s[1:]) if len(s) > 1 else 4
    return (octv + 1) * 12 + NOTE_OFFSETS.get(name, 0)


def dur_to_beats(dur: Any) -> float:
    if isinstance(dur, (int, float)):
        return float(dur)
    mapping = {
        "1n": 4.0, "2n": 2.0, "4n": 1.0, "8n": 0.5,
        "16n": 0.25, "32n": 0.125, "8t": 1.0 / 3.0, "16t": 1.0 / 6.0,
    }
    return mapping.get(str(dur).strip().lower(), 0.25)


def euclid(pulses: int, steps: int, rotate: int = 0) -> list[int]:
    if steps <= 0:
        return []
    pulses = max(0, min(pulses, steps))
    pattern = [1 if ((i * pulses) % steps) < pulses else 0 for i in range(steps)]
    if rotate:
        r = rotate % steps
        pattern = pattern[-r:] + pattern[:-r]
    return pattern


class ScaleSeq:
    def __init__(self, root: str, mode: str = "minor"):
        self.root_midi = note_to_midi(root)
        self.intervals = SCALE_INTERVALS.get(mode, SCALE_INTERVALS["minor"])

    def __getitem__(self, deg: int) -> int:
        n = len(self.intervals)
        octave_shift = deg // n
        idx = deg % n
        return self.root_midi + octave_shift * 12 + self.intervals[idx]

    def notes(self, count: int = 8) -> list[int]:
        return [self[i] for i in range(count)]


class Scale:
    @staticmethod
    def major(root: str) -> ScaleSeq:
        return ScaleSeq(root, "major")

    @staticmethod
    def minor(root: str) -> ScaleSeq:
        return ScaleSeq(root, "minor")

    @staticmethod
    def dorian(root: str) -> ScaleSeq:
        return ScaleSeq(root, "dorian")

    @staticmethod
    def phrygian(root: str) -> ScaleSeq:
        return ScaleSeq(root, "phrygian")

    @staticmethod
    def pentatonic(root: str) -> ScaleSeq:
        return ScaleSeq(root, "pentatonic")

    @staticmethod
    def harmonic_minor(root: str) -> ScaleSeq:
        return ScaleSeq(root, "harmonic_minor")


class Chord:
    @staticmethod
    def build(root: str, quality: str = "min7") -> list[int]:
        r = note_to_midi(root)
        return [r + iv for iv in CHORD_INTERVALS.get(quality, [0, 3, 7])]

    @staticmethod
    def min7(root: str) -> list[int]:
        return Chord.build(root, "min7")

    @staticmethod
    def maj7(root: str) -> list[int]:
        return Chord.build(root, "maj7")

    @staticmethod
    def min9(root: str) -> list[int]:
        return Chord.build(root, "min9")


def markov(states: list[Any], matrix: list[list[float]], length: int = 16, seed: int = 7) -> list[Any]:
    rng = random.Random(seed)
    idx = 0
    out = []
    for _ in range(length):
        out.append(states[idx])
        row = matrix[idx] if idx < len(matrix) else [1.0 / len(states)] * len(states)
        r = rng.random() * sum(row)
        acc = 0.0
        for j, w in enumerate(row):
            acc += w
            if r <= acc:
                idx = j
                break
    return out


class ModExpr:
    def __init__(self, source: str, min_val: float = 0.0, max_val: float = 1.0):
        self.source = source
        self.min_val = min_val
        self.max_val = max_val

    def map(self, lo: float, hi: float) -> "ModExpr":
        return ModExpr(self.source, float(lo), float(hi))

    def to_dict(self) -> dict[str, Any]:
        return {"source": self.source, "min": self.min_val, "max": self.max_val}


class ClockState:
    def __init__(self) -> None:
        self.bpm: float = 128.0
        self.swing: float = 0.0
        self.bars: int = 0


class InstrumentHandle:
    def __init__(self, name: str, engine: str, mixer_idx: int, registry: dict[str, Any]):
        self.name = name
        self.engine = engine
        self.mixer_idx = mixer_idx
        self.kit_id = "808_clean"
        self.preset_name = ""
        self.gain_val = 0.85
        self.cutoff_mod: Any = None
        self.registry = registry
        self.events: list[dict[str, Any]] = []
        self.patterns: list[dict[str, Any]] = []

    def kit(self, kit_id: str) -> "InstrumentHandle":
        self.kit_id = kit_id
        self.engine = "DrumSynth"
        return self

    def synth(self, engine_name: str, preset: str = "") -> "InstrumentHandle":
        self.engine = engine_name
        self.preset_name = preset
        return self

    def mixer(self, track_index: int) -> "InstrumentHandle":
        self.mixer_idx = int(track_index)
        return self

    def gain(self, value: float) -> "InstrumentHandle":
        self.gain_val = float(value)
        return self

    def cutoff(self, value: Any) -> "InstrumentHandle":
        self.cutoff_mod = value.to_dict() if isinstance(value, ModExpr) else float(value)
        return self

    def pattern(self, mini: str, bars: int = 1) -> "InstrumentHandle":
        self.patterns.append({"type": "mini", "pattern": mini, "bars": bars})
        return self

    def play(self, note: Any, dur: Any = "16n", at: float = 0.0, vel: float = 0.8, pan: float = 0.0) -> "InstrumentHandle":
        notes = note if isinstance(note, (list, tuple)) else [note]
        for n in notes:
            self.events.append({
                "midi": note_to_midi(n),
                "at": float(at),
                "dur": dur_to_beats(dur),
                "vel": max(0.05, min(1.0, float(vel))),
                "pan": max(-1.0, min(1.0, float(pan))),
            })
        return self


def run_user_code(code: str) -> dict[str, Any]:
    clock = ClockState()
    registry: dict[str, InstrumentHandle] = {}
    logs: list[str] = []
    loops: list[tuple[int, Callable[[int], None]]] = []

    def get_inst(name: str, default_engine: str, default_mixer: int) -> InstrumentHandle:
        if name not in registry:
            registry[name] = InstrumentHandle(name, default_engine, default_mixer, registry)
        return registry[name]

    drums = get_inst("drums", "DrumSynth", 1)
    bass = get_inst("bass", "SubSynth", 2)
    lead = get_inst("lead", "FMSynth", 3)
    pad = get_inst("pad", "SubSynth", 4)

    class BandsAPI:
        sub = ModExpr("bands.sub")
        low = ModExpr("bands.low")
        mid = ModExpr("bands.mid")
        highs = ModExpr("bands.highs")

    class BeatAPI:
        phase = ModExpr("beat.phase")
        bar = ModExpr("bar.phase")
        @staticmethod
        def onBeat(n: int) -> ModExpr:
            return ModExpr(f"beat.onBeat({n})")

    class EnvAPI:
        @staticmethod
        def follow(name: str = "kick") -> ModExpr:
            return ModExpr(f"env.follow({name})")

    def loop(bars: int = 2) -> Callable[[Callable[[int], None]], Callable[[int], None]]:
        def decorator(fn: Callable[[int], None]) -> Callable[[int], None]:
            loops.append((max(1, min(16, int(bars))), fn))
            return fn
        return decorator

    def safe_print(*args: Any) -> None:
        logs.append(" ".join(str(a) for a in args))

    ns: dict[str, Any] = {
        "__builtins__": __builtins__,
        "print": safe_print,
        "math": math,
        "random": random,
        "clock": clock,
        "drums": drums,
        "bass": bass,
        "lead": lead,
        "pad": pad,
        "Scale": Scale,
        "Chord": Chord,
        "euclid": euclid,
        "markov": markov,
        "note_to_midi": note_to_midi,
        "bands": BandsAPI,
        "beat": BeatAPI,
        "env": EnvAPI,
        "loop": loop,
    }

    exec(compile(code, "<bebeat-python>", "exec"), ns, ns)

    # Evaluate registered @loop functions across their bar span
    for loop_bars, fn in loops:
        clock.bars = max(clock.bars, loop_bars)
        for b in range(loop_bars):
            before_counts = {k: len(v.events) for k, v in registry.items()}
            fn(b)
            # Offset newly emitted events by bar index (4 beats per bar)
            for k, inst in registry.items():
                start_i = before_counts.get(k, 0)
                for ev in inst.events[start_i:]:
                    ev["at"] += b * 4.0

    channels_out = []
    for inst in registry.values():
        if inst.events or inst.patterns or inst.cutoff_mod is not None:
            channels_out.append({
                "name": inst.name,
                "engine": inst.engine,
                "kitId": inst.kit_id,
                "preset": inst.preset_name,
                "mixer": inst.mixer_idx,
                "gain": inst.gain_val,
                "cutoff": inst.cutoff_mod,
                "patterns": inst.patterns,
                "events": inst.events,
            })

    return {
        "ok": True,
        "bpm": clock.bpm,
        "swing": clock.swing,
        "bars": max(1, clock.bars),
        "channels": channels_out,
        "logs": logs,
    }


def main() -> None:
    code = sys.stdin.read()
    try:
        res = run_user_code(code)
    except Exception as exc:
        res = {"ok": False, "error": f"{type(exc).__name__}: {exc}", "logs": []}
    sys.stdout.write(json.dumps(res))


if __name__ == "__main__":
    main()
