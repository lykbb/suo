"""Build a small original vector-style app mark without external libraries."""
from pathlib import Path
import math
import struct
import zlib

size = 512
supersample = 2
orange = (233, 107, 37)
paper = (255, 249, 238)
points = []


def cubic(a, b, c, d):
    for i in range(61):
        t = i / 60
        points.append(tuple((1-t)**3*a[j] + 3*(1-t)**2*t*b[j] + 3*(1-t)*t*t*c[j] + t**3*d[j] for j in range(2)))


cubic((337, 158), (297, 126), (193, 121), (177, 189))
cubic((177, 189), (163, 249), (315, 238), (332, 298))
cubic((332, 298), (352, 370), (221, 395), (167, 347))
mask_size = size * supersample
mask = bytearray(mask_size * mask_size)
radius = 21 * supersample
for px, py in points:
    mx, my = px * supersample, py * supersample
    for iy in range(max(0, int(my-radius)), min(mask_size, int(my+radius)+1)):
        for ix in range(max(0, int(mx-radius)), min(mask_size, int(mx+radius)+1)):
            if (ix+.5-mx)**2 + (iy+.5-my)**2 < radius**2:
                mask[iy*mask_size+ix] = 1


def stroke(x, y):
    return mask[int(y*supersample)*mask_size+int(x*supersample)]


rows = bytearray()
for py in range(size):
    rows.append(0)
    for px in range(size):
        samples = []
        for sy in range(supersample):
            for sx in range(supersample):
                x, y = px+(sx+.5)/supersample, py+(sy+.5)/supersample
                qx, qy = abs(x-256)-158, abs(y-256)-158
                distance = math.hypot(max(qx, 0), max(qy, 0)) + min(max(qx, qy), 0)-70
                samples.append((*((paper if stroke(x, y) else orange)), 255) if distance < 0 else (0, 0, 0, 0))
        rows.extend(round(sum(value[i] for value in samples)/len(samples)) for i in range(4))


def chunk(name, data):
    return struct.pack('!I', len(data)) + name + data + struct.pack('!I', zlib.crc32(name+data) & 0xffffffff)


output = Path(__file__).resolve().parents[1] / 'src-tauri' / 'icons' / 'icon.png'
output.parent.mkdir(parents=True, exist_ok=True)
with output.open('xb') as stream:
    stream.write(b'\x89PNG\r\n\x1a\n' + chunk(b'IHDR', struct.pack('!IIBBBBB', size, size, 8, 6, 0, 0, 0)) + chunk(b'IDAT', zlib.compress(bytes(rows), 9)) + chunk(b'IEND', b''))
print(output)
