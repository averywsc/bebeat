#!/usr/bin/env python3
"""
Procedural 24-bit PCM WAV Drum Kit, One-Shot, Wavetable, and Starter SoundFont (.sf2) Generator for Bebeat.
Zero external dependencies (Python stdlib math/struct/random/json only).
Outputs studio-quality 48kHz 24-bit WAV assets into assets/kits/ and a valid RIFF/sfbk SoundFont into assets/soundfonts/.
"""

from __future__ import annotations

import json
import math
import random
import struct
from pathlib import Path

SR = 48000


def write_wav_24bit(path: Path, samples: list[float], sample_rate: int = SR) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    num_samples = len(samples)
    byte_rate = sample_rate * 1 * 3
    block_align = 3
    data_size = num_samples * 3
    out = bytearray()
    out.extend(b"RIFF")
    out.extend(struct.pack("<I", 36 + data_size))
    out.extend(b"WAVE")
    out.extend(b"fmt ")
    out.extend(struct.pack("<IHHIIHH", 16, 1, 1, sample_rate, byte_rate, block_align, 24))
    out.extend(b"data")
    out.extend(struct.pack("<I", data_size))

    scale = 8388607.0
    for s in samples:
        clamped = max(-1.0, min(1.0, s))
        val = int(round(clamped * scale))
        if val < 0:
            val += 1 << 24
        out.append(val & 0xFF)
        out.append((val >> 8) & 0xFF)
        out.append((val >> 16) & 0xFF)
    path.write_bytes(bytes(out))


def normalize(samples: list[float], peak: float = 0.94) -> list[float]:
    m = max((abs(x) for x in samples), default=1.0)
    if m < 1e-9:
        return samples
    g = peak / m
    return [x * g for x in samples]


def soft_clip(x: float, drive: float = 1.0) -> float:
    return math.tanh(x * drive)


def gen_kick(f_start: float, f_end: float, decay: float, click: float, drive: float, dur: float = 0.55) -> list[float]:
    n = int(SR * dur)
    out = []
    phase = 0.0
    rng = random.Random(42)
    for i in range(n):
        t = i / SR
        freq = f_end + (f_start - f_end) * math.exp(-t * 34.0)
        phase += 2.0 * math.pi * freq / SR
        body = math.sin(phase) * math.exp(-t / decay)
        transient = (math.sin(2.0 * math.pi * 1650.0 * t) + 0.35 * (rng.random() * 2 - 1)) * math.exp(-t * 180.0) * click
        sub_fade = min(1.0, i / 48.0)
        out.append(soft_clip((body + transient) * sub_fade, drive))
    return normalize(out, 0.95)


def gen_snare(tone_hz: float, noise_decay: float, tone_decay: float, snap: float, dur: float = 0.35) -> list[float]:
    n = int(SR * dur)
    out = []
    rng = random.Random(101)
    hp_prev = 0.0
    x_prev = 0.0
    phase = 0.0
    for i in range(n):
        t = i / SR
        freq = tone_hz * (1.0 + 0.5 * math.exp(-t * 60.0))
        phase += 2.0 * math.pi * freq / SR
        body = math.sin(phase) * math.exp(-t / tone_decay)
        white = rng.random() * 2.0 - 1.0
        hp = 0.88 * (hp_prev + white - x_prev)
        hp_prev = hp
        x_prev = white
        wires = hp * math.exp(-t / noise_decay) * snap
        out.append(soft_clip(body * 0.65 + wires * 0.95, 1.35))
    return normalize(out, 0.92)


def gen_clap(dur: float = 0.32) -> list[float]:
    n = int(SR * dur)
    out = []
    rng = random.Random(202)
    bp1 = 0.0
    bp2 = 0.0
    bursts = [0.0, 0.011, 0.022, 0.033]
    for i in range(n):
        t = i / SR
        white = rng.random() * 2.0 - 1.0
        # Simple 2-pole bandpass around 1.2kHz
        bp1 += 0.22 * (white - bp1)
        bp2 += 0.22 * (bp1 - bp2)
        band = bp1 - bp2
        env = 0.0
        for b in bursts:
            if t >= b:
                dt = t - b
                env += math.exp(-dt * (160.0 if b < 0.03 else 18.0)) * (0.75 if b < 0.03 else 1.0)
        out.append(soft_clip(band * env * 3.8, 1.5))
    return normalize(out, 0.92)


def gen_hat(decay: float, metallic_boost: float = 1.0, dur: float = 0.45) -> list[float]:
    n = int(SR * dur)
    out = []
    rng = random.Random(303)
    ratios = [205.3, 304.4, 369.6, 522.7, 540.0, 800.0]
    hp_prev = 0.0
    x_prev = 0.0
    for i in range(n):
        t = i / SR
        metal = sum(1.0 if math.sin(2.0 * math.pi * f * 4.5 * t) >= 0 else -1.0 for f in ratios) / len(ratios)
        white = rng.random() * 2.0 - 1.0
        sig = metal * 0.55 * metallic_boost + white * 0.45
        hp = 0.92 * (hp_prev + sig - x_prev)
        hp_prev = hp
        x_prev = sig
        env = math.exp(-t / decay) * min(1.0, i / 16.0)
        out.append(hp * env)
    return normalize(out, 0.88)


def gen_rim(freq: float = 480.0, dur: float = 0.12) -> list[float]:
    n = int(SR * dur)
    out = []
    for i in range(n):
        t = i / SR
        s = (
            math.sin(2.0 * math.pi * freq * t) * 0.6
            + math.sin(2.0 * math.pi * (freq * 3.17) * t) * 0.5
        ) * math.exp(-t * 75.0)
        out.append(soft_clip(s, 2.2))
    return normalize(out, 0.9)


def gen_tom(f_start: float, f_end: float, decay: float, dur: float = 0.42) -> list[float]:
    n = int(SR * dur)
    out = []
    phase = 0.0
    for i in range(n):
        t = i / SR
        freq = f_end + (f_start - f_end) * math.exp(-t * 22.0)
        phase += 2.0 * math.pi * freq / SR
        s = (math.sin(phase) + 0.18 * math.sin(phase * 2.01)) * math.exp(-t / decay)
        out.append(soft_clip(s, 1.25))
    return normalize(out, 0.92)


def gen_fm_perc(carrier: float, mod_ratio: float, index: float, decay: float, dur: float = 0.35) -> list[float]:
    n = int(SR * dur)
    out = []
    for i in range(n):
        t = i / SR
        idx = index * math.exp(-t * 24.0)
        s = math.sin(2.0 * math.pi * carrier * t + idx * math.sin(2.0 * math.pi * carrier * mod_ratio * t))
        out.append(s * math.exp(-t / decay))
    return normalize(out, 0.9)


def gen_wavetable(name: str, frames: int = 32, frame_len: int = 512) -> list[float]:
    out = []
    for f in range(frames):
        morph = f / max(1, frames - 1)
        for i in range(frame_len):
            p = 2.0 * math.pi * (i / frame_len)
            if name == "acid_morph":
                saw = sum(((-1) ** (k + 1)) * math.sin(k * p) / k for k in range(1, 14)) * 0.6
                sq = sum(math.sin((2 * k - 1) * p) / (2 * k - 1) for k in range(1, 9)) * 0.8
                val = saw * (1.0 - morph) + sq * morph
            elif name == "glass_fm":
                val = math.sin(p + (0.2 + 3.2 * morph) * math.sin(2.0 * p + morph * math.sin(3.0 * p)))
            elif name == "warm_organ":
                val = (
                    math.sin(p)
                    + (0.5 + 0.4 * morph) * math.sin(2 * p)
                    + (0.2 + 0.5 * morph) * math.sin(3 * p)
                    + (0.1 + 0.35 * morph) * math.sin(4 * p)
                    + 0.25 * morph * math.sin(6 * p)
                ) * 0.45
            else:
                # Vocal formant sweep
                h1 = 2 + int(morph * 6)
                val = (
                    0.7 * math.sin(p)
                    + 0.45 * math.sin(h1 * p)
                    + 0.3 * math.sin((h1 + 2) * p)
                ) * 0.65
            out.append(max(-1.0, min(1.0, val)))
    return out


def build_minimal_sf2(path: Path) -> None:
    """
    Generates a clean, spec-compliant RIFF/sfbk SoundFont 2.01 file containing 3 melodic presets:
      0:000 Bebeat Grand Electric Piano
      0:001 Bebeat Warm Analog Bass
      0:002 Bebeat Glass Pluck Bell
    All samples are 16-bit signed mono PCM at 44100 Hz with clean loop points.
    """
    sf_sr = 44100
    n_samps = 44100  # 1 second per instrument

    def make_epiano() -> list[int]:
        res = []
        f = 261.6256  # C4 (MIDI 60)
        for i in range(n_samps):
            t = i / sf_sr
            env = math.exp(-t * 2.1) * min(1.0, i / 64.0)
            tine = math.sin(2 * math.pi * f * 14.0 * t) * math.exp(-t * 18.0) * 0.16
            body = math.sin(2 * math.pi * f * t + 0.9 * math.exp(-t * 5.0) * math.sin(2 * math.pi * f * 2.0 * t))
            val = (body * 0.85 + tine) * env
            res.append(int(max(-32767, min(32767, val * 30000))))
        return res

    def make_bass() -> list[int]:
        res = []
        f = 130.8128  # C3 (MIDI 48)
        for i in range(n_samps):
            t = i / sf_sr
            env = min(1.0, i / 48.0) * (0.45 + 0.55 * math.exp(-t * 3.0))
            s = sum((math.sin(2 * math.pi * f * k * t) / k) * math.exp(-0.25 * k) for k in range(1, 10))
            val = math.tanh(s * 1.4) * env
            res.append(int(max(-32767, min(32767, val * 30000))))
        return res

    def make_bell() -> list[int]:
        res = []
        f = 523.2511  # C5 (MIDI 72)
        for i in range(n_samps):
            t = i / sf_sr
            env = math.exp(-t * 3.2) * min(1.0, i / 24.0)
            s = math.sin(2 * math.pi * f * t + 2.4 * math.exp(-t * 6.0) * math.sin(2 * math.pi * f * 3.5 * t))
            res.append(int(max(-32767, min(32767, s * env * 29000))))
        return res

    samples_meta = [
        ("ElectricPiano", 60, make_epiano()),
        ("AnalogBass", 48, make_bass()),
        ("GlassBell", 72, make_bell()),
    ]

    smpl_data = bytearray()
    shdr_entries = bytearray()
    offset = 0
    for name, root_key, pcm in samples_meta:
        start = offset
        for v in pcm:
            smpl_data.extend(struct.pack("<h", v))
        # 46 zero samples required after each sample per SF2 spec
        smpl_data.extend(b"\x00\x00" * 46)
        end = start + len(pcm)
        loop_start = start + int(len(pcm) * 0.25)
        loop_end = start + int(len(pcm) * 0.85)
        offset = end + 46

        raw_name = name.encode("ascii")[:20].ljust(20, b"\x00")
        shdr_entries.extend(
            raw_name
            + struct.pack("<IIIIIBbHH", start, end, loop_start, loop_end, sf_sr, root_key, 0, 0, 1)
        )
    # EOS terminal shdr
    shdr_entries.extend(b"EOS".ljust(20, b"\x00") + struct.pack("<IIIIIBbHH", 0, 0, 0, 0, 0, 0, 0, 0, 0))

    def riff_chunk(fourcc: bytes, payload: bytes) -> bytes:
        pad = b"\x00" if len(payload) % 2 == 1 else b""
        return fourcc + struct.pack("<I", len(payload)) + payload + pad

    def list_chunk(list_type: bytes, chunks: list[bytes]) -> bytes:
        return riff_chunk(b"LIST", list_type + b"".join(chunks))

    # INFO list
    info_list = list_chunk(
        b"INFO",
        [
            riff_chunk(b"ifil", struct.pack("<HH", 2, 1)),
            riff_chunk(b"isng", b"EMU8000\x00"),
            riff_chunk(b"INAM", b"Bebeat Starter SoundFont\x00"),
        ],
    )

    # sdta list
    sdta_list = list_chunk(b"sdta", [riff_chunk(b"smpl", bytes(smpl_data))])

    # pdta list (3 presets -> 3 instruments -> 3 samples)
    phdr = bytearray()
    pbag = bytearray()
    pgen = bytearray()
    inst = bytearray()
    ibag = bytearray()
    igen = bytearray()

    for idx, (name, root_key, _) in enumerate(samples_meta):
        phdr.extend(name.encode("ascii")[:20].ljust(20, b"\x00") + struct.pack("<HHHIII", idx, 0, idx, 0, 0, 0))
        pbag.extend(struct.pack("<HH", idx, 0))
        pgen.extend(struct.pack("<HH", 41, idx))  # instrument gen = 41

        inst.extend(name.encode("ascii")[:20].ljust(20, b"\x00") + struct.pack("<H", idx))
        ibag.extend(struct.pack("<HH", idx * 2, 0))
        igen.extend(struct.pack("<HH", 58, root_key))  # overridingRootKey = 58
        igen.extend(struct.pack("<HH", 53, idx))       # sampleID = 53

    # Terminal records
    phdr.extend(b"EOP".ljust(20, b"\x00") + struct.pack("<HHHIII", 255, 255, len(samples_meta), 0, 0, 0))
    pbag.extend(struct.pack("<HH", len(samples_meta), 0))
    pgen.extend(struct.pack("<HH", 0, 0))
    inst.extend(b"EOI".ljust(20, b"\x00") + struct.pack("<H", len(samples_meta)))
    ibag.extend(struct.pack("<HH", len(samples_meta) * 2, 0))
    igen.extend(struct.pack("<HH", 0, 0))

    empty_mod = struct.pack("<HHhHH", 0, 0, 0, 0, 0)

    pdta_list = list_chunk(
        b"pdta",
        [
            riff_chunk(b"phdr", bytes(phdr)),
            riff_chunk(b"pbag", bytes(pbag)),
            riff_chunk(b"pmod", empty_mod),
            riff_chunk(b"pgen", bytes(pgen)),
            riff_chunk(b"inst", bytes(inst)),
            riff_chunk(b"ibag", bytes(ibag)),
            riff_chunk(b"imod", empty_mod),
            riff_chunk(b"igen", bytes(igen)),
            riff_chunk(b"shdr", bytes(shdr_entries)),
        ],
    )

    body = b"sfbk" + info_list + sdta_list + pdta_list
    sf2 = b"RIFF" + struct.pack("<I", len(body)) + body
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_bytes(sf2)


def main() -> None:
    root = Path(__file__).resolve().parent.parent
    kits_dir = root / "assets" / "kits"
    sf2_dir = root / "assets" / "soundfonts"

    kits_spec = {
        "808_clean": {
            "label": "808 Clean Studio",
            "samples": {
                "bd": gen_kick(155.0, 44.0, 0.34, 0.35, 1.25, 0.65),
                "sn": gen_snare(195.0, 0.13, 0.08, 0.9, 0.34),
                "cp": gen_clap(0.32),
                "hh": gen_hat(0.045, 0.9, 0.16),
                "oh": gen_hat(0.28, 1.0, 0.50),
                "rim": gen_rim(520.0, 0.10),
                "lt": gen_tom(155.0, 72.0, 0.24, 0.42),
                "perc": gen_fm_perc(420.0, 2.41, 3.2, 0.08, 0.24),
            },
        },
        "909_punch": {
            "label": "909 Club Punch",
            "samples": {
                "bd": gen_kick(210.0, 52.0, 0.21, 0.72, 1.75, 0.48),
                "sn": gen_snare(225.0, 0.16, 0.09, 1.15, 0.36),
                "cp": gen_clap(0.29),
                "hh": gen_hat(0.036, 1.35, 0.14),
                "oh": gen_hat(0.35, 1.35, 0.55),
                "rim": gen_rim(640.0, 0.09),
                "lt": gen_tom(195.0, 88.0, 0.18, 0.36),
                "perc": gen_fm_perc(680.0, 1.73, 4.5, 0.06, 0.22),
            },
        },
        "ukg_break": {
            "label": "UKG Tight Break",
            "samples": {
                "bd": gen_kick(185.0, 55.0, 0.14, 0.65, 1.6, 0.34),
                "sn": gen_snare(255.0, 0.09, 0.06, 1.0, 0.26),
                "cp": gen_clap(0.22),
                "hh": gen_hat(0.028, 1.15, 0.11),
                "oh": gen_hat(0.19, 1.15, 0.36),
                "rim": gen_rim(760.0, 0.08),
                "lt": gen_tom(170.0, 95.0, 0.14, 0.28),
                "perc": gen_fm_perc(510.0, 3.14, 3.8, 0.055, 0.18),
            },
        },
        "fm_perc": {
            "label": "FM Metallic Modular",
            "samples": {
                "bd": gen_kick(240.0, 42.0, 0.28, 0.85, 1.9, 0.52),
                "sn": gen_fm_perc(290.0, 4.13, 7.2, 0.12, 0.30),
                "cp": gen_clap(0.26),
                "hh": gen_fm_perc(1920.0, 2.71, 6.4, 0.04, 0.14),
                "oh": gen_fm_perc(1640.0, 3.19, 7.5, 0.24, 0.44),
                "rim": gen_fm_perc(920.0, 1.618, 4.2, 0.05, 0.14),
                "lt": gen_fm_perc(140.0, 1.414, 2.8, 0.22, 0.38),
                "perc": gen_fm_perc(780.0, 2.236, 5.6, 0.09, 0.24),
            },
        },
    }

    manifest = {"sampleRate": SR, "bitDepth": 24, "kits": {}, "wavetables": {}, "soundfonts": []}

    for kit_id, kit_info in kits_spec.items():
        manifest["kits"][kit_id] = {"label": kit_info["label"], "files": {}}
        for voice, data in kit_info["samples"].items():
            rel = f"{kit_id}/{voice}.wav"
            write_wav_24bit(kits_dir / rel, data, SR)
            manifest["kits"][kit_id]["files"][voice] = rel

    wt_dir = kits_dir / "wavetables"
    for wt_name in ["acid_morph", "glass_fm", "warm_organ", "formant_sweep"]:
        wt_data = gen_wavetable(wt_name, frames=32, frame_len=512)
        rel = f"wavetables/{wt_name}.wav"
        write_wav_24bit(kits_dir / rel, wt_data, SR)
        manifest["wavetables"][wt_name] = {"file": rel, "frames": 32, "frameLength": 512}

    sf2_path = sf2_dir / "bebeat_starter.sf2"
    build_minimal_sf2(sf2_path)
    manifest["soundfonts"].append({"id": "bebeat_starter", "label": "Bebeat Starter SF2", "file": "soundfonts/bebeat_starter.sf2"})

    (kits_dir / "manifest.json").write_text(json.dumps(manifest, indent=2), encoding="utf-8")
    # Also copy manifest and soundfont info into public/assets so dev Vite server can fetch them cleanly too
    public_kits = root / "public" / "assets" / "kits"
    public_sf2 = root / "public" / "assets" / "soundfonts"
    public_sf2.mkdir(parents=True, exist_ok=True)
    for kit_id, kit_info in kits_spec.items():
        for voice, data in kit_info["samples"].items():
            write_wav_24bit(public_kits / kit_id / f"{voice}.wav", data, SR)
    for wt_name in ["acid_morph", "glass_fm", "warm_organ", "formant_sweep"]:
        wt_data = gen_wavetable(wt_name, frames=32, frame_len=512)
        write_wav_24bit(public_kits / "wavetables" / f"{wt_name}.wav", wt_data, SR)
    (public_kits / "manifest.json").write_text(json.dumps(manifest, indent=2), encoding="utf-8")
    (public_sf2 / "bebeat_starter.sf2").write_bytes(sf2_path.read_bytes())

    print(f"[OK] Generated {len(kits_spec)} 24-bit WAV kits, 4 wavetables, and starter SoundFont in {kits_dir}")


if __name__ == "__main__":
    main()
