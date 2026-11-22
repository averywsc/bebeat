#!/usr/bin/env python3
"""
Generates a crisp multi-resolution Windows .ico and 256x256 .png icon for Bebeat
matching Totone's deep midnight navy (#080C18), slate border (#24324D), and pure white (#FFFFFF) aesthetic.
Uses only Python stdlib (zlib + struct) with zero external dependencies.
"""

from __future__ import annotations

import struct
import zlib
from pathlib import Path


def in_rounded_rect(x: float, y: float, x0: float, y0: float, x1: float, y1: float, r: float) -> bool:
    if x < x0 or x > x1 or y < y0 or y > y1:
        return False
    dx = max(x0 + r - x, 0.0, x - (x1 - r))
    dy = max(y0 + r - y, 0.0, y - (y1 - r))
    return (dx * dx + dy * dy) <= (r * r)


def make_png(size: int) -> bytes:
    bg = (8, 12, 24, 255)       # #080C18
    border = (36, 50, 77, 255)  # #24324D
    white = (255, 255, 255, 255)

    rows = []
    radius = size * 0.16
    margin = max(2, int(size * 0.04))

    for y in range(size):
        row = bytearray([0])  # PNG filter type 0
        for x in range(size):
            dx = max(margin + radius - x, 0, x - (size - 1 - margin - radius))
            dy = max(margin + radius - y, 0, y - (size - 1 - margin - radius))
            dist = (dx * dx + dy * dy) ** 0.5
            if dist > radius:
                row.extend((0, 0, 0, 0))
                continue

            if dist > radius - max(1.5, size * 0.02):
                row.extend(border)
                continue

            nx = x / size
            ny = y / size

            # Geometric bold 'B' letterform + subtle step-grid bars
            stem = 0.25 <= nx <= 0.39 and 0.20 <= ny <= 0.80
            top_bowl = in_rounded_rect(nx, ny, 0.25, 0.20, 0.72, 0.50, 0.13)
            top_hole = in_rounded_rect(nx, ny, 0.39, 0.30, 0.59, 0.41, 0.05)
            bot_bowl = in_rounded_rect(nx, ny, 0.25, 0.47, 0.76, 0.80, 0.14)
            bot_hole = in_rounded_rect(nx, ny, 0.39, 0.57, 0.62, 0.70, 0.06)

            if (stem or top_bowl or bot_bowl) and not (top_hole or bot_hole):
                row.extend(white)
            else:
                row.extend(bg)
        rows.append(bytes(row))

    raw = b"".join(rows)

    def chunk(tag: bytes, data: bytes) -> bytes:
        return struct.pack(">I", len(data)) + tag + data + struct.pack(">I", zlib.crc32(tag + data) & 0xFFFFFFFF)

    ihdr = struct.pack(">IIBBBBB", size, size, 8, 6, 0, 0, 0)
    return (
        b"\x89PNG\r\n\x1a\n"
        + chunk(b"IHDR", ihdr)
        + chunk(b"IDAT", zlib.compress(raw, 9))
        + chunk(b"IEND", b"")
    )


def make_ico(png_blobs: list[tuple[int, bytes]]) -> bytes:
    header = struct.pack("<HHH", 0, 1, len(png_blobs))
    offset = 6 + 16 * len(png_blobs)
    entries = []
    for size, blob in png_blobs:
        dim = 0 if size >= 256 else size
        entries.append(struct.pack("<BBBBHHII", dim, dim, 0, 0, 1, 32, len(blob), offset))
        offset += len(blob)
    return header + b"".join(entries) + b"".join(b for _, b in png_blobs)


def main() -> None:
    out_dir = Path(__file__).resolve().parent.parent / "build"
    out_dir.mkdir(parents=True, exist_ok=True)
    sizes = [256, 128, 64, 48, 32, 16]
    pngs = [(s, make_png(s)) for s in sizes]
    (out_dir / "icon.png").write_bytes(pngs[0][1])
    (out_dir / "icon.ico").write_bytes(make_ico(pngs))
    print(f"[OK] Wrote {out_dir / 'icon.ico'} and {out_dir / 'icon.png'}")


if __name__ == "__main__":
    main()
