#!/usr/bin/env python3
"""Generate PNG icons for the browser extension without external dependencies."""
import struct
import zlib
import os

def create_png(size):
    """Create a minimal purple gradient PNG icon."""
    # Image data: RGBA pixels
    pixels = []
    for y in range(size):
        row = []
        for x in range(size):
            # Gradient from purple (#7c3aed) to cyan (#06b6d4)
            t_x = x / max(size - 1, 1)
            t_y = y / max(size - 1, 1)
            t = (t_x + t_y) / 2

            r = int(0x7c + (0x06 - 0x7c) * t)
            g = int(0x3a + (0xb6 - 0x3a) * t)
            b = int(0xed + (0xd4 - 0xed) * t)
            a = 255

            # Rounded corners mask
            cx, cy = size / 2, size / 2
            radius = size * 0.22  # corner radius ratio
            dx = abs(x - cx) - (cx - radius)
            dy = abs(y - cy) - (cy - radius)
            if dx > 0 and dy > 0 and (dx * dx + dy * dy) > radius * radius:
                a = 0

            row.extend([r, g, b, a])
        pixels.append(row)

    # Add star symbol (simple cross pattern) in white
    star_size = size // 3
    cx, cy = size // 2, size // 2
    for dy in range(-star_size, star_size + 1):
        for dx in range(-star_size, star_size + 1):
            px, py = cx + dx, cy + dy
            if 0 <= px < size and 0 <= py < size:
                # Diamond/star pattern
                if abs(dx) + abs(dy) <= star_size * 0.7:
                    pixels[py][px * 4] = 255
                    pixels[py][px * 4 + 1] = 255
                    pixels[py][px * 4 + 2] = 255
                    pixels[py][px * 4 + 3] = 255

    # Build PNG
    def make_chunk(chunk_type, data):
        length = struct.pack('>I', len(data))
        crc = struct.pack('>I', zlib.crc32(chunk_type + data) & 0xffffffff)
        return length + chunk_type + data + crc

    # IHDR
    ihdr_data = struct.pack('>IIBBBBB', size, size, 8, 2, 0, 0, 0)
    # Wait - use RGBA (color type 6)
    ihdr_data = struct.pack('>II', size, size) + bytes([8, 6, 0, 0, 0])

    # IDAT: raw scanlines with filter byte
    raw_rows = []
    for row in pixels:
        raw_rows.append(0)  # filter type 0 (None)
        raw_rows.extend(row)

    compressed = zlib.compress(bytes(raw_rows), 9)

    png = (
        b'\x89PNG\r\n\x1a\n' +
        make_chunk(b'IHDR', ihdr_data) +
        make_chunk(b'IDAT', compressed) +
        make_chunk(b'IEND', b'')
    )
    return png


def main():
    icons_dir = os.path.join(os.path.dirname(__file__), 'icons')
    os.makedirs(icons_dir, exist_ok=True)

    for size in [16, 48, 128]:
        png_data = create_png(size)
        out_path = os.path.join(icons_dir, f'icon{size}.png')
        with open(out_path, 'wb') as f:
            f.write(png_data)
        print(f'Created {out_path} ({len(png_data)} bytes)')


if __name__ == '__main__':
    main()
