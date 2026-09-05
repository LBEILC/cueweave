"""Rasterize the simple CueWeave SVG mark into a multi-size Windows ICO."""

from pathlib import Path
from PIL import Image, ImageDraw

SCALE = 16
SIZE = 64 * SCALE


def cubic(start, first, second, end, steps=32):
    points = []
    for index in range(1, steps + 1):
        t = index / steps
        inverse = 1 - t
        x = inverse**3 * start[0] + 3 * inverse**2 * t * first[0] + 3 * inverse * t**2 * second[0] + t**3 * end[0]
        y = inverse**3 * start[1] + 3 * inverse**2 * t * first[1] + 3 * inverse * t**2 * second[1] + t**3 * end[1]
        points.append((x, y))
    return points


def scaled(points):
    return [(round(x * SCALE), round(y * SCALE)) for x, y in points]


def quote(offset):
    points = [(14 + offset, 16), (28 + offset, 16), (28 + offset, 32)]
    points += cubic((28 + offset, 32), (28 + offset, 42), (23 + offset, 47), (14 + offset, 49))
    points.append((14 + offset, 42))
    points += cubic((14 + offset, 42), (19 + offset, 40), (21 + offset, 37), (21 + offset, 33))
    points += [(12 + offset, 33), (12 + offset, 18)]
    points += cubic((12 + offset, 18), (12 + offset, 16.9), (12.9 + offset, 16), (14 + offset, 16), 8)
    return points


image = Image.new("RGBA", (SIZE, SIZE), (0, 0, 0, 0))
draw = ImageDraw.Draw(image)
draw.rounded_rectangle((0, 0, SIZE - 1, SIZE - 1), radius=16 * SCALE, fill="#b6450f")
draw.polygon(scaled(quote(0)), fill="#ffffff")
draw.polygon(scaled(quote(24)), fill="#ffffff")

output = Path(__file__).resolve().parent.parent / "resources" / "build" / "icon.ico"
output.parent.mkdir(parents=True, exist_ok=True)
image.save(output, format="ICO", sizes=[(16, 16), (24, 24), (32, 32), (48, 48), (64, 64), (128, 128), (256, 256)])
print(f"Built {output}")
